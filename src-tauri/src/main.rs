mod cli;

use std::io::{self, IsTerminal};

#[cfg(target_os = "macos")]
mod launch;

fn main() {
    #[cfg(feature = "perf")]
    mjp_lib::perf::mark_now(if std::env::var_os("MJP_GUI_CHILD").is_some() {
        "gui_entry"
    } else {
        "cli_entry"
    });
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let mode = cli::startup_mode(
        std::env::var_os("MJP_GUI_CHILD").is_some(),
        !args.is_empty(),
        std::env::var_os("MJP_APP").is_some_and(|value| value == "1"),
    );
    if mode == cli::StartupMode::App {
        if let Err(error) = mjp_lib::run_app() {
            eprintln!("mjp: {error}");
            std::process::exit(1);
        }
        return;
    }
    let stdin = io::stdin();
    let input = match cli::parse(args, stdin.is_terminal()) {
        Ok(cli::Command::Help) => {
            println!("{}", cli::HELP);
            return;
        }
        Ok(cli::Command::Version) => {
            println!("mjp {}", env!("CARGO_PKG_VERSION"));
            return;
        }
        Ok(cli::Command::Preview(path)) => mjp_lib::load_document([path]),
        Ok(cli::Command::Stdin) => mjp_lib::load_stdin(stdin.lock()),
        Err(message) => {
            eprintln!("mjp: {message}");
            std::process::exit(2);
        }
    };
    let document = match input {
        Ok(document) => document,
        Err(message) => {
            eprintln!("mjp: {message}");
            std::process::exit(2);
        }
    };
    #[cfg(feature = "perf")]
    mjp_lib::perf::mark_now("document_loaded");

    #[cfg(target_os = "macos")]
    if !cfg!(debug_assertions) && std::env::var_os(launch::GUI_CHILD_ENV).is_none() {
        if let Err(error) = launch::spawn_gui(document) {
            eprintln!("mjp: cannot start preview: {error}");
            std::process::exit(1);
        }
        #[cfg(feature = "perf")]
        mjp_lib::perf::mark_now("cli_return");
        return;
    }

    if let Err(error) = mjp_lib::run(document) {
        eprintln!("mjp: {error}");
        std::process::exit(1);
    }
}
