use serde::Serialize;
use std::{
    ffi::OsString,
    fmt, fs,
    io::{self, Read},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

mod documents;
mod images;
use documents::Documents;
mod navigation;
#[cfg(feature = "perf")]
pub mod perf;
mod watch;

const MAX_DOCUMENT_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug)]
enum ReadError {
    Access(io::Error),
    NotRegular,
    TooLarge,
    InvalidUtf8,
    Read(io::Error),
}

impl fmt::Display for ReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Access(error) | Self::Read(error) => error.fmt(formatter),
            Self::NotRegular => formatter.write_str("not a regular file"),
            Self::TooLarge => formatter.write_str("file is too large (max 10 MiB)"),
            Self::InvalidUtf8 => formatter.write_str("file is not valid UTF-8"),
        }
    }
}

fn read_markdown(path: &Path) -> Result<String, ReadError> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;

        // A FIFO can block during open, before its type can be checked.
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(ReadError::Access)?;
    // Inspect the opened handle so replacing the path cannot change what we read.
    let metadata = file.metadata().map_err(ReadError::Access)?;
    if !metadata.is_file() {
        return Err(ReadError::NotRegular);
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(ReadError::TooLarge);
    }

    let capacity = usize::try_from(metadata.len()).map_err(|_| ReadError::TooLarge)?;
    let mut bytes = Vec::with_capacity(capacity);
    file.take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(ReadError::Read)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(ReadError::TooLarge);
    }
    String::from_utf8(bytes).map_err(|_| ReadError::InvalidUtf8)
}

#[derive(Clone, Debug, Serialize)]
pub struct Snapshot {
    text: String,
    error: Option<String>,
    warning: Option<String>,
    revision: u64,
}

#[derive(Debug)]
pub struct Document {
    path: Option<PathBuf>,
    images: Option<Arc<images::ImageScope>>,
    snapshot: Mutex<Snapshot>,
}

impl Document {
    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn into_text(self) -> Result<String, String> {
        self.snapshot
            .into_inner()
            .map(|snapshot| snapshot.text)
            .map_err(|_| "document state is unavailable".into())
    }

    fn title(&self) -> String {
        match self.path() {
            Some(path) => path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "mjp".into()),
            None => "stdin".into(),
        }
    }

    fn snapshot(&self) -> Result<Snapshot, String> {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| "document state is unavailable".into())
    }

    fn refresh(&self) -> Option<u64> {
        let path = self.path()?;
        let mut result = read_markdown(path);
        for _ in 0..2 {
            if result.is_ok() {
                break;
            }
            thread::sleep(Duration::from_millis(35));
            result = read_markdown(path);
        }

        let mut snapshot = self.snapshot.lock().ok()?;
        match result {
            Ok(text) if text != snapshot.text || snapshot.error.is_some() => {
                snapshot.text = text;
                snapshot.error = None;
            }
            Err(error) => {
                let message = format!("Cannot read file: {error}");
                if snapshot.error.as_deref() == Some(message.as_str()) {
                    return None;
                }
                snapshot.error = Some(message);
            }
            _ => return None,
        }
        snapshot.revision += 1;
        Some(snapshot.revision)
    }

    fn set_warning(&self, warning: String) {
        if let Ok(mut snapshot) = self.snapshot.lock() {
            snapshot.warning = Some(warning);
            snapshot.revision += 1;
        }
    }
}

pub fn load_document(args: impl IntoIterator<Item = OsString>) -> Result<Document, String> {
    let mut args = args.into_iter();
    let input = args.next().ok_or("usage: mjp <file>")?;
    if args.next().is_some() {
        return Err("expected exactly one file (usage: mjp <file>)".into());
    }

    let path = PathBuf::from(input);
    if path.as_os_str().is_empty() {
        return Err("empty file path".into());
    }

    let label = path.display();
    let text = read_markdown(&path).map_err(|error| match error {
        ReadError::Access(error) if error.kind() == io::ErrorKind::NotFound => {
            format!("{label}: file not found")
        }
        ReadError::Access(error) => format!("{label}: cannot access file: {error}"),
        ReadError::NotRegular => format!("{label}: not a regular file"),
        ReadError::TooLarge => format!("{label}: file is too large (max 10 MiB)"),
        ReadError::InvalidUtf8 => format!("{label}: file is not valid UTF-8"),
        ReadError::Read(error) => format!("{label}: cannot read file: {error}"),
    })?;
    let path = fs::canonicalize(&path)
        .map_err(|error| format!("{label}: cannot resolve file path: {error}"))?;

    Ok(Document {
        images: images::ImageScope::new(&path).ok().map(Arc::new),
        path: Some(path),
        snapshot: Mutex::new(Snapshot {
            text,
            error: None,
            warning: None,
            revision: 0,
        }),
    })
}

