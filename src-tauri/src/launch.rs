use std::{
    io::{self, Write},
    os::unix::process::CommandExt,
    process::{Child, Command, Stdio},
};

pub const GUI_CHILD_ENV: &str = "MJP_GUI_CHILD";

pub fn spawn_gui(document: mjp_lib::Document) -> io::Result<()> {
    let executable = std::env::current_exe()?.canonicalize()?;
    let mut command = Command::new(executable);
    configure_child(&mut command);
    command
        .current_dir("/")
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    // Keep the pre-exec hook limited to setsid and errno capture.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                Err(io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }

    let text = if let Some(path) = document.path() {
        command.arg("--").arg(path);
        None
    } else {
        command.arg("-");
        Some(document.into_text().map_err(io::Error::other)?)
    };
    spawn_with_input(&mut command, text.as_deref()).map(|_| ())
}

fn configure_child(command: &mut Command) {
    command.env(GUI_CHILD_ENV, "1").env_remove("MJP_APP");
}

fn spawn_with_input(command: &mut Command, text: Option<&str>) -> io::Result<Child> {
    command.stdin(if text.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    let mut child = command.spawn()?;
    if let Some(text) = text {
        let mut stdin = child.stdin.take().expect("piped stdin is available");
        if let Err(error) = stdin.write_all(text.as_bytes()) {
            // A partial document must not become a preview after a failed handoff.
            let _ = child.kill();
            drop(stdin);
            let _ = child.wait();
            return Err(error);
        }
    }
    Ok(child)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn receiver(test: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", test, "--nocapture"])
            .env("MJP_TEST_STDIN_RECEIVER", "1")
            .stdout(Stdio::null());
        command
    }

    #[test]
    fn transfers_complete_text_larger_than_a_pipe_buffer_and_closes_input() {
        let text = "# 日本語\n\n```rust\nlet x = 1;\n```\n\t\r\n".repeat(50_000);
        if std::env::var_os("MJP_TEST_STDIN_RECEIVER").is_some() {
            let document = mjp_lib::load_stdin(io::stdin().lock()).unwrap();
            assert_eq!(document.into_text().unwrap(), text);
            return;
        }
        let mut command = receiver(
            "launch::tests::transfers_complete_text_larger_than_a_pipe_buffer_and_closes_input",
        );
        let mut child = spawn_with_input(&mut command, Some(&text)).unwrap();
        assert!(child.wait().unwrap().success());
    }

    #[test]
    fn returns_after_handoff_while_the_child_remains_running() {
        if std::env::var_os("MJP_TEST_STDIN_RECEIVER").is_some() {
            assert_eq!(
                mjp_lib::load_stdin(io::stdin().lock())
                    .unwrap()
                    .into_text()
                    .unwrap(),
                "preview"
            );
            std::thread::sleep(std::time::Duration::from_secs(30));
            return;
        }
        let mut command =
            receiver("launch::tests::returns_after_handoff_while_the_child_remains_running");
        let mut child = spawn_with_input(&mut command, Some("preview")).unwrap();
        let still_running = child.try_wait().unwrap().is_none();
        let _ = child.kill();
        child.wait().unwrap();
        assert!(still_running);
    }

    #[test]
    fn reports_a_child_that_closes_input_before_the_transfer_finishes() {
        let mut command = Command::new("/usr/bin/true");
        let error = spawn_with_input(&mut command, Some(&"x".repeat(2 * 1024 * 1024))).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::BrokenPipe);
    }
    #[test]
    fn detached_children_discard_the_launchservices_app_hint() {
        let mut command = Command::new("mjp");
        command.env("MJP_APP", "1");
        configure_child(&mut command);
        let env: std::collections::HashMap<_, _> = command.get_envs().collect();
        assert_eq!(env.get(std::ffi::OsStr::new("MJP_APP")), Some(&None));
        assert_eq!(
            env.get(std::ffi::OsStr::new(GUI_CHILD_ENV)),
            Some(&Some(std::ffi::OsStr::new("1")))
        );
    }
}
