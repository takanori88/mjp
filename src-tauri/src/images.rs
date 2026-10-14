use std::{
    fs::File,
    io::{self, Read},
    path::{Component, Path, PathBuf},
};

pub const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug)]
pub struct ImageScope {
    directory: File,
    document_directory: PathBuf,
}

impl ImageScope {
    pub fn new(document: &Path) -> io::Result<Self> {
        let parent = document.parent().ok_or(io::ErrorKind::InvalidInput)?;
        let root = parent
            .ancestors()
            .find(|path| path.join(".git").symlink_metadata().is_ok())
            .unwrap_or(parent);
        let mut options = std::fs::OpenOptions::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;

            options.custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        Ok(Self {
            directory: options.read(true).open(root)?,
            document_directory: parent.strip_prefix(root).unwrap().to_path_buf(),
        })
    }

    pub fn read(&self, reference: &str) -> Result<Vec<u8>, String> {
        let relative = self.resolve(reference)?;
        let file = self
            .open(&relative)
            .map_err(|_| "Cannot open local image")?;
        let metadata = file.metadata().map_err(|_| "Cannot inspect local image")?;
        if !metadata.is_file() {
            return Err("Image is not a regular file".into());
        }
        if metadata.len() > MAX_IMAGE_BYTES {
            return Err("Image is larger than 10 MiB".into());
        }
        let mut bytes = Vec::new();
        file.take(MAX_IMAGE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read local image")?;
        if bytes.len() as u64 > MAX_IMAGE_BYTES {
            return Err("Image is larger than 10 MiB".into());
        }
        if !is_raster_image(&bytes) {
            return Err("Only PNG, JPEG, GIF, and WebP images are supported".into());
        }
        Ok(bytes)
    }

    fn resolve(&self, reference: &str) -> Result<PathBuf, String> {
        if reference.len() > 4096 {
            return Err("Image path is too long".into());
        }
        let reference = reference.split(['?', '#']).next().unwrap_or_default();
        let mut bytes = Vec::new();
        let mut input = reference.as_bytes().iter().copied();
        while let Some(byte) = input.next() {
            bytes.push(if byte == b'%' {
                let high = input.next().and_then(|v| (v as char).to_digit(16));
                let low = input.next().and_then(|v| (v as char).to_digit(16));
                match (high, low) {
                    (Some(high), Some(low)) => (high * 16 + low) as u8,
                    _ => return Err("Invalid image path encoding".into()),
                }
            } else {
                byte
            });
        }
        let decoded = String::from_utf8(bytes).map_err(|_| "Invalid image path encoding")?;
        if decoded.is_empty()
            || decoded.starts_with('/')
            || decoded.contains([':', '\\'])
            || decoded.chars().any(char::is_control)
        {
            return Err("Only relative local image paths are supported".into());
        }
        let mut path = self.document_directory.clone();
        for component in Path::new(&decoded).components() {
            match component {
                Component::Normal(name) => path.push(name),
                Component::CurDir => {}
                Component::ParentDir if path.pop() => {}
                _ => {
                    return Err(
                        "Image is outside the document's directory or Git working tree".into(),
                    )
                }
            }
        }
        if path.as_os_str().is_empty() {
            return Err("Image path must name a file".into());
        }
        Ok(path)
    }

    #[cfg(unix)]
    fn open(&self, relative: &Path) -> io::Result<File> {
        use std::{
            ffi::CString,
            os::fd::{AsRawFd, FromRawFd},
            os::unix::ffi::OsStrExt,
        };

        // Walking from an open directory keeps each component within the selected scope.
        let mut directory = self.directory.try_clone()?;
        let mut parts = relative.components().peekable();
        while let Some(part) = parts.next() {
            let name = CString::new(part.as_os_str().as_bytes())?;
            let mut flags = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK;
            if parts.peek().is_some() {
                flags |= libc::O_DIRECTORY;
            }
            let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
            if fd < 0 {
                return Err(io::Error::last_os_error());
            }
            directory = unsafe { File::from_raw_fd(fd) };
        }
        Ok(directory)
    }

    #[cfg(not(unix))]
    fn open(&self, _relative: &Path) -> io::Result<File> {
        Err(io::ErrorKind::Unsupported.into())
    }
}

fn is_raster_image(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || bytes.starts_with(b"\xff\xd8\xff")
        || bytes.starts_with(b"GIF87a")
        || bytes.starts_with(b"GIF89a")
        || (bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        fs,
        io::Write,
        os::unix::fs::{symlink, DirBuilderExt},
        sync::atomic::{AtomicU64, Ordering},
    };

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfixture";
    static NEXT: AtomicU64 = AtomicU64::new(0);

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "mjp-images-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
            Self(path.canonicalize().unwrap())
        }

