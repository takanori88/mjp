use std::ffi::OsString;

pub const HELP: &str = "mjp — Markdown. Just Preview.

Usage: mjp [--] <file>
       command | mjp
       mjp - < file
       mjp --help
       mjp --version

Open one UTF-8 text file (up to 10 MiB) in a preview window.
With no file, read piped or redirected UTF-8 input until EOF (up to 10 MiB).
With no arguments at a terminal, show this help. Use - to select stdin explicitly.
Use -- before a file name that begins with a dash.

Options:
  -h, --help     Show this help
  -V, --version  Show the version";

#[derive(Debug, PartialEq)]
pub enum StartupMode {
    GuiChild,
    Cli,
    App,
}

pub fn startup_mode(gui_child: bool, has_args: bool, app_hint: bool) -> StartupMode {
    if gui_child {
        StartupMode::GuiChild
    } else if has_args || !app_hint {
        StartupMode::Cli
    } else {
        StartupMode::App
    }
}

#[derive(Debug, PartialEq)]
pub enum Command {
    Preview(OsString),
    Stdin,
    Help,
    Version,
}

pub fn parse(
    args: impl IntoIterator<Item = OsString>,
    stdin_is_terminal: bool,
) -> Result<Command, String> {
    let mut args = args.into_iter();
    let Some(first) = args.next() else {
        return Ok(if stdin_is_terminal {
            Command::Help
        } else {
            Command::Stdin
        });
    };
    let command = match first.to_str() {
        Some("--") => Command::Preview(args.next().ok_or("expected a file after --")?),
        Some("-h" | "--help") => Command::Help,
        Some("-V" | "--version") => Command::Version,
        Some("-") => Command::Stdin,
        Some(option) if option.starts_with('-') => {
            return Err(format!("unknown option: {option} (try --help)"));
        }
        _ => Command::Preview(first),
    };
    if args.next().is_some() {
        return Err("expected exactly one file or one option (try --help)".into());
    }
    if command == Command::Stdin && stdin_is_terminal {
        return Err("stdin is a terminal; pipe or redirect UTF-8 text into mjp".into());
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_text(args: &[&str]) -> Result<Command, String> {
        parse(args.iter().map(OsString::from), false)
    }

    #[test]
    fn recognizes_help_and_version_without_a_file() {
        for option in ["-h", "--help"] {
            assert_eq!(parse_text(&[option]), Ok(Command::Help));
        }
        for option in ["-V", "--version"] {
            assert_eq!(parse_text(&[option]), Ok(Command::Version));
        }
    }

    #[test]
    fn keeps_paths_with_spaces_and_option_names_as_files() {
        for path in ["notes for today.md", "./--help", "/tmp/README.md"] {
            assert_eq!(parse_text(&[path]), Ok(Command::Preview(path.into())));
        }
        assert_eq!(
            parse_text(&["--", "--version"]),
            Ok(Command::Preview("--version".into()))
        );
        assert_eq!(parse_text(&["--", "-"]), Ok(Command::Preview("-".into())));
    }

    #[test]
    fn rejects_missing_paths_and_extra_arguments() {
        for args in [
            vec!["--"],
            vec!["-", "file"],
            vec!["one", "two"],
            vec!["--help", "file"],
            vec!["--version", "file"],
            vec!["--", "one", "two"],
        ] {
            assert!(parse_text(&args).is_err(), "{args:?}");
        }
    }

    #[test]
    fn rejects_unrecognized_options() {
        assert!(parse_text(&["--unknown"])
            .unwrap_err()
            .contains("unknown option"));
    }

    #[cfg(unix)]
    #[test]
    fn preserves_non_unicode_file_names() {
        use std::os::unix::ffi::OsStringExt;
        let path = OsString::from_vec(vec![b'.', b'/', 0xff]);
        assert_eq!(parse([path.clone()], false), Ok(Command::Preview(path)));
    }

    #[test]
    fn selects_stdin_only_for_implicit_or_explicit_stdin_input() {
        assert_eq!(parse_text(&[]), Ok(Command::Stdin));
        assert_eq!(parse_text(&["-"]), Ok(Command::Stdin));
        assert_eq!(
            parse_text(&["notes.md"]),
            Ok(Command::Preview("notes.md".into()))
        );
    }

    #[test]
    fn shows_help_at_a_terminal_without_waiting_for_input() {
        assert_eq!(parse([], true), Ok(Command::Help));
        assert!(parse(["-".into()], true)
            .unwrap_err()
            .contains("stdin is a terminal"));
        assert_eq!(
            parse(["notes.md".into()], true),
            Ok(Command::Preview("notes.md".into()))
        );
    }
    #[test]
    fn startup_prioritizes_the_gui_child_then_arguments_then_the_app_hint() {
        for (child, arguments, app, expected) in [
            (true, true, true, StartupMode::GuiChild),
            (true, false, true, StartupMode::GuiChild),
            (true, true, false, StartupMode::GuiChild),
            (true, false, false, StartupMode::GuiChild),
            (false, true, true, StartupMode::Cli),
            (false, true, false, StartupMode::Cli),
            (false, false, true, StartupMode::App),
            (false, false, false, StartupMode::Cli),
        ] {
            assert_eq!(startup_mode(child, arguments, app), expected);
        }
    }
}
