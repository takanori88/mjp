# mjp

[日本語](docs/ja/README.md)

**Markdown. Just Preview.**

`mjp` opens Markdown files in small GUI windows from your terminal or macOS Finder. It is for reading a file quickly, without opening an editor or adding editing controls. On macOS, the release CLI returns to your shell while the preview window stays open.

```sh
mjp README.md
```

![mjp displaying a Markdown README in a dark macOS preview window](docs/images/mjp-preview.png)

## Features

- Renders Markdown, including tables and task lists, with one preview per file.
- Opens `.md` and `.markdown` files from macOS Finder.
- Highlights fenced code blocks for common languages.
- Copies fenced code blocks with a button or keyboard activation.
- Displays local PNG, JPEG, GIF, and WebP images referenced in Markdown.
- Follows the system light or dark appearance.
- Reloads the preview when the file changes, preserving the scroll position when possible.
- Supports keyboard navigation and quick closing.
- Returns the shell prompt immediately after opening the window in a macOS release build.

## Usage

```sh
mjp <file>
command | mjp
mjp < README.md
```

Pass exactly one path to a readable, regular UTF-8 file of at most 10 MiB. Relative and absolute paths work. The file extension is not restricted. Errors are printed in the terminal before a window opens. Use `mjp --help` (`-h`) for usage and `mjp --version` (`-V`) for the version. Use `mjp -- -notes.md` to open a file whose name starts with a dash.

With no arguments, `mjp` reads piped or redirected standard input once until EOF, then opens a single preview titled `stdin — mjp`. `mjp -` explicitly selects the same input. Standard input must be UTF-8 and at most 10 MiB; empty input opens an empty preview. On macOS release builds, the CLI returns after handing the text to the GUI, and the window stays open after the producer exits. Standard-input previews do not watch a file or load local images; image alt text remains visible. To preview edits, open the file with `mjp <file>`; saving it updates the preview.

Running `mjp` with no arguments at a terminal shows help. `mjp -` at a terminal reports an error instead of waiting for typed input. An explicit file takes precedence over piped input; use `mjp -- -` to open a file literally named `-`.

Documents up to 128 KiB are formatted as Markdown. Larger documents show their complete source as plain text, with a notice, to keep initial display quick. File previews support live reload in both modes.

Links with `http:`, `https:`, or `mailto:` URLs open in the system's default app. Relative file links are not opened. Raw HTML remains plain text.

### Opening files from Finder

