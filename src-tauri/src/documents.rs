use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

use crate::{open_requests::WindowKind, watch::WatchHandle, Document};

#[derive(Default)]
pub(crate) struct Documents(Mutex<Registry>);

#[derive(Default)]
struct Registry {
    next_label: u64,
    entries: HashMap<String, Entry>,
}

struct Entry {
    kind: WindowKind,
    slot: u32,
    document: Arc<Document>,
    watcher: Option<WatchHandle>,
}

fn lowest_free_slot(used: impl IntoIterator<Item = u32>) -> u32 {
    let used: HashSet<_> = used.into_iter().collect();
    (0..=u32::MAX)
        .find(|slot| !used.contains(slot))
        .expect("window slots exhausted")
}

impl Documents {
    pub fn insert(&self, document: Arc<Document>, kind: WindowKind) -> (String, u32) {
        let mut registry = self.0.lock().expect("document registry poisoned");
        let label = format!("preview-{}", registry.next_label);
        registry.next_label = registry
            .next_label
            .checked_add(1)
            .expect("window labels exhausted");
        let slot = lowest_free_slot(registry.entries.values().map(|entry| entry.slot));
        registry.entries.insert(
            label.clone(),
            Entry {
                kind,
                slot,
                document,
                watcher: None,
            },
        );
        (label, slot)
    }

    pub fn create<E>(
        &self,
        document: Arc<Document>,
        kind: WindowKind,
        build: impl FnOnce(&str, u32) -> Result<(), E>,
    ) -> Result<String, E> {
        let (label, slot) = self.insert(document, kind);
        match build(&label, slot) {
            Ok(()) => Ok(label),
            Err(error) => {
                self.remove(&label);
                Err(error)
            }
        }
    }

    pub fn get(&self, label: &str) -> Result<Arc<Document>, String> {
        self.0
            .lock()
            .map_err(|_| "document registry is unavailable")?
            .entries
            .get(label)
            .map(|entry| Arc::clone(&entry.document))
            .ok_or_else(|| "document is unavailable".into())
    }
    pub fn labels(&self, kind: WindowKind) -> Vec<String> {
        self.0
            .lock()
            .expect("document registry poisoned")
            .entries
            .iter()
            .filter(|(_, entry)| entry.kind == kind)
            .map(|(label, _)| label.clone())
            .collect()
    }

    pub fn attach_watcher(&self, label: &str, watcher: WatchHandle) {
        let mut registry = self.0.lock().expect("document registry poisoned");
        if let Some(entry) = registry.entries.get_mut(label) {
            let previous = entry.watcher.replace(watcher);
            drop(registry);
            drop(previous);
            return;
        }
        drop(registry);
        drop(watcher);
    }

    pub fn remove(&self, label: &str) {
        let entry = self
            .0
            .lock()
            .expect("document registry poisoned")
            .entries
            .remove(label);
        // Stopping a watcher can join its worker; never retain the registry lock here.
        drop(entry);
    }

