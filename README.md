# mjp

[日本語](docs/ja/README.md)

**Markdown. Just Preview.**

`mjp` opens a Markdown file in a small GUI window from your terminal. It is for reading a file quickly, without opening an editor or adding editing controls. On macOS, the release CLI returns to your shell while the preview window stays open.

```sh
mjp README.md
```

## Features

- Renders Markdown, including tables and task lists, in a single window.
- Highlights fenced code blocks for common languages.
- Follows the system light or dark appearance.
- Reloads the preview when the file changes, preserving the scroll position when possible.
- Supports keyboard navigation and quick closing.
- Returns the shell prompt immediately after opening the window in a macOS release build.

## Usage

```sh
mjp <file>
```

Pass exactly one path to a readable, regular UTF-8 file of at most 10 MiB. Relative and absolute paths work. The file extension is not restricted. Errors are printed in the terminal before a window opens. There are no CLI options yet.

Files up to 128 KiB are formatted as Markdown. Larger files show their complete source as plain text, with a notice, to keep initial display quick. Live reload works in both modes.

Links with `http:`, `https:`, or `mailto:` URLs open in the system's default app. Relative links and images are not opened or loaded in the current preview.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Esc`, `q`, `⌘W` | Close the preview on macOS. |
| `j`, `k` | Scroll down or up. |
| `Ctrl+D`, `Ctrl+U` | Scroll down or up by half a window. |
| `gg` | Jump to the top (press the two `g` keys within one second). |
| `G` (`Shift+G`) | Jump to the bottom. |

## Installation

There is no published package or installer yet. From a checkout of this repository, build the macOS app from source:

```sh
npm ci
npm run tauri build -- --bundles app
./src-tauri/target/release/mjp README.md
```

The built command is `mjp`. The app bundle is under `src-tauri/target/release/bundle/macos/`.

## Development

The app uses Tauri 2 and Rust for the CLI, window, and file watching, with Vanilla TypeScript, Vite, markdown-it, DOMPurify, and highlight.js for the preview. Development currently targets macOS Apple Silicon. Use Rust 1.90 or newer, Node.js 24.15.0 or newer within the 24.x line, npm, and the macOS development tools required by Tauri. DOM tests use jsdom and Node's built-in test runner with TypeScript support.

```sh
npm ci
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles app
```

See [PROJECT.md](PROJECT.md) for the product goals, [PLAN.md](PLAN.md) for implementation decisions, and [PERFORMANCE.md](PERFORMANCE.md) for measurements.

The root documents are maintained in English; Japanese versions are under [docs/ja/](docs/ja/README.md).
