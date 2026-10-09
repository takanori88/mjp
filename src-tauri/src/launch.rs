use std::{
    io,
    os::unix::process::CommandExt,
    path::Path,
    process::{Command, Stdio},
};

pub const GUI_CHILD_ENV: &str = "MJP_GUI_CHILD";

pub fn spawn_gui(path: &Path) -> io::Result<()> {
    let executable = std::env::current_exe()?.canonicalize()?;
    let mut command = Command::new(executable);
    command
        .arg(path)
        .env(GUI_CHILD_ENV, "1")
        .current_dir("/")
        .stdin(Stdio::null())
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

    command.spawn().map(|_| ())
}
