use std::{
    fs::OpenOptions,
    io::Write,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn mark_now(label: &str) {
    if let Ok(duration) = SystemTime::now().duration_since(UNIX_EPOCH) {
        mark(label, duration.as_micros());
    }
}

pub fn mark(label: &str, epoch_us: u128) {
    if let Some(path) = std::env::var_os("MJP_PERF_LOG") {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{label},{epoch_us},{}", std::process::id());
        }
    }
}

pub fn mark_window_now(window: &str, stage: &str) {
    if let Ok(duration) = SystemTime::now().duration_since(UNIX_EPOCH) {
        mark_window(window, stage, duration.as_micros());
    }
}

pub fn mark_window(window: &str, stage: &str, epoch_us: u128) {
    mark(&format!("{window}:{stage}"), epoch_us);
}
