use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::{watch::WatchHandle, Document};

#[derive(Default)]
pub(crate) struct Documents(Mutex<Registry>);

#[derive(Default)]
struct Registry {
    next_label: u64,
    entries: HashMap<String, Entry>,
}

struct Entry {
    document: Arc<Document>,
    watcher: Option<WatchHandle>,
}

impl Documents {
    pub fn insert(&self, document: Arc<Document>) -> String {
        let mut registry = self.0.lock().expect("document registry poisoned");
        let label = format!("preview-{}", registry.next_label);
        registry.next_label = registry
            .next_label
            .checked_add(1)
            .expect("window labels exhausted");
        registry.entries.insert(
            label.clone(),
            Entry {
                document,
                watcher: None,
            },
        );
        label
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
    pub fn attach_watcher(&self, label: &str, watcher: WatchHandle) {
        let mut registry = self.0.lock().expect("document registry poisoned");
        if let Some(entry) = registry.entries.get_mut(label) {
            entry.watcher = Some(watcher);
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
    fn each_window_reads_only_its_registered_document() {
        let documents = Documents::default();
        let first = Arc::new(crate::load_stdin("first".as_bytes()).unwrap());
        let second = Arc::new(crate::load_stdin("second".as_bytes()).unwrap());
        let a = documents.insert(Arc::clone(&first));
        let b = documents.insert(Arc::clone(&second));
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
            labels.push(documents.insert(Arc::new(document)));
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
        let a = documents.insert(document);
        let b = documents.insert(Arc::new(crate::load_stdin(b"b".as_slice()).unwrap()));
        documents.remove(&a);
        assert!(weak.upgrade().is_none());
        assert!(documents.get(&a).is_err());
        assert!(documents.get(&b).is_ok());
        assert!(!documents.can_exit(false));
        documents.remove(&b);
        assert!(documents.can_exit(false));
        assert!(!documents.can_exit(true));
        let c = documents.insert(Arc::new(crate::load_stdin(b"c".as_slice()).unwrap()));
        assert_ne!(c, a);
        assert_ne!(c, b);
    }
}
