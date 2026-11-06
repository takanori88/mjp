use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
};

pub(crate) fn config_path(home: Option<&OsStr>) -> Option<PathBuf> {
    let home = Path::new(home?);
    home.is_absolute()
        .then(|| home.join(".config/mjp/config.toml"))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum ThemeSetting {
    #[default]
    System,
    Light,
    Dark,
}

impl ThemeSetting {
    pub(crate) fn native_theme(self) -> Option<tauri::Theme> {
        match self {
            Self::System => None,
            Self::Light => Some(tauri::Theme::Light),
            Self::Dark => Some(tauri::Theme::Dark),
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Settings {
    pub theme: ThemeSetting,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum SettingsIssue {
    InvalidTheme,
    UnknownKey(String),
    Syntax(String),
}

pub(crate) fn parse_settings(text: &str) -> (Settings, Vec<SettingsIssue>) {
    let mut settings = Settings::default();
    let mut issues = Vec::new();
    let table = match toml::de::DeTable::parse(text) {
        Ok(table) => table,
        Err(error) => {
            let position = error
                .span()
                .map(|span| {
                    let (line, column) = line_column(text, span.start);
                    format!(" at line {line}, column {column}")
                })
                .unwrap_or_default();
            let message: String = error
                .message()
                .chars()
                .filter(|c| !c.is_control())
                .collect();
            return (
                Settings::default(),
                vec![SettingsIssue::Syntax(format!("{message}{position}"))],
            );
        }
    };
    for (key, value) in table.get_ref().iter() {
        if key.get_ref() == "theme" {
            settings.theme = match value.get_ref().as_str() {
                Some("light") => ThemeSetting::Light,
                Some("dark") => ThemeSetting::Dark,
                Some("system") => ThemeSetting::System,
                _ => {
                    issues.push(SettingsIssue::InvalidTheme);
                    ThemeSetting::System
                }
            };
        } else {
            issues.push(SettingsIssue::UnknownKey(key.get_ref().to_string()));
        }
    }
    (settings, issues)
}

fn line_column(text: &str, offset: usize) -> (usize, usize) {
    let mut offset = offset.min(text.len());
    while !text.is_char_boundary(offset) {
        offset -= 1;
    }
    let prefix = &text[..offset];
    let line = prefix.bytes().filter(|byte| *byte == b'\n').count() + 1;
    let column = prefix.rsplit('\n').next().unwrap_or("").chars().count() + 1;
    (line, column)
}

const MAX_SETTINGS_BYTES: u64 = 64 * 1024;

pub(crate) fn load_settings(path: &Path) -> (Settings, Vec<String>) {
    match crate::read_limited_utf8(path, MAX_SETTINGS_BYTES) {
        Err(crate::ReadError::Access(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            if std::fs::symlink_metadata(path)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
            {
                (
                    Settings::default(),
                    vec![format!(
                        "{}: cannot read symbolic link target",
                        path.display()
                    )],
                )
            } else {
                (Settings::default(), vec![])
            }
        }
        Err(error) => {
            let message = match error {
                crate::ReadError::TooLarge(limit) => {
                    format!("file is too large (max {} KiB)", limit / 1024)
                }
                crate::ReadError::NotRegular => "not a regular file".into(),
                crate::ReadError::InvalidUtf8 => "file is not valid UTF-8".into(),
                crate::ReadError::Access(error) | crate::ReadError::Read(error) => {
                    error.to_string()
                }
            };
            (
                Settings::default(),
                vec![format!("{}: {message}", path.display())],
            )
        }
        Ok(text) => {
            let (settings, issues) = parse_settings(&text);
            let warnings = issues
                .into_iter()
                .map(|issue| {
                    let message = match issue {
                        SettingsIssue::InvalidTheme => {
                            "invalid theme; expected system, light, or dark".into()
                        }
                        SettingsIssue::UnknownKey(key) => format!("unknown setting: {key}"),
                        SettingsIssue::Syntax(message) => format!("invalid TOML: {message}"),
                    };
                    format!("{}: {message}", path.display())
                })
                .collect();
            (settings, warnings)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::OsStr, path::PathBuf};

    #[test]
    fn config_path_requires_an_absolute_nonempty_home() {
        assert_eq!(
            config_path(Some(OsStr::new("/home/reader"))),
            Some(PathBuf::from("/home/reader/.config/mjp/config.toml"))
        );
        for home in [None, Some(OsStr::new("")), Some(OsStr::new("relative"))] {
            assert_eq!(config_path(home), None);
        }
    }
    #[test]
    fn omitted_theme_uses_defaults_without_issues() {
        for text in ["", "# comment\n", "\n "] {
            let (settings, issues) = parse_settings(text);
            assert_eq!(settings, Settings::default());
            assert!(issues.is_empty());
        }
    }
    #[test]
    fn valid_themes_select_the_requested_appearance() {
        for (value, theme) in [
            ("system", ThemeSetting::System),
            ("light", ThemeSetting::Light),
            ("dark", ThemeSetting::Dark),
        ] {
            assert_eq!(
                parse_settings(&format!("theme = {value:?}")),
                (Settings { theme }, vec![])
            );
        }
    }
    #[test]
    fn invalid_theme_uses_system_and_reports_one_issue() {
        for value in ["\"Dark\"", "1", "[]", "true", "{}"] {
            assert_eq!(
                parse_settings(&format!("theme = {value}")),
                (Settings::default(), vec![SettingsIssue::InvalidTheme])
            );
        }
    }
    #[test]
    fn unknown_top_level_keys_are_reported_in_order_without_hiding_valid_theme() {
        let (settings, issues) = parse_settings(
            "zebra = 1\ntheme = \"dark\"\nalpha = true\n[window]\ntheme = \"light\"\nextra = 1\n",
        );
        assert_eq!(settings.theme, ThemeSetting::Dark);
        assert_eq!(
            issues,
            vec![
                SettingsIssue::UnknownKey("alpha".into()),
                SettingsIssue::UnknownKey("window".into()),
                SettingsIssue::UnknownKey("zebra".into())
            ]
        );
        assert_eq!(
            parse_settings("[window]\ntheme = \"light\"").0,
            Settings::default()
        );
    }
    #[test]
    fn syntax_errors_and_duplicate_keys_discard_all_settings_with_one_located_issue() {
        for text in [
            "theme = \"dark\"\nbroken = [",
            "theme = \"dark\"\ntheme = \"light\"",
        ] {
            let (settings, issues) = parse_settings(text);
            assert_eq!(settings, Settings::default());
            assert_eq!(issues.len(), 1);
            let SettingsIssue::Syntax(message) = &issues[0] else {
                panic!("expected syntax issue")
            };
            assert!(message.contains("line 2"), "{message}");
            assert!(!message.chars().any(char::is_control));
        }
    }
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "mjp-settings-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> PathBuf {
            self.0.join("config.toml")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(unix)]
    #[test]
    fn missing_config_is_silent_but_a_dangling_leaf_link_is_reported() {
        let fixture = Fixture::new();
        assert_eq!(
            load_settings(&fixture.path()),
            (Settings::default(), vec![])
        );
        std::os::unix::fs::symlink(fixture.0.join("missing"), fixture.path()).unwrap();
        let (settings, warnings) = load_settings(&fixture.path());
        assert_eq!(settings, Settings::default());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("symbolic link"));
        assert!(warnings[0].contains(&fixture.path().display().to_string()));
        let parent_link = fixture.0.join("parent");
        std::os::unix::fs::symlink(fixture.0.join("absent"), &parent_link).unwrap();
        assert!(load_settings(&parent_link.join("config.toml")).1.is_empty());
    }
    #[cfg(unix)]
    #[test]
    fn unreadable_nonregular_and_invalid_utf8_config_each_report_one_warning() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        let path = fixture.path();
        std::fs::create_dir(&path).unwrap();
        assert_eq!(load_settings(&path).1.len(), 1);
        std::fs::remove_dir(&path).unwrap();
        std::fs::write(&path, [0xff]).unwrap();
        assert_eq!(load_settings(&path).1.len(), 1);
        std::fs::write(&path, "theme = \"dark\"").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0)).unwrap();
        let result = load_settings(&path);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(result.0, Settings::default());
        assert_eq!(result.1.len(), 1);
        assert!(result.1[0].contains(&path.display().to_string()));
    }
    #[test]
    fn config_accepts_exactly_64_kib_and_reports_the_limit_beyond_it() {
        let fixture = Fixture::new();
        let mut text = String::from("theme = \"dark\"\n");
        text.extend(std::iter::repeat_n(' ', 65536 - text.len()));
        std::fs::write(fixture.path(), &text).unwrap();
        assert_eq!(
            load_settings(&fixture.path()),
            (
                Settings {
                    theme: ThemeSetting::Dark
                },
                vec![]
            )
        );
        std::fs::write(fixture.path(), format!("{text} ")).unwrap();
        let (settings, warnings) = load_settings(&fixture.path());
        assert_eq!(settings, Settings::default());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("max 64 KiB"));
    }
    #[cfg(unix)]
    #[test]
    fn config_follows_regular_file_links_and_rejects_fifo_without_blocking() {
        use std::{ffi::CString, os::unix::ffi::OsStrExt, sync::mpsc, time::Duration};
        let fixture = Fixture::new();
        let target = fixture.0.join("target");
        std::fs::write(&target, "theme = \"light\"").unwrap();
        std::os::unix::fs::symlink(&target, fixture.path()).unwrap();
        assert_eq!(
            load_settings(&fixture.path()),
            (
                Settings {
                    theme: ThemeSetting::Light
                },
                vec![]
            )
        );
        std::fs::remove_file(fixture.path()).unwrap();
        let fifo = CString::new(fixture.path().as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
        let path = fixture.path();
        let (sender, receiver) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let _ = sender.send(load_settings(&path));
        });
        let (settings, warnings) = receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("reading config FIFO blocked");
        worker.join().unwrap();
        assert_eq!(settings, Settings::default());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("regular file"));
    }

    #[test]
    fn loaded_parse_issues_include_the_path_and_keep_valid_settings() {
        let fixture = Fixture::new();
        std::fs::write(fixture.path(), "theme = \"dark\"\nextra = true").unwrap();
        let (settings, warnings) = load_settings(&fixture.path());
        assert_eq!(settings.theme, ThemeSetting::Dark);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("unknown setting: extra"));
        assert!(warnings[0].starts_with(&fixture.path().display().to_string()));
    }
    #[test]
    fn theme_settings_map_to_native_appearance_preferences() {
        assert_eq!(ThemeSetting::System.native_theme(), None);
        assert_eq!(
            ThemeSetting::Light.native_theme(),
            Some(tauri::Theme::Light)
        );
        assert_eq!(ThemeSetting::Dark.native_theme(), Some(tauri::Theme::Dark));
    }
}
