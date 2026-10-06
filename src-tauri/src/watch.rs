use std::{
    error::Error,
    path::{Path, PathBuf},
    sync::mpsc::{self, RecvTimeoutError},
    thread,
    time::Duration,
};

use notify::{Event, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use super::Document;

const SETTLE_TIME: Duration = Duration::from_millis(140);

pub fn start(app: AppHandle, path: PathBuf) -> Result<(), Box<dyn Error>> {
    let parent = path.parent().ok_or("file has no parent directory")?;
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx)?;
    watcher.watch(parent, RecursiveMode::NonRecursive)?;

    thread::Builder::new()
        .name("mdq-file-watch".into())
        .spawn(move || {
            let _watcher = watcher;
            while let Ok(event) = rx.recv() {
                if !is_relevant(&event, &path) {
                    continue;
                }
                loop {
                    match rx.recv_timeout(SETTLE_TIME) {
                        Ok(_) => continue,
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }

                if let Some(revision) = app.state::<Document>().refresh() {
                    let _ = app.emit_to("main", "document-changed", revision);
                }
            }
        })?;
    Ok(())
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
