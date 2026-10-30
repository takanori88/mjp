use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use crate::Document;

#[derive(Default)]
pub(crate) struct Documents(Mutex<Registry>);

#[derive(Default)]
struct Registry {
    next_label: u64,
    entries: HashMap<String, Arc<Document>>,
}

impl Documents {
    pub fn insert(&self, document: Arc<Document>) -> String {
        let mut registry = self.0.lock().expect("document registry poisoned");
        let label = format!("preview-{}", registry.next_label);
        registry.next_label = registry
            .next_label
            .checked_add(1)
            .expect("window labels exhausted");
        registry.entries.insert(label.clone(), document);
        label
    }

    pub fn get(&self, label: &str) -> Result<Arc<Document>, String> {
        self.0
            .lock()
            .map_err(|_| "document registry is unavailable")?
            .entries
            .get(label)
            .cloned()
            .ok_or_else(|| "document is unavailable".into())
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
}
