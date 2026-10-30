use std::{
    error::Error,
    path::{Path, PathBuf},
    sync::{
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use notify::{Event, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use super::Document;

const SETTLE_TIME: Duration = Duration::from_millis(140);
const MAX_SETTLE_TIME: Duration = Duration::from_millis(700);

enum Message {
    Event(notify::Result<Event>),
    Stop,
}

type Subscription = (
    notify::RecommendedWatcher,
    Sender<Message>,
    Receiver<Message>,
);

pub struct WatchHandle {
    watcher: Option<notify::RecommendedWatcher>,
    sender: Sender<Message>,
    stopped: Arc<Mutex<bool>>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        *self.stopped.lock().expect("watch state poisoned") = true;
        let _ = self.sender.send(Message::Stop);
        self.watcher.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub fn start(
    app: AppHandle,
    label: String,
    document: Arc<Document>,
    path: PathBuf,
) -> Result<WatchHandle, Box<dyn Error>> {
    let (watcher, sender, rx) = subscribe(&path)?;
    start_worker(Some(watcher), sender, rx, path, move || {
        if let Some(revision) = document.refresh() {
            let _ = app.emit_to(&label, "document-changed", revision);
        }
    })
}

fn start_worker(
    watcher: Option<notify::RecommendedWatcher>,
    sender: Sender<Message>,
    rx: Receiver<Message>,
    path: PathBuf,
    mut changed: impl FnMut() + Send + 'static,
) -> Result<WatchHandle, Box<dyn Error>> {
    let stopped = Arc::new(Mutex::new(false));
    let worker_stopped = Arc::clone(&stopped);
    let worker = thread::Builder::new()
        .name("mjp-file-watch".into())
        .spawn(move || {
            process_events(&rx, &path, || {
                // A stop and a refresh must not cross, even when a read is already underway.
                let stopped = worker_stopped.lock().expect("watch state poisoned");
                if !*stopped {
                    changed();
                }
            });
        })?;
    Ok(WatchHandle {
        watcher,
        sender,
        stopped,
        worker: Some(worker),
    })
}

fn subscribe(path: &Path) -> Result<Subscription, Box<dyn Error>> {
    let parent = path.parent().ok_or("file has no parent directory")?;
    let (tx, rx) = mpsc::channel();
    let events = tx.clone();
    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = events.send(Message::Event(event));
    })?;
    watcher.watch(parent, RecursiveMode::NonRecursive)?;
    Ok((watcher, tx, rx))
}

fn process_events(rx: &Receiver<Message>, path: &Path, mut changed: impl FnMut()) {
    while let Ok(Message::Event(event)) = rx.recv() {
        if !is_relevant(&event, path) {
            continue;
        }
        if !wait_for_settle(rx, path) {
            return;
        }
        changed();
    }
}

fn wait_for_settle(rx: &Receiver<Message>, target: &Path) -> bool {
    let start = Instant::now();
    let deadline = start + MAX_SETTLE_TIME;
    let mut quiet_until = start + SETTLE_TIME;
    loop {
        let remaining = quiet_until
            .min(deadline)
            .saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return true;
        }
        match rx.recv_timeout(remaining) {
            Ok(Message::Stop) => return false,
            Ok(Message::Event(event)) if is_relevant(&event, target) => {
                quiet_until = Instant::now() + SETTLE_TIME
            }
            Ok(_) => {}
            Err(RecvTimeoutError::Timeout) => return true,
            Err(RecvTimeoutError::Disconnected) => return false,
        }
    }
}

fn is_relevant(event: &notify::Result<Event>, target: &Path) -> bool {
    match event {
        Err(_) => true,
        Ok(event) => {
            event.paths.is_empty()
                || event
                    .paths
                    .iter()
                    .any(|path| path.file_name() == target.file_name())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::{fs, time::SystemTime};

    struct WatchedDocument {
        directory: PathBuf,
        watcher: Option<notify::RecommendedWatcher>,
        worker: Option<thread::JoinHandle<()>>,
        updates: Receiver<crate::Snapshot>,
    }

    impl WatchedDocument {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let directory =
                std::env::temp_dir().join(format!("mjp-watch-{}-{unique}", std::process::id()));
            fs::create_dir(&directory).unwrap();
            let path = directory.join("selected.md");
            fs::write(&path, "# Initial").unwrap();
            let document = crate::load_document([path.clone().into_os_string()]).unwrap();
            let (watcher, sender, events) = subscribe(&path).unwrap();
            drop(sender);
            let (send, updates) = mpsc::channel();
            let worker = thread::spawn(move || {
                process_events(&events, &path, || {
                    if document.refresh().is_some() {
                        send.send(document.snapshot().unwrap()).unwrap();
                    }
                });
            });
            Self {
                directory,
                watcher: Some(watcher),
                worker: Some(worker),
                updates,
            }
        }

        fn next(&self) -> crate::Snapshot {
            self.updates
                .recv_timeout(Duration::from_secs(5))
                .expect("a file change did not publish a snapshot")
        }
    }

    impl Drop for WatchedDocument {
        fn drop(&mut self) {
            self.watcher.take();
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    #[test]
    fn saves_replacements_and_recreation_publish_current_snapshots() {
        let watched = WatchedDocument::new();
        let path = watched.directory.join("selected.md");

        fs::write(&path, "# Saved").unwrap();
        let saved = watched.next();
        assert_eq!(saved.text, "# Saved");
        assert!(saved.error.is_none());
        assert!(saved.revision > 0);

        let replacement = watched.directory.join("replacement.md");
        fs::write(&replacement, "# Replaced").unwrap();
        fs::rename(&replacement, &path).unwrap();
        let replaced = watched.next();
        assert_eq!(replaced.text, "# Replaced");
        assert!(replaced.error.is_none());
        assert!(replaced.revision > saved.revision);

        fs::remove_file(&path).unwrap();
        let missing = watched.next();
        assert_eq!(missing.text, "# Replaced");
        assert!(missing.error.is_some());
        assert!(missing.revision > replaced.revision);

        fs::write(&path, "# Replaced").unwrap();
        let restored = watched.next();
        assert_eq!(restored.text, "# Replaced");
        assert!(restored.error.is_none());
        assert!(restored.revision > missing.revision);
    }

    fn delay_during_events(event_path: &str) -> Duration {
        let (sender, receiver) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let producer_stop = Arc::clone(&stop);
        let producer_sender = sender.clone();
        let event_path = PathBuf::from(event_path);
        let producer = thread::spawn(move || {
            let end = Instant::now() + MAX_SETTLE_TIME * 2;
            while Instant::now() < end && !producer_stop.load(Ordering::Relaxed) {
                let event = Event::new(notify::EventKind::Any).add_path(event_path.clone());
                if producer_sender.send(Message::Event(Ok(event))).is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(5));
            }
        });
        let start = Instant::now();
        let settled = wait_for_settle(&receiver, Path::new("/documents/selected.md"));
        let elapsed = start.elapsed();
        stop.store(true, Ordering::Relaxed);
        producer.join().unwrap();
        assert!(settled);
        drop(sender);
        elapsed
    }

    #[test]
    fn sibling_events_do_not_extend_the_settling_period() {
        let elapsed = delay_during_events("/documents/sibling.md");
        assert!(elapsed >= SETTLE_TIME);
        assert!(elapsed < SETTLE_TIME * 3, "reload waited {elapsed:?}");
    }

    #[test]
    fn target_events_reload_within_the_total_settling_limit() {
        let elapsed = delay_during_events("/documents/selected.md");
        assert!(elapsed >= MAX_SETTLE_TIME);
        assert!(
            elapsed < MAX_SETTLE_TIME + SETTLE_TIME * 2,
            "reload waited {elapsed:?}"
        );
    }

    #[test]
    fn a_closed_event_stream_stops_waiting() {
        let (sender, receiver) = mpsc::channel();
        drop(sender);
        assert!(!wait_for_settle(
            &receiver,
            Path::new("/documents/selected.md")
        ));
    }
    #[test]
    fn stopping_wakes_an_idle_worker_and_releases_its_document() {
        let (sender, receiver) = mpsc::channel();
        let document = Arc::new(crate::load_stdin(b"before".as_slice()).unwrap());
        let weak = Arc::downgrade(&document);
        let handle = start_worker(
            None,
            sender,
            receiver,
            PathBuf::from("selected.md"),
            move || {
                document.set_warning("changed".into());
            },
        )
        .unwrap();
        drop(handle);
        assert!(weak.upgrade().is_none());
    }

    #[test]
    fn stopping_during_settle_prevents_later_document_updates() {
        let (sender, receiver) = mpsc::channel();
        let document = Arc::new(crate::load_stdin(b"before".as_slice()).unwrap());
        let worker_document = Arc::clone(&document);
        let handle = start_worker(
            None,
            sender.clone(),
            receiver,
            PathBuf::from("selected.md"),
            move || {
                worker_document.set_warning("changed".into());
            },
        )
        .unwrap();
        sender
            .send(Message::Event(Ok(Event::new(notify::EventKind::Any))))
            .unwrap();
        drop(handle);
        assert_eq!(document.snapshot().unwrap().revision, 0);
        assert!(sender
            .send(Message::Event(Ok(Event::new(notify::EventKind::Any))))
            .is_err());
    }
}