pub fn load_stdin(input: impl Read) -> Result<Document, String> {
    let mut bytes = Vec::new();
    input
        .take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("stdin: cannot read input: {error}"))?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("stdin: input is too large (max 10 MiB)".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "stdin: input is not valid UTF-8")?;
    Ok(Document {
        path: None,
        images: None,
        snapshot: Mutex::new(Snapshot {
            text,
            error: None,
            warning: None,
            revision: 0,
        }),
    })
}

#[tauri::command]
fn get_document(
    window: tauri::WebviewWindow,
    documents: tauri::State<'_, Documents>,
) -> Result<Snapshot, String> {
    documents.get(window.label())?.snapshot()
}

#[tauri::command]
async fn get_image(
    window: tauri::WebviewWindow,
    documents: tauri::State<'_, Documents>,
    reference: String,
) -> Result<tauri::ipc::Response, String> {
    let scope = documents
        .get(window.label())?
        .images
        .clone()
        .ok_or("Local images are unavailable")?;
    let bytes = tauri::async_runtime::spawn_blocking(move || scope.read(&reference))
        .await
        .map_err(|_| "Cannot read local image")??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn close_preview(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid link".to_owned())?;
    if !matches!(parsed.scheme(), "https" | "http" | "mailto") {
        return Err("Unsupported link scheme".into());
    }
    if matches!(parsed.scheme(), "https" | "http") && parsed.host_str().is_none() {
        return Err("Link has no host".into());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(feature = "perf")]
#[tauri::command]
fn perf_mark(window: tauri::WebviewWindow, stage: String, rendered_ms: f64) {
    if matches!(
        stage.as_str(),
        "document_received"
            | "markdown_parsed"
            | "dom_inserted"
            | "highlight_done"
            | "first_render"
            | "reload_render"
    ) {
        perf::mark_window(window.label(), &stage, (rendered_ms * 1000.0) as u128);
    }
}

fn create_preview(app: &tauri::AppHandle, document: Document) -> tauri::Result<String> {
    let title = document.title();
    let document = Arc::new(document);
    let documents = app.state::<Documents>();
    let label = documents.insert(Arc::clone(&document));
    if let Some(path) = document.path.clone() {
        match watch::start(app.clone(), label.clone(), Arc::clone(&document), path) {
            Ok(watcher) => documents.attach_watcher(&label, watcher),
            Err(error) => document.set_warning(format!("Live reload is unavailable: {error}")),
        }
    }
    let result = (|| {
        let dev_url = app.config().build.dev_url.clone();
        let mut config = app.config().app.windows[0].clone();
        config.label = label.clone();
        let window = tauri::WebviewWindowBuilder::from_config(app, &config)?
            .title(format!("{title} — mjp"))
            .on_navigation(move |url| navigation::allows_navigation(url, dev_url.as_ref()))
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .build()?;
        #[cfg(feature = "perf")]
        perf::mark_window_now(window.label(), "window_created");
        let _ = window.set_focus();
        Ok(label.clone())
    })();
    if result.is_err() {
        documents.remove(&label);
    }
    result
}

pub fn run(document: Document) -> tauri::Result<()> {
    #[cfg(feature = "perf")]
    perf::mark_now("gui_run");
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Documents::default());
    #[cfg(feature = "perf")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_document,
        get_image,
        close_preview,
        open_external,
        perf_mark
    ]);
    #[cfg(not(feature = "perf"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_document,
        get_image,
        close_preview,
        open_external
    ]);
    builder
        .setup(move |app| {
            create_preview(app.handle(), document)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let app = window.app_handle();
                let documents = app.state::<Documents>();
                documents.remove(window.label());
                if documents.can_exit(false) {
                    app.exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::OsString, fs, path::Path};

    fn load(path: &Path) -> Result<Document, String> {
        load_document([path.as_os_str().to_os_string()])
    }

    #[test]
    fn stdin_preserves_text_without_a_file_or_image_scope() {
        for text in ["", "# 日本語\r\n\n\ttext\n", "no trailing newline"] {
            let document = load_stdin(text.as_bytes()).unwrap();
            assert!(document.path().is_none());
            assert!(document.images.is_none());
            assert_eq!(document.title(), "stdin");
            assert_eq!(document.refresh(), None);
            let snapshot = document.snapshot().unwrap();
            assert_eq!(snapshot.text, text);
            assert_eq!(snapshot.revision, 0);
            assert!(snapshot.error.is_none());
            assert!(snapshot.warning.is_none());
            assert_eq!(document.into_text().unwrap(), text);
        }
    }

    #[test]
    fn stdin_accepts_the_byte_limit_and_stops_reading_just_beyond_it() {
        let document = load_stdin(io::repeat(b'a').take(MAX_DOCUMENT_BYTES)).unwrap();
        assert_eq!(
            document.into_text().unwrap().len() as u64,
            MAX_DOCUMENT_BYTES
        );
        let mut input = io::Cursor::new(vec![b'a'; MAX_DOCUMENT_BYTES as usize + 100]);
        assert!(load_stdin(&mut input).unwrap_err().contains("max 10 MiB"));
        assert_eq!(input.position(), MAX_DOCUMENT_BYTES + 1);
    }

    #[test]
    fn stdin_reports_invalid_utf8_and_read_failures() {
        assert!(load_stdin([0xff].as_slice()).unwrap_err().contains("UTF-8"));
        struct FailedRead;
        impl Read for FailedRead {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::other("read fixture"))
            }
        }
        let message = load_stdin(FailedRead).unwrap_err();
        assert!(message.contains("stdin: cannot read input"));
        assert!(message.contains("read fixture"));
    }

    #[test]
    fn requires_exactly_one_argument() {
        assert!(load_document(Vec::<OsString>::new())
            .unwrap_err()
            .contains("usage"));
        assert!(load_document(["a".into(), "b".into()])
            .unwrap_err()
            .contains("exactly one"));
    }

    #[test]
    fn distinguishes_missing_and_directory() {
        let directory = std::env::temp_dir();
        assert!(load(&directory).unwrap_err().contains("regular file"));
        let missing = directory.join(format!("mjp-missing-{}", std::process::id()));
        assert!(load(&missing).unwrap_err().contains("file not found"));
    }

    #[test]
    fn reads_absolute_and_relative_paths() {
        use std::io::Write;

        struct Fixture(PathBuf);

        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = fs::remove_file(&self.0);
            }
        }

        // A local fixture avoids changing the process-wide working directory during parallel tests.
        let relative = PathBuf::from(format!(
            ".mjp-paths-{}-{:?}.md",
            std::process::id(),
            std::thread::current().id()
        ));
        let absolute = std::env::current_dir().unwrap().join(&relative);
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;

            options.mode(0o600);
        }
        let mut file = options.open(&absolute).unwrap();
        let _fixture = Fixture(absolute.clone());
        let text = "# Path fixture\n\nTemporary document.\n";
        file.write_all(text.as_bytes()).unwrap();
        drop(file);

        let document = load(&absolute).unwrap();
        assert_eq!(document.snapshot().unwrap().text, text);
        assert!(document.path().unwrap().is_absolute());

        let relative_document = load(&relative).unwrap();
        assert_eq!(relative_document.snapshot().unwrap().text, text);
        assert_eq!(relative_document.path, document.path);
    }

    #[test]
    fn rejects_non_utf8_content() {
        let path = std::env::temp_dir().join(format!("mjp-invalid-{}.md", std::process::id()));
        fs::write(&path, [0xff, 0xfe]).unwrap();
        let result = load(&path);
        fs::remove_file(path).unwrap();
        assert!(result.unwrap_err().contains("UTF-8"));
    }

    #[test]
    fn refresh_preserves_content_during_delete_and_recovers() {
        let path = std::env::temp_dir().join(format!(
            "mjp-refresh-{}-{:?}.md",
            std::process::id(),
            std::thread::current().id()
        ));
        fs::write(&path, "before").unwrap();
        let document = load(&path).unwrap();
        assert_eq!(document.refresh(), None);

        fs::remove_file(&path).unwrap();
        assert_eq!(document.refresh(), Some(1));
        let missing = document.snapshot().unwrap();
        assert_eq!(missing.text, "before");
        assert!(missing.error.is_some());

        fs::write(&path, "after").unwrap();
        assert_eq!(document.refresh(), Some(2));
        let restored = document.snapshot().unwrap();
        assert_eq!(restored.text, "after");
        assert_eq!(restored.error, None);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn load_rejects_oversized_file() {
        let path = std::env::temp_dir().join(format!(
            "mjp-oversized-{}-{:?}.md",
            std::process::id(),
            std::thread::current().id()
        ));
        let file = fs::File::create(&path).unwrap();
        file.set_len(10 * 1024 * 1024 + 1).unwrap();
        let result = load(&path);
        fs::remove_file(&path).unwrap();
        match result {
            Err(message) => assert!(message.contains("file is too large")),
            Ok(_) => panic!("oversized file was accepted"),
        }
    }

    #[test]
    fn load_accepts_file_at_size_limit() {
        let path = std::env::temp_dir().join(format!(
            "mjp-size-limit-{}-{:?}.md",
            std::process::id(),
            std::thread::current().id()
        ));
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_DOCUMENT_BYTES).unwrap();
        let document = load(&path).unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(
            document.snapshot.lock().unwrap().text.len() as u64,
            MAX_DOCUMENT_BYTES
        );
    }

    #[test]
    fn refresh_preserves_content_when_file_grows_too_large() {
        let path = std::env::temp_dir().join(format!(
            "mjp-growing-{}-{:?}.md",
            std::process::id(),
            std::thread::current().id()
        ));
        fs::write(&path, "before").unwrap();
        let document = load(&path).unwrap();
        let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_len(10 * 1024 * 1024 + 1).unwrap();
        assert_eq!(document.refresh(), Some(1));
        let snapshot = document.snapshot().unwrap();
        assert_eq!(snapshot.text, "before");
        assert!(snapshot
            .error
            .as_deref()
            .unwrap_or("")
            .contains("file is too large"));

        file.set_len(6).unwrap();
        assert_eq!(document.refresh(), Some(2));
        let restored = document.snapshot().unwrap();
        assert_eq!(restored.text, "before");
        assert_eq!(restored.error, None);
        fs::remove_file(&path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn read_markdown_rejects_fifo_without_blocking() {
        use std::{ffi::CString, os::unix::ffi::OsStrExt, sync::mpsc};

        let path = std::env::temp_dir().join(format!(
            "mjp-read-fifo-{}-{:?}.md",
            std::process::id(),
            std::thread::current().id()
        ));
        let fifo = CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);

        let (sender, receiver) = mpsc::channel();
        let worker_path = path.clone();
        let worker = thread::spawn(move || {
            sender.send(read_markdown(&worker_path)).unwrap();
        });
        let result = receiver.recv_timeout(Duration::from_secs(2));
        fs::remove_file(&path).unwrap();
        let error = result.expect("reading a FIFO blocked").unwrap_err();
        worker.join().unwrap();
        assert!(matches!(error, ReadError::NotRegular));
    }

    #[cfg(unix)]
    #[test]
    fn refresh_rejects_fifo_without_blocking() {
        use std::{
            ffi::CString,
            os::unix::ffi::OsStrExt,
            sync::{mpsc, Arc},
        };

        let path = std::env::temp_dir().join(format!(
            "mjp-fifo-{}-{:?}.md",
            std::process::id(),
            std::thread::current().id()
        ));
        fs::write(&path, "before").unwrap();
        let document = Arc::new(load(&path).unwrap());
        fs::remove_file(&path).unwrap();
        let fifo = CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);

        let (sender, receiver) = mpsc::channel();
        let worker_document = Arc::clone(&document);
        let worker = thread::spawn(move || {
            sender.send(worker_document.refresh()).unwrap();
        });
        let revision = receiver.recv_timeout(Duration::from_secs(2));
        fs::remove_file(&path).unwrap();
        let revision = revision.expect("refresh blocked while opening a FIFO");
        worker.join().unwrap();

        assert_eq!(revision, Some(1));
        let snapshot = document.snapshot().unwrap();
        assert_eq!(snapshot.text, "before");
        assert!(snapshot.error.as_deref().unwrap().contains("regular file"));
    }
}