        fn scope(&self, parent: &str) -> ImageScope {
            let directory = self.0.join(parent);
            fs::create_dir_all(&directory).unwrap();
            ImageScope::new(&directory.join("document.md")).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn reads_relative_images_and_encoded_names_from_the_document_directory() {
        let fixture = Fixture::new();
        let scope = fixture.scope("notes");
        fs::create_dir(fixture.0.join("notes/images")).unwrap();
        fs::write(fixture.0.join("notes/images/画像 1.png"), PNG).unwrap();
        assert_eq!(
            scope.read("images/%E7%94%BB%E5%83%8F%201.png").unwrap(),
            PNG
        );
        assert_eq!(
            scope.read("./images/画像 1.png?version=1#part").unwrap(),
            PNG
        );
    }

    #[test]
    fn permits_shared_images_only_within_the_nearest_git_working_tree() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join(".git")).unwrap();
        let scope = fixture.scope("docs/ja");
        fs::create_dir(fixture.0.join("docs/images")).unwrap();
        fs::write(fixture.0.join("docs/images/preview.png"), PNG).unwrap();
        assert_eq!(scope.read("../images/preview.png").unwrap(), PNG);
        assert!(scope.read("../../../outside.png").is_err());
        fs::write(fixture.0.join("docs/.git"), "gitdir: elsewhere").unwrap();
        let nested = fixture.scope("docs/ja");
        assert_eq!(nested.read("../images/preview.png").unwrap(), PNG);
        assert!(nested.read("../../outside.png").is_err());
    }

    #[test]
    fn requires_relative_paths_that_stay_inside_the_scope() {
        let fixture = Fixture::new();
        let scope = fixture.scope("notes");
        fs::write(fixture.0.join("outside.png"), PNG).unwrap();
        for reference in [
            "../outside.png",
            "%2e%2e/outside.png",
            "/tmp/image.png",
            "//host/image.png",
            "file:///tmp/image.png",
            "https://example.com/image.png",
            "data:image/png,example",
            "C:/image.png",
            "..\\outside.png",
            "%2Ftmp/image.png",
            "%00.png",
            "%GG.png",
            "",
        ] {
            assert!(scope.read(reference).is_err(), "{reference}");
        }
        assert!(scope.read(&"x".repeat(4097)).is_err());
    }

    #[test]
    fn reads_regular_files_without_following_file_or_directory_links() {
        let fixture = Fixture::new();
        let scope = fixture.scope("notes");
        fs::write(fixture.0.join("outside.png"), PNG).unwrap();
        symlink("../outside.png", fixture.0.join("notes/link.png")).unwrap();
        symlink("..", fixture.0.join("notes/linked-directory")).unwrap();
        assert!(scope.read("link.png").is_err());
        assert!(scope.read("linked-directory/outside.png").is_err());
        assert!(scope.read(".").is_err());
        assert!(scope.read("missing.png").is_err());
        let fifo = std::ffi::CString::new(
            fixture
                .0
                .join("notes/pipe.png")
                .as_os_str()
                .as_encoded_bytes(),
        )
        .unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        assert!(scope.read("pipe.png").is_err());
    }

    #[test]
    fn retains_the_opened_scope_when_its_directory_is_replaced() {
        let fixture = Fixture::new();
        let scope = fixture.scope("notes");
        fs::write(fixture.0.join("notes/image.png"), PNG).unwrap();
        fs::rename(fixture.0.join("notes"), fixture.0.join("original")).unwrap();
        fs::create_dir(fixture.0.join("notes")).unwrap();
        fs::write(fixture.0.join("notes/image.png"), b"replacement").unwrap();
        assert_eq!(scope.read("image.png").unwrap(), PNG);
    }

    #[test]
    fn bounds_image_bytes_and_accepts_only_raster_signatures() {
        let fixture = Fixture::new();
        let scope = fixture.scope("notes");
        let path = fixture.0.join("notes/image.png");
        for bytes in [
            PNG,
            b"\xff\xd8\xffimage",
            b"GIF87aimage",
            b"GIF89aimage",
            b"RIFF0000WEBPimage",
        ] {
            fs::write(&path, bytes).unwrap();
            assert_eq!(scope.read("image.png").unwrap(), bytes);
        }
        for bytes in [
            b"<svg></svg>".as_slice(),
            b"<html>text</html>",
            b"text",
            b"",
        ] {
            fs::write(&path, bytes).unwrap();
            assert!(scope.read("image.png").is_err());
        }
        let mut file = File::create(&path).unwrap();
        file.write_all(PNG).unwrap();
        file.set_len(MAX_IMAGE_BYTES).unwrap();
        assert_eq!(
            scope.read("image.png").unwrap().len() as u64,
            MAX_IMAGE_BYTES
        );
        file.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert!(scope.read("image.png").is_err());
    }
}
