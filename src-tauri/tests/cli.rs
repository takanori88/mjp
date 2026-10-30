use std::{
    io::Write,
    process::{Command, Output, Stdio},
};

fn run(args: &[&str], input: &[u8]) -> Output {
    run_with_env(args, input, &[])
}

fn run_with_env(args: &[&str], input: &[u8], env: &[(&str, &str)]) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_mjp"))
        .args(args)
        .env_remove("MJP_APP")
        .env_remove("MJP_GUI_CHILD")
        .envs(env.iter().copied())
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

#[test]
fn explicit_cli_arguments_take_precedence_over_the_bundle_app_hint() {
    for arg in ["--help", "--version"] {
        let output = run_with_env(&[arg], &[0xff], &[("MJP_APP", "1")]);
        assert!(output.status.success());
        assert!(output.stderr.is_empty());
    }
    let output = run_with_env(&["-"], &[0xff], &[("MJP_APP", "1")]);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("stdin: input is not valid UTF-8"));
}

#[test]
fn a_gui_child_keeps_stdin_behavior_even_with_an_inherited_app_hint() {
    let output = run_with_env(&[], &[0xff], &[("MJP_APP", "1"), ("MJP_GUI_CHILD", "1")]);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("stdin: input is not valid UTF-8"));
}

#[test]
fn document_read_errors_keep_the_existing_path_and_reason_on_one_terminal_line() {
    let root = std::env::temp_dir().join(format!("mjp-cli-read-errors-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let invalid = root.join("bad-utf8.md");
    let oversized = root.join("too-large.md");
    std::fs::write(&invalid, [0xff]).unwrap();
    std::fs::File::create(&oversized)
        .unwrap()
        .set_len(10 * 1024 * 1024 + 1)
        .unwrap();
    let cases = [
        (invalid, "file is not valid UTF-8"),
        (oversized, "file is too large (max 10 MiB)"),
        (root.join("missing.md"), "file not found"),
        (root.clone(), "not a regular file"),
    ];
    let outputs: Vec<_> = cases
        .iter()
        .map(|(path, _)| run(&[path.to_str().unwrap()], &[]))
        .collect();
    std::fs::remove_dir_all(&root).unwrap();
    for ((path, reason), output) in cases.iter().zip(outputs) {
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert_eq!(
            String::from_utf8(output.stderr).unwrap(),
            format!("mjp: {}: {reason}\n", path.display())
        );
    }
}
