use std::{
    io::Write,
    process::{Command, Output, Stdio},
};

fn run(args: &[&str], input: &[u8]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_mjp"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let written = stdin.write_all(input);
    drop(stdin);
    if let Err(error) = written {
        assert_eq!(error.kind(), std::io::ErrorKind::BrokenPipe);
    }
    child.wait_with_output().unwrap()
}

#[test]
fn help_and_version_do_not_try_to_preview_piped_input() {
    for arg in ["--help", "--version"] {
        let output = run(&[arg], &[0xff]);
        assert!(output.status.success());
        assert!(output.stderr.is_empty());
        assert!(String::from_utf8(output.stdout).unwrap().contains("mjp"));
    }
}

#[test]
fn implicit_and_explicit_stdin_report_invalid_utf8_before_starting_a_window() {
    for args in [&[][..], &["-"][..]] {
        let output = run(args, &[0xff]);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8(output.stderr)
            .unwrap()
            .contains("stdin: input is not valid UTF-8"));
    }
}

#[test]
fn oversized_stdin_is_rejected_before_starting_a_window() {
    let output = run(&[], &vec![b'a'; 10 * 1024 * 1024 + 1]);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("stdin: input is too large (max 10 MiB)"));
}

#[test]
fn an_explicit_file_takes_precedence_over_piped_input() {
    let missing = std::env::temp_dir().join(format!("mjp-cli-missing-{}.md", std::process::id()));
    let output = run(&[missing.to_str().unwrap()], &[0xff]);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("file not found"));
}
