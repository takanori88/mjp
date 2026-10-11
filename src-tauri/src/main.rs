mod cli;

#[cfg(target_os = "macos")]
mod launch;

fn main() {
    #[cfg(feature = "perf")]
    mjp_lib::perf::mark_now(if std::env::var_os("MJP_GUI_CHILD").is_some() {
        "gui_entry"
    } else {
        "cli_entry"
    });
    let input = match cli::parse(std::env::args_os().skip(1)) {
        Ok(cli::Command::Help) => {
            println!("{}", cli::HELP);
            return;
        }
        Ok(cli::Command::Version) => {
            println!("mjp {}", env!("CARGO_PKG_VERSION"));
            return;
        }
        Ok(cli::Command::Preview(path)) => path,
        Err(message) => {
            eprintln!("mjp: {message}");
            std::process::exit(2);
        }
    };
    let document = match mjp_lib::load_document([input]) {
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
        if let Err(error) = launch::spawn_gui(document.path()) {
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
