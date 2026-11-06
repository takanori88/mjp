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
}