After [installing the app](#installation), select a `.md` or `.markdown` file in Finder and choose **Open With → mjp**. You can also make mjp the default app using the installation steps below, then double-click files to preview them.

The app opens a separate window for each file. Opening the same file again brings its existing window to the front; duplicate requests during a load share that load. Each open request processes its first 10 selected inputs. Excess inputs and files that cannot be read appear together in one **Files that could not be opened** window, with up to 10 details and an omitted count. Correct the file or request, then open it again to retry. Files that opened successfully continue to reload after saves; a later read failure appears in that preview's error banner and clears when the file recovers.

Launching `mjp.app` without a file shows a welcome window with usage instructions. It closes after a document window is successfully created. Each preview closes independently, and mjp exits after the last window closes and all accepted open requests finish. `⌘Q` or **Quit** exits the entire process, including while a file is loading.

The CLI starts with one preview in its own process. Normal Finder launches are expected to deliver files to the existing app instance. Directly using the executable inside `mjp.app` as a CLI can create multiple instances; any CLI child that receives an OS open request adds windows in that same process. For terminal use, install the separate command in `~/.local/bin` as shown below.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Esc`, `q`, `⌘W` | Close the current preview on macOS. |
| `⌘Q` | Quit all windows in this mjp process. |
| `j`, `k` | Scroll down or up. |
| `Ctrl+D`, `Ctrl+U` | Scroll down or up by half a window. |
| `gg` | Jump to the top (press the two `g` keys within one second). |
| `G` (`Shift+G`) | Jump to the bottom. |

### Copying code

Each fenced code block has a copy button; click it, or press Enter or Space while it has focus. The copied text keeps indentation and trailing newlines, but leaves out control characters and other invisible characters that the preview does not display. Inline code, indented code blocks, and the large-file plain-text view have no button, and reading shortcuts such as `j` are inactive while a button has focus.

### Local images

Use Markdown image syntax, for example `![Preview](images/preview.png)`, with paths relative to the Markdown file. In a Git working tree, images may come from anywhere within the nearest repository root, such as `../images/preview.png`; otherwise they must be in the Markdown file's directory or below it. Symlinks, absolute paths, remote URLs, data URLs, and SVG are not loaded, and unavailable images show their alt text.

Each image is limited to 10 MiB, and a document loads at most 64 image references and 32 MiB of distinct image data. Image files are not watched: after editing only an image, close and reopen the preview, or change and save the Markdown text.

### Yazi + Neovim + mjp

Use Yazi to select a file, Neovim to edit it, and `mjp` to preview saved changes in a separate window. The tools work together through the file; no editor plugin is needed.

This workflow was manually confirmed with Yazi 26.1.22 and the macOS release build of `mjp`. Make sure `mjp` and `nvim` are on your `PATH`. Merge the following into `~/.config/yazi/yazi.toml`, reusing existing sections rather than duplicating them:

```toml
[opener]
markdown = [
  { run = 'mjp -- %s1 && nvim -- %s1', desc = "nvim + mjp", block = true, for = "macos" },
]

[open]
prepend_rules = [
  { url = "*.md", use = "markdown" },
  { url = "*.markdown", use = "markdown" },
]
```

If you already define `open.rules`, you can instead insert these two Markdown rules at the start of that list, before any `text/*` rule, keeping the remaining rules. The `%s1` placeholder passes the first selected file. See [Yazi's opener configuration](https://yazi-rs.github.io/docs/configuration/yazi/#opener) for the configuration syntax. An existing Yazi pane previewer such as `piper` with `bat` can stay in place.

1. Restart Yazi, select one local Markdown file, and press Enter.
2. **mjp takes focus when its window opens. Switch back to the terminal before editing in Neovim.**
3. Save with `:w`; mjp updates the preview automatically.
4. Quit Neovim to return to Yazi. The preview stays open; focus it and press `Esc` or `q` when finished.

The macOS release CLI detaches the preview itself, so `&&` can start Neovim after the CLI succeeds. `block = true` lets Neovim use the terminal until it exits; no `&` or `orphan = true` is needed for this opener. This workflow assumes a release build, not `tauri dev`.

## Installation

The initial distribution is source-only, for macOS Apple Silicon. There is no published binary, installer, or Homebrew package yet.

Windows and Linux support is planned for a later phase; neither is currently supported.

Install [Xcode Command Line Tools](https://v2.tauri.app/start/prerequisites/#macos), Rust 1.90 or newer, and Node.js 24.x (24.22.1 or newer), with npm. Then build from the repository root:

```sh
git clone https://github.com/takanori88/mjp.git
cd mjp
npm ci
npm run build:release -- --bundles app -- --locked
./src-tauri/target/release/mjp README.md
```

The built command is `src-tauri/target/release/mjp`. The app bundle is `src-tauri/target/release/bundle/macos/mjp.app`.

To install the Finder app:

1. In Finder, copy `src-tauri/target/release/bundle/macos/mjp.app` to `/Applications`, giving `/Applications/mjp.app`.
2. Select a `.md` file and choose **File → Get Info** (`⌘I`).
3. Under **Open with**, select **mjp** (use **Other…** to find `/Applications/mjp.app` if needed), then click **Change All…** and confirm.
4. Repeat for a `.markdown` file if you use that extension. Double-click a file to open its preview.

To update the app, quit mjp and replace `/Applications/mjp.app` with a fresh build. Remove that bundle to uninstall the Finder app; the CLI is installed separately.

To install the CLI for your user account:

```sh
mkdir -p "$HOME/.local/bin"
install -m 755 src-tauri/target/release/mjp "$HOME/.local/bin/mjp"
export PATH="$HOME/.local/bin:$PATH"
mjp --version
mjp README.md
```

Add the `export PATH` line to your shell startup file (for example, `~/.zshrc`) to keep it for new terminals. Rebuild and repeat `install` to update; remove `~/.local/bin/mjp` to uninstall. The installed command needs neither Node.js nor Rust at runtime.

Use the copy in `~/.local/bin` for CLI workflows and `/Applications/mjp.app` for Finder. Builds made here are not Developer ID signed or notarized. Binary distribution and its installation experience are deferred.

Use `build:release` for binaries you intend to share. It remaps the build machine's home, Cargo, Rustup, and checkout paths to generic `/build/` paths during compilation, including dependencies. Existing environment-supplied compiler flags are preserved. Direct `cargo build` or `tauri build` commands do not apply this remapping. Check the final executable before distribution because generated strings and linker output may contain other paths.

## Development

The app uses Tauri 2 and Rust for the CLI, window, and file watching, with Vanilla TypeScript, Vite, markdown-it, DOMPurify, and highlight.js for the preview. Development currently targets macOS Apple Silicon. Use Rust 1.90 or newer, Node.js 24.22.1 or newer within the 24.x line, npm, and the macOS development tools required by Tauri. DOM tests use jsdom and Node's built-in test runner with TypeScript support.

```sh
npm ci
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run build:release -- --bundles app -- --locked
```

See [PROJECT.md](docs/en/PROJECT.md) for the product goals, [PLAN.md](docs/en/PLAN.md) for implementation decisions, and [PERFORMANCE.md](docs/en/PERFORMANCE.md) for measurements.

English is the canonical documentation language. Detailed documents are under [docs/en/](docs/en/), with this README kept at the repository root. Japanese versions are under [docs/ja/](docs/ja/README.md).

## License

mjp is licensed under the [MIT License](LICENSE), copyright 2026 takanori88. Dependencies retain their own licenses; see [third-party dependencies](docs/en/THIRD_PARTY.md). See [RELEASING.md](docs/en/RELEASING.md) for the source-publication procedure.