    pub fn can_exit(&self, has_pending_requests: bool) -> bool {
        !has_pending_requests
            && self
                .0
                .lock()
                .expect("document registry poisoned")
                .entries
                .is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lowest_free_slot_is_the_smallest_gap_regardless_of_iteration_order() {
        for (used, expected) in [
            (vec![], 0),
            (vec![0, 1], 2),
            (vec![0, 2], 1),
            (vec![2, 0], 1),
            (vec![2, 1, 0], 3),
            (vec![u32::MAX, 0, 0], 1),
        ] {
            assert_eq!(lowest_free_slot(used), expected);
        }
    }

    fn document() -> Arc<Document> {
        Arc::new(crate::load_stdin(b"text".as_slice()).unwrap())
    }

    #[test]
    fn entries_reserve_distinct_slots_before_building_even_without_position_settings() {
        let documents = Documents::default();
        let (_, slot) = documents.insert(document(), WindowKind::Document);
        assert_eq!(slot, 0);
        let result = documents.create(document(), WindowKind::Document, |label, slot| {
            assert_eq!(slot, 1);
            assert!(documents.get(label).is_ok());
            let documents = &documents;
            let (_, other_slot) = std::thread::scope(|scope| {
                scope
                    .spawn(move || documents.insert(document(), WindowKind::Failures))
                    .join()
                    .unwrap()
            });
            assert_eq!(other_slot, 2);
            Ok::<(), ()>(())
        });
        assert!(result.is_ok());
        assert_eq!(documents.insert(document(), WindowKind::Document).1, 3);
    }

    #[test]
    fn failed_builds_release_their_slot_without_moving_other_entries() {
        let documents = Documents::default();
        assert_eq!(documents.insert(document(), WindowKind::Document).1, 0);
        let mut survivor = String::new();
        let result = documents.create(document(), WindowKind::Document, |_, slot| {
            assert_eq!(slot, 1);
            let (label, other_slot) = documents.insert(document(), WindowKind::Document);
            survivor = label;
            assert_eq!(other_slot, 2);
            Err("build failed")
        });
        assert_eq!(result, Err("build failed"));
        assert!(documents.get(&survivor).is_ok());
        assert_eq!(documents.insert(document(), WindowKind::Document).1, 1);
        assert_eq!(documents.insert(document(), WindowKind::Document).1, 3);
    }

    #[test]
    fn destroyed_entries_release_slots_and_the_smallest_gap_is_reused_first() {
        let documents = Documents::default();
        let (first, _) = documents.insert(document(), WindowKind::Document);
        let (middle, _) = documents.insert(document(), WindowKind::Document);
        let (last, _) = documents.insert(document(), WindowKind::Document);
        documents.remove(&middle);
        assert_eq!(documents.insert(document(), WindowKind::Document).1, 1);
        documents.remove(&last);
        documents.remove(&first);
        assert_eq!(documents.insert(document(), WindowKind::Document).1, 0);
        assert_eq!(documents.insert(document(), WindowKind::Document).1, 2);
    }

    #[test]
    fn welcome_keeps_its_slot_until_destroyed_after_a_successful_document_build() {
        let documents = Documents::default();
        let (welcome, slot) = documents.insert(document(), WindowKind::Welcome);
        assert_eq!(slot, 0);
        let failed = documents.create(document(), WindowKind::Document, |_, slot| {
            assert_eq!(slot, 1);
            Err("build failed")
        });
        assert!(!WindowKind::Document.replaces_welcome(failed.is_ok()));
        assert_eq!(documents.labels(WindowKind::Welcome), vec![welcome.clone()]);
        let success = documents.create(document(), WindowKind::Document, |_, slot| {
            assert_eq!(slot, 1);
            assert!(documents.get(&welcome).is_ok());
            Ok::<(), ()>(())
        });
        assert!(WindowKind::Document.replaces_welcome(success.is_ok()));
        assert_eq!(documents.insert(document(), WindowKind::Failures).1, 2);
        documents.remove(&welcome);
        assert_eq!(documents.insert(document(), WindowKind::Document).1, 0);
    }

    #[test]
    fn focusing_an_open_document_does_not_reserve_another_slot() {
        use crate::open_requests::{OpenDecision, Requests};
        let documents = Documents::default();
        let mut requests = Requests::default();
        let path = std::path::PathBuf::from("/documents/note.md");
        assert_eq!(requests.reserve(&path), OpenDecision::Load);
        let (label, slot) = documents.insert(document(), WindowKind::Document);
        assert_eq!(slot, 0);
        requests.opened(path.clone(), label.clone());
        assert_eq!(requests.reserve(&path), OpenDecision::Focus(label));
        assert_eq!(documents.insert(document(), WindowKind::Document).1, 1);
    }

    #[test]
    fn each_window_reads_only_its_registered_document() {
        let documents = Documents::default();
        let first = Arc::new(crate::load_stdin("first".as_bytes()).unwrap());
        let second = Arc::new(crate::load_stdin("second".as_bytes()).unwrap());
        let (a, _) = documents.insert(Arc::clone(&first), WindowKind::Document);
        let (b, _) = documents.insert(Arc::clone(&second), WindowKind::Document);
        assert_ne!(a, b);
        assert!(Arc::ptr_eq(&documents.get(&a).unwrap(), &first));
        assert!(Arc::ptr_eq(&documents.get(&b).unwrap(), &second));
        assert!(documents.get("main").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn image_reads_keep_the_calling_documents_scope() {
        let root = std::env::temp_dir().join(format!("mjp-window-images-{}", std::process::id()));
        let documents = Documents::default();
        let mut labels = Vec::new();
        for name in ["a", "b"] {
            let dir = root.join(name);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("note.md"), name).unwrap();
            let bytes = [b"\x89PNG\r\n\x1a\n".as_slice(), name.as_bytes()].concat();
            std::fs::write(dir.join("image.png"), bytes).unwrap();
            let document = crate::load_document([dir.join("note.md").into_os_string()]).unwrap();
            labels.push(documents.insert(Arc::new(document), WindowKind::Document).0);
        }
        for (label, name) in labels.iter().zip(["a", "b"]) {
            let document = documents.get(label).unwrap();
            assert_eq!(document.snapshot().unwrap().text, name);
            assert!(document
                .images
                .as_ref()
                .unwrap()
                .read("image.png")
                .unwrap()
                .ends_with(name.as_bytes()));
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn removing_a_window_releases_its_document_without_reusing_the_label() {
        let documents = Documents::default();
        let document = Arc::new(crate::load_stdin(b"a".as_slice()).unwrap());
        let weak = Arc::downgrade(&document);
        let (a, _) = documents.insert(document, WindowKind::Document);
        let (b, _) = documents.insert(
            Arc::new(crate::load_stdin(b"b".as_slice()).unwrap()),
            WindowKind::Document,
        );
        documents.remove(&a);
        assert!(weak.upgrade().is_none());
        assert!(documents.get(&a).is_err());
        assert!(documents.get(&b).is_ok());
        assert!(!documents.can_exit(false));
        documents.remove(&b);
        assert!(documents.can_exit(false));
        assert!(!documents.can_exit(true));
        let (c, _) = documents.insert(
            Arc::new(crate::load_stdin(b"c".as_slice()).unwrap()),
            WindowKind::Document,
        );
        assert_ne!(c, a);
        assert_ne!(c, b);
    }
    #[test]
    fn a_failed_build_unregisters_the_document_after_making_it_available_to_invokes() {
        let documents = Documents::default();
        let document = Arc::new(crate::load_stdin(b"a".as_slice()).unwrap());
        let weak = Arc::downgrade(&document);
        let mut attempted = String::new();
        let result = documents.create(document, WindowKind::Document, |label, _slot| {
            attempted = label.into();
            assert_eq!(documents.get(label).unwrap().snapshot().unwrap().text, "a");
            Err("build failed")
        });
        assert_eq!(result, Err("build failed"));
        assert!(documents.get(&attempted).is_err());
        assert!(weak.upgrade().is_none());
        assert!(documents.can_exit(false));
    }

    #[test]
    fn welcome_is_identified_by_kind_instead_of_text_or_path() {
        let documents = Documents::default();
        let (welcome, _) = documents.insert(
            Arc::new(crate::load_stdin(b"same".as_slice()).unwrap()),
            WindowKind::Welcome,
        );
        documents.insert(
            Arc::new(crate::load_stdin(b"same".as_slice()).unwrap()),
            WindowKind::Failures,
        );
        documents.insert(
            Arc::new(crate::load_stdin(b"same".as_slice()).unwrap()),
            WindowKind::Document,
        );
        assert_eq!(documents.labels(WindowKind::Welcome), vec![welcome]);
    }
}
