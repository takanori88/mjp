#[cfg(target_os = "macos")]
mod launch;

fn main() {
    #[cfg(feature = "perf")]
    mdq_lib::perf::mark_now(if std::env::var_os("MDQ_GUI_CHILD").is_some() {
        "gui_entry"
    } else {
        "cli_entry"
    });
    let document = match mdq_lib::load_document(std::env::args_os().skip(1)) {
        Ok(document) => document,
        Err(message) => {
            eprintln!("mdq: {message}");
            std::process::exit(2);
        }
    };
    #[cfg(feature = "perf")]
    mdq_lib::perf::mark_now("document_loaded");

    #[cfg(target_os = "macos")]
    if !cfg!(debug_assertions) && std::env::var_os(launch::GUI_CHILD_ENV).is_none() {
        if let Err(error) = launch::spawn_gui(document.path()) {
            eprintln!("mdq: cannot start preview: {error}");
            std::process::exit(1);
        }
        #[cfg(feature = "perf")]
        mdq_lib::perf::mark_now("cli_return");
        return;
    }

    if let Err(error) = mdq_lib::run(document) {
        eprintln!("mdq: {error}");
        std::process::exit(1);
    }
}
