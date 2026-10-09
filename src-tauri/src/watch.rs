use std::{
    error::Error,
    path::{Path, PathBuf},
    sync::mpsc::{self, Receiver, RecvTimeoutError},
    thread,
    time::{Duration, Instant},
};

use notify::{Event, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use super::Document;

const SETTLE_TIME: Duration = Duration::from_millis(140);
const MAX_SETTLE_TIME: Duration = Duration::from_millis(700);

pub fn start(app: AppHandle, path: PathBuf) -> Result<(), Box<dyn Error>> {
    let parent = path.parent().ok_or("file has no parent directory")?;
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx)?;
    watcher.watch(parent, RecursiveMode::NonRecursive)?;

    thread::Builder::new()
        .name("mjp-file-watch".into())
        .spawn(move || {
            let _watcher = watcher;
            while let Ok(event) = rx.recv() {
                if !is_relevant(&event, &path) {
                    continue;
                }
                if !wait_for_settle(&rx, &path) {
                    return;
                }

                if let Some(revision) = app.state::<Document>().refresh() {
                    let _ = app.emit_to("main", "document-changed", revision);
                }
            }
        })?;
    Ok(())
}

fn wait_for_settle(rx: &Receiver<notify::Result<Event>>, target: &Path) -> bool {
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
            Ok(event) if is_relevant(&event, target) => quiet_until = Instant::now() + SETTLE_TIME,
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
                if producer_sender.send(Ok(event)).is_err() {
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
}
