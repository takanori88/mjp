use std::ffi::OsString;

pub const HELP: &str = "mjp — Markdown. Just Preview.

Usage: mjp [--] <file>
       mjp --help
       mjp --version

Open one UTF-8 text file (up to 10 MiB) in a preview window.
Use -- before a file name that begins with a dash.

Options:
  -h, --help     Show this help
  -V, --version  Show the version";

#[derive(Debug, PartialEq)]
pub enum Command {
    Preview(OsString),
    Help,
    Version,
}

pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Command, String> {
    let mut args = args.into_iter();
    let first = args.next().ok_or("usage: mjp [--] <file> (try --help)")?;
    let command = match first.to_str() {
        Some("--") => Command::Preview(args.next().ok_or("expected a file after --")?),
        Some("-h" | "--help") => Command::Help,
        Some("-V" | "--version") => Command::Version,
        Some(option) if option.starts_with('-') => {
            return Err(format!("unknown option: {option} (try --help)"));
        }
        _ => Command::Preview(first),
    };
    if args.next().is_some() {
        return Err("expected exactly one file or one option (try --help)".into());
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_text(args: &[&str]) -> Result<Command, String> {
        parse(args.iter().map(OsString::from))
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
    }

    #[test]
    fn rejects_missing_paths_and_extra_arguments() {
        for args in [
            vec![],
            vec!["--"],
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
        assert_eq!(parse([path.clone()]), Ok(Command::Preview(path)));
    }
}
