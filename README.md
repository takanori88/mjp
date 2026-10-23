# mjp

[日本語](docs/ja/README.md)

**Markdown. Just Preview.**

`mjp` opens a Markdown file in a small GUI window from your terminal. It is for reading a file quickly, without opening an editor or adding editing controls. On macOS, the release CLI returns to your shell while the preview window stays open.

```sh
mjp README.md
```

![mjp displaying a Markdown README in a dark macOS preview window](docs/images/mjp-preview.png)

## Features

- Renders Markdown, including tables and task lists, in a single window.
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
```

Pass exactly one path to a readable, regular UTF-8 file of at most 10 MiB. Relative and absolute paths work. The file extension is not restricted. Errors are printed in the terminal before a window opens. Use `mjp --help` (`-h`) for usage and `mjp --version` (`-V`) for the version. Use `mjp -- -notes.md` to open a file whose name starts with a dash.

Files up to 128 KiB are formatted as Markdown. Larger files show their complete source as plain text, with a notice, to keep initial display quick. Live reload works in both modes.

Links with `http:`, `https:`, or `mailto:` URLs open in the system's default app. Relative file links are not opened. Raw HTML remains plain text.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Esc`, `q`, `⌘W` | Close the preview on macOS. |
| `j`, `k` | Scroll down or up. |
| `Ctrl+D`, `Ctrl+U` | Scroll down or up by half a window. |
| `gg` | Jump to the top (press the two `g` keys within one second). |
| `G` (`Shift+G`) | Jump to the bottom. |

### Copying code

Each fenced code block has a copy button; click it, or press Enter or Space while it has focus. The copied text keeps indentation and trailing newlines, but leaves out control characters and other invisible characters that the preview does not display. Inline code, indented code blocks, and the large-file plain-text view have no button, and reading shortcuts such as `j` are inactive while a button has focus.

### Local images

Use Markdown image syntax, for example `![Preview](images/preview.png)`, with paths relative to the Markdown file. In a Git working tree, images may come from anywhere within the nearest repository root, such as `../images/preview.png`; otherwise they must be in the Markdown file's directory or below it. Symlinks, absolute paths, remote URLs, data URLs, and SVG are not loaded, and unavailable images show their alt text.

Each image is limited to 10 MiB, and a document loads at most 64 image references and 32 MiB of distinct image data. Image files are not watched: after editing only an image, reopen the preview or change and save the Markdown text.

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

The built command is `mjp`. The app bundle is under `src-tauri/target/release/bundle/macos/`.

To install the CLI for your user account:

```sh
mkdir -p "$HOME/.local/bin"
install -m 755 src-tauri/target/release/mjp "$HOME/.local/bin/mjp"
export PATH="$HOME/.local/bin:$PATH"
mjp --version
mjp README.md
```

Add the `export PATH` line to your shell startup file (for example, `~/.zshrc`) to keep it for new terminals. Rebuild and repeat `install` to update; remove `~/.local/bin/mjp` to uninstall. The installed command needs neither Node.js nor Rust at runtime.

The `.app` contains the same command at `mjp.app/Contents/MacOS/mjp`; pass it a file from the terminal. Opening it in Finder is not a file-selection workflow. Builds made here are not Developer ID signed or notarized. Binary distribution and its installation experience are deferred.

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
