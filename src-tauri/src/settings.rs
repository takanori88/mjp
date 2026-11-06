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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowPosition {
    TopRight,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct WindowSettings {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub position: Option<WindowPosition>,
    pub margin_x: Option<u32>,
    pub margin_y: Option<u32>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Settings {
    pub theme: ThemeSetting,
    pub window: WindowSettings,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum SettingsIssue {
    InvalidTheme,
    InvalidWindow,
    InvalidWindowPosition,
    InvalidWindowDimension(&'static str),
    InvalidWindowMargin(&'static str),
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
        } else if key.get_ref() == "window" {
            if let Some(window) = value.get_ref().as_table() {
                for (key, value) in window.iter() {
                    if key.get_ref() == "position" {
                        settings.window.position = value
                            .get_ref()
                            .as_str()
                            .filter(|value| *value == "top-right")
                            .map(|_| WindowPosition::TopRight);
                        if settings.window.position.is_none() {
                            issues.push(SettingsIssue::InvalidWindowPosition);
                        }
                        continue;
                    }
                    let (name, dimension, minimum) = match key.get_ref().as_ref() {
                        "width" => ("width", &mut settings.window.width, 1),
                        "height" => ("height", &mut settings.window.height, 1),
                        "margin_x" => ("margin_x", &mut settings.window.margin_x, 0),
                        "margin_y" => ("margin_y", &mut settings.window.margin_y, 0),
                        _ => {
                            issues.push(SettingsIssue::UnknownKey(format!(
                                "window.{}",
                                key.get_ref()
                            )));
                            continue;
                        }
                    };
                    if matches!(value.get_ref(), toml::de::DeValue::Integer(_)) {
                        let raw = &text[value.span()];
                        if !raw.is_empty() && raw.bytes().all(|byte| byte.is_ascii_digit()) {
                            *dimension = raw.parse().ok().filter(|value| *value >= minimum);
                        }
                    }
                    if dimension.is_none() {
                        issues.push(if minimum == 0 {
                            SettingsIssue::InvalidWindowMargin(name)
                        } else {
                            SettingsIssue::InvalidWindowDimension(name)
                        });
                    }
                }
            } else {
                issues.push(SettingsIssue::InvalidWindow);
            }
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
                        SettingsIssue::InvalidWindow => {
                            "window must be a table; using default window settings".into()
                        }
                        SettingsIssue::InvalidWindowPosition => {
                            "window.position must be top-right; using centered placement".into()
                        }
                        SettingsIssue::InvalidWindowDimension(key) => {
                            let default = if key == "width" { 800 } else { 600 };
                            format!("window.{key} must use ASCII digits only and be from 1 to 4294967295; using {default}")
                        }
                        SettingsIssue::InvalidWindowMargin(key) => {
                            format!("window.{key} must use ASCII digits only and be from 0 to 4294967295; using 16")
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
    fn omitted_or_empty_window_uses_defaults_without_issues() {
        for text in ["", "theme = \"system\"", "[window]", "window = {}"] {
            let (settings, issues) = parse_settings(text);
            assert_eq!(settings.window.width, None);
            assert_eq!(settings.window.height, None);
            assert!(issues.is_empty(), "{text}: {issues:?}");
        }
    }

    #[test]
    fn a_single_window_dimension_keeps_the_other_unspecified() {
        for (key, expected) in [
            (
                "width",
                WindowSettings {
                    width: Some(1000),
                    height: None,
                    ..WindowSettings::default()
                },
            ),
            (
                "height",
                WindowSettings {
                    width: None,
                    height: Some(1000),
                    ..WindowSettings::default()
                },
            ),
        ] {
            let (settings, issues) = parse_settings(&format!("[window]\n{key} = 1000"));
            assert_eq!(settings.window, expected);
            assert!(issues.is_empty());
        }
    }

    #[test]
    fn top_right_position_is_opt_in_without_warnings() {
        let (settings, issues) = parse_settings("[window]\nposition = \"top-right\"");
        assert_eq!(settings.window.position, Some(WindowPosition::TopRight));
        assert!(issues.is_empty());
        let (settings, issues) = parse_settings("");
        assert_eq!(settings.window.position, None);
        assert!(issues.is_empty());
    }

    #[test]
    fn invalid_positions_report_one_issue_and_keep_independent_settings() {
        for value in ["\"Top-Right\"", "\"top-left\"", "1", "true"] {
            let (settings, issues) = parse_settings(&format!(
                "theme = \"dark\"\n[window]\nwidth = 900\nposition = {value}"
            ));
            assert_eq!(settings.window.position, None);
            assert_eq!(settings.window.width, Some(900));
            assert_eq!(settings.theme, ThemeSetting::Dark);
            assert_eq!(issues, vec![SettingsIssue::InvalidWindowPosition]);
        }
    }

    #[test]
    fn margins_accept_zero_and_unsigned_decimal_u32_values_only() {
        for key in ["margin_x", "margin_y"] {
            for (raw, expected) in [
                ("0", Some(0)),
                ("16", Some(16)),
                ("4294967295", Some(u32::MAX)),
                ("-1", None),
                ("+1", None),
                ("1_0", None),
                ("1.5", None),
                ("\"16\"", None),
                ("4294967296", None),
                ("true", None),
                ("0x10", None),
                ("[]", None),
                ("{}", None),
            ] {
                let (settings, issues) = parse_settings(&format!("[window]\n{key} = {raw}"));
                let actual = if key == "margin_x" {
                    settings.window.margin_x
                } else {
                    settings.window.margin_y
                };
                assert_eq!(actual, expected, "{key} = {raw}");
                assert_eq!(
                    issues,
                    if expected.is_some() {
                        vec![]
                    } else {
                        vec![SettingsIssue::InvalidWindowMargin(key)]
                    }
                );
            }
        }
    }

    #[test]
    fn zero_margins_do_not_make_zero_dimensions_valid() {
        let (settings, issues) =
            parse_settings("[window]\nwidth = 0\nheight = 0\nmargin_x = 0\nmargin_y = 0");
        assert_eq!(
            settings.window,
            WindowSettings {
                margin_x: Some(0),
                margin_y: Some(0),
                ..Default::default()
            }
        );
        assert_eq!(
            issues,
            vec![
                SettingsIssue::InvalidWindowDimension("height"),
                SettingsIssue::InvalidWindowDimension("width")
            ]
        );
    }

    #[test]
    fn margins_without_position_are_retained_without_warnings() {
        let (settings, issues) = parse_settings("[window]\nmargin_x = 12\nmargin_y = 34");
        assert_eq!(
            settings.window,
            WindowSettings {
                margin_x: Some(12),
                margin_y: Some(34),
                ..Default::default()
            }
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn placement_fields_keep_their_meaning_in_all_table_forms() {
        for margin in ["16", "+16", "1_6"] {
            for body in [
                format!("[window]\r\nposition = \"top-right\"\r\nmargin_x = {margin} # 余白\r\nmargin_y = 0"),
                format!("window = {{ position = \"top-right\", margin_x = {margin}, margin_y = 0 }}"),
                format!("window.position = \"top-right\"\r\nwindow.margin_x = {margin} # 余白\r\nwindow.margin_y = 0"),
            ] {
                let (settings, issues) = parse_settings(&format!("# 日本語\r\n{body}"));
                assert_eq!(settings.window, WindowSettings { position: Some(WindowPosition::TopRight), margin_x: (margin == "16").then_some(16), margin_y: Some(0), ..Default::default() });
                assert_eq!(issues, if margin == "16" { vec![] } else { vec![SettingsIssue::InvalidWindowMargin("margin_x")] }, "{body}");
            }
        }
    }

    #[test]
    fn mixed_placement_issues_keep_valid_fields_and_lexical_warning_order() {
        let (settings, issues) = parse_settings("zebra = 1\ntheme = true\n[window]\nwidth = 900\nheight = 0\nposition = true\nmargin_y = 16\nmargin_x = -1\nextra = 1");
        assert_eq!(
            settings.window,
            WindowSettings {
                width: Some(900),
                margin_y: Some(16),
                ..Default::default()
            }
        );
        assert_eq!(
            issues,
            vec![
                SettingsIssue::InvalidTheme,
                SettingsIssue::UnknownKey("window.extra".into()),
                SettingsIssue::InvalidWindowDimension("height"),
                SettingsIssue::InvalidWindowMargin("margin_x"),
                SettingsIssue::InvalidWindowPosition,
                SettingsIssue::UnknownKey("zebra".into())
            ]
        );
    }

    #[test]
    fn malformed_placement_toml_discards_all_settings() {
        for body in [
            "margin_x = 01",
            "margin_y = 1__0",
            "position = \"top-right\"\nposition = \"top-right\"",
        ] {
            let (settings, issues) =
                parse_settings(&format!("theme = \"dark\"\n[window]\nwidth = 900\n{body}"));
            assert_eq!(settings, Settings::default());
            assert!(matches!(issues.as_slice(), [SettingsIssue::Syntax(_)]));
        }
    }

    #[test]
    fn window_dimensions_accept_the_positive_u32_boundaries_and_default_width() {
        for value in [1, 800, u32::MAX] {
            let (settings, issues) =
                parse_settings(&format!("[window]\nwidth = {value}\nheight = {value}"));
            assert_eq!(
                settings.window,
                WindowSettings {
                    width: Some(value),
                    height: Some(value),
                    ..WindowSettings::default()
                }
            );
            assert!(issues.is_empty());
        }
    }

    fn assert_invalid_dimension_keeps_other_settings(value: &str) {
        for (key, other) in [("width", "height"), ("height", "width")] {
            let (settings, issues) = parse_settings(&format!(
                "theme = \"dark\"\n[window]\n{key} = {value}\n{other} = 900"
            ));
            assert_eq!(settings.theme, ThemeSetting::Dark);
            assert_eq!(
                settings.window,
                if key == "width" {
                    WindowSettings {
                        width: None,
                        height: Some(900),
                        ..WindowSettings::default()
                    }
                } else {
                    WindowSettings {
                        width: Some(900),
                        height: None,
                        ..WindowSettings::default()
                    }
                },
                "{key} = {value}"
            );
            assert_eq!(issues, vec![SettingsIssue::InvalidWindowDimension(key)]);
        }
    }

    #[test]
    fn invalid_window_ranges_report_each_dimension_and_keep_independent_settings() {
        for value in ["0", "4294967296", "-1", "-0", "9223372036854775808"] {
            assert_invalid_dimension_keeps_other_settings(value);
        }
        assert_eq!(
            parse_settings("[window]\nwidth = 0\nheight = -1"),
            (
                Settings::default(),
                vec![
                    SettingsIssue::InvalidWindowDimension("height"),
                    SettingsIssue::InvalidWindowDimension("width")
                ]
            )
        );
        let (settings, issues) =
            parse_settings("theme = true\n[window]\nwidth = 900\nheight = 700");
        assert_eq!(settings.theme, ThemeSetting::System);
        assert_eq!(
            settings.window,
            WindowSettings {
                width: Some(900),
                height: Some(700),
                ..WindowSettings::default()
            }
        );
        assert_eq!(issues, vec![SettingsIssue::InvalidTheme]);
    }

    #[test]
    fn window_dimensions_require_unsigned_unseparated_decimal_spelling() {
        for value in ["+1000", "1_000", "0x3e8", "0o1750", "0b1111101000"] {
            assert_invalid_dimension_keeps_other_settings(value);
        }
    }

    #[test]
    fn noninteger_window_dimensions_report_only_the_invalid_field() {
        for value in ["1000.0", "\"1000\"", "true", "[]", "{ a = 1 }"] {
            assert_invalid_dimension_keeps_other_settings(value);
        }
    }

    #[test]
    fn window_table_forms_preserve_each_values_original_spelling() {
        for (value, expected) in [("1000", Some(1000)), ("+1000", None), ("1_000", None)] {
            for (key, other) in [("width", "height"), ("height", "width")] {
                for body in [
                    format!("[window]\r\n{key} = {value}  # 寸法\r\n{other} = 900\r\n"),
                    format!("window = {{ {key} = {value}  , {other} = 900 }} # 寸法\r\n"),
                    format!("window.{key} = {value}  # 寸法\r\nwindow.{other} = 900\r\n"),
                ] {
                    let text = format!("# 日本語のコメント\r\ntheme = \"dark\"\r\n{body}");
                    let (settings, issues) = parse_settings(&text);
                    assert_eq!(settings.theme, ThemeSetting::Dark);
                    assert_eq!(
                        settings.window,
                        if key == "width" {
                            WindowSettings {
                                width: expected,
                                height: Some(900),
                                ..WindowSettings::default()
                            }
                        } else {
                            WindowSettings {
                                width: Some(900),
                                height: expected,
                                ..WindowSettings::default()
                            }
                        },
                        "{text}"
                    );
                    assert_eq!(
                        issues,
                        if expected.is_some() {
                            vec![]
                        } else {
                            vec![SettingsIssue::InvalidWindowDimension(key)]
                        },
                        "{text}"
                    );
                }
            }
        }
    }

    #[test]
    fn leading_utf8_bom_preserves_window_dimension_spelling_and_theme() {
        let (settings, issues) =
            parse_settings("\u{feff}theme = \"dark\"\n[window]\nwidth = 1000\nheight = 1_000");
        assert_eq!(
            settings,
            Settings {
                theme: ThemeSetting::Dark,
                window: WindowSettings {
                    width: Some(1000),
                    height: None,
                    ..WindowSettings::default()
                },
            }
        );
        assert_eq!(
            issues,
            vec![SettingsIssue::InvalidWindowDimension("height")]
        );
    }

    #[test]
    fn nontable_window_reports_one_issue_and_keeps_the_theme() {
        for body in ["window = 1", "window = []", "[[window]]\nwidth = 1000"] {
            let (settings, issues) = parse_settings(&format!("theme = \"dark\"\n{body}"));
            assert_eq!(settings.theme, ThemeSetting::Dark);
            assert_eq!(settings.window, WindowSettings::default());
            assert_eq!(issues, vec![SettingsIssue::InvalidWindow]);
        }
    }

    #[test]
    fn unknown_window_keys_are_reported_once_without_interpreting_their_values() {
        for value in [
            "1",
            "9223372036854775808",
            "99999999999999999999999999999999999999",
        ] {
            let (settings, issues) = parse_settings(&format!("theme = \"dark\"\n[window]\nwidth = 1000\nheight = 700\nplacement = {value}\nfont_size = 16\n[window.foo]\nwidth = 0\nextra = true"));
            assert_eq!(settings.theme, ThemeSetting::Dark);
            assert_eq!(
                settings.window,
                WindowSettings {
                    width: Some(1000),
                    height: Some(700),
                    ..WindowSettings::default()
                }
            );
            assert_eq!(
                issues,
                vec![
                    SettingsIssue::UnknownKey("window.font_size".into()),
                    SettingsIssue::UnknownKey("window.foo".into()),
                    SettingsIssue::UnknownKey("window.placement".into()),
                ]
            );
        }
    }

    #[test]
    fn malformed_window_toml_discards_theme_and_both_dimensions() {
        for body in [
            "width = +0x3e8",
            "width = -0x3e8",
            "width = _1000",
            "width = 1000_",
            "width = 1__000",
            "width = 1000\nwidth = 900",
            "width = 01",
            "width = 1000\n[window.unknown]\nbroken = [",
        ] {
            let (settings, issues) =
                parse_settings(&format!("theme = \"dark\"\n[window]\nheight = 700\n{body}"));
            assert_eq!(settings, Settings::default(), "{body}");
            assert!(
                matches!(issues.as_slice(), [SettingsIssue::Syntax(_)]),
                "{body}: {issues:?}"
            );
        }
    }

    #[test]
    fn window_issues_occupy_their_lexical_position_among_top_level_issues() {
        let (settings, issues) = parse_settings("zebra = true\ntheme = 1\nalpha = 1\n[window]\nzebra = 1\nwidth = 0\nalpha = 1\nheight = false");
        assert_eq!(settings, Settings::default());
        assert_eq!(
            issues,
            vec![
                SettingsIssue::UnknownKey("alpha".into()),
                SettingsIssue::InvalidTheme,
                SettingsIssue::UnknownKey("window.alpha".into()),
                SettingsIssue::InvalidWindowDimension("height"),
                SettingsIssue::InvalidWindowDimension("width"),
                SettingsIssue::UnknownKey("window.zebra".into()),
                SettingsIssue::UnknownKey("zebra".into()),
            ]
        );
    }

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
                (
                    Settings {
                        theme,
                        ..Settings::default()
                    },
                    vec![]
                )
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
                SettingsIssue::UnknownKey("window.extra".into()),
                SettingsIssue::UnknownKey("window.theme".into()),
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
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
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
                    theme: ThemeSetting::Dark,
                    ..Settings::default()
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
                    theme: ThemeSetting::Light,
                    ..Settings::default()
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
    fn loaded_window_issues_name_the_field_and_its_fallback() {
        let fixture = Fixture::new();
        for (text, messages) in [
            (
                "window = 1",
                vec!["window must be a table; using default window settings"],
            ),
            (
                "[window]\nwidth = 0\nheight = +1000\nfoo = true",
                vec![
                "unknown setting: window.foo",
                "window.height must use ASCII digits only and be from 1 to 4294967295; using 600",
                "window.width must use ASCII digits only and be from 1 to 4294967295; using 800",
            ],
            ),
        ] {
            std::fs::write(fixture.path(), text).unwrap();
            let (settings, warnings) = load_settings(&fixture.path());
            assert_eq!(settings, Settings::default());
            assert_eq!(
                warnings,
                messages
                    .into_iter()
                    .map(|message| format!("{}: {message}", fixture.path().display()))
                    .collect::<Vec<_>>()
            );
        }
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
    #[test]
    fn syntax_positions_count_unicode_columns_and_handle_crlf_eof_and_invalid_offsets() {
        let text = "# 日本語\r\ntheme = \"dark\"\r\n";
        assert_eq!(line_column(text, 0), (1, 1));
        assert_eq!(line_column(text, text.find('本').unwrap()), (1, 4));
        assert_eq!(line_column(text, text.find('本').unwrap() + 1), (1, 4));
        assert_eq!(line_column(text, text.find('\r').unwrap()), (1, 6));
        assert_eq!(line_column(text, text.find('\n').unwrap()), (1, 7));
        assert_eq!(line_column(text, text.find("theme").unwrap()), (2, 1));
        assert_eq!(line_column(text, text.len()), (3, 1));
        assert_eq!(line_column(text, usize::MAX), (3, 1));
        assert_eq!(line_column("日本語", 9), (1, 4));
        assert_eq!(line_column("", usize::MAX), (1, 1));
        for source in ["'日本語' = @", "# 日本語\r\nbad = @", "theme = "] {
            let offset = source.find('@').unwrap_or(source.len());
            let (line, column) = line_column(source, offset);
            let (_, issues) = parse_settings(source);
            let SettingsIssue::Syntax(message) = &issues[0] else {
                panic!("expected syntax issue")
            };
            assert!(
                message.ends_with(&format!("at line {line}, column {column}")),
                "{message}"
            );
        }
    }
}
