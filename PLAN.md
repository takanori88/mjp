# mjp Phase 1 research and design plan

[日本語](docs/ja/PLAN.md)

Researched: 2026-10-06

Initial target: macOS Apple Silicon. Implementation began after this plan.

On 2026-10-08, the project was renamed from `mdq` to `mjp` (Markdown. Just Preview.) because an existing Homebrew formula already used the `mdq` command. The CLI, packages, and app identifier were renamed together; the GitHub repository was renamed to `mjp` as well, and the history was kept. The design and measurement assumptions below were not changed by the rename. This document also records subsequent implementation decisions where noted.

## 1. Requirements and completion criteria

`mjp <file>` opens one Markdown file, returns the shell prompt without waiting for the GUI, and closes immediately on `Esc`. Phase 1 has no editor or file management features.

| Area | Phase 1 requirement |
| --- | --- |
| CLI | Accept relative and absolute paths, then return the prompt while the GUI remains open. For missing or multiple arguments, a nonexistent or unreadable file, or a directory, print a clear reason to standard error and exit nonzero before opening a window. Attempt to read non-Markdown extensions as text. Report invalid UTF-8 clearly. |
| Display | Render CommonMark and GFM headings, paragraphs, emphasis, strikethrough, links, quotes, lists, task lists, tables, inline code, fenced code, and horizontal rules. Allow scrolling through long documents and wide tables or code. |
| Code | Highlight fenced code in common languages. Render unknown languages as escaped plain text. |
| Appearance | Follow the OS light/dark setting. Prioritize readable content width, line spacing, heading hierarchy, code, and tables. Do not add a toolbar, sidebar, tabs, or settings UI. |
| Reload | Detect saves and redraw automatically. Show a small in-window error if the file is deleted or cannot be read, then recover when it returns. Preserve scroll position if practical. |
| Close | Exit the window and process on `Esc`, macOS `Cmd+W`, or the normal window close action. Consider `Ctrl+W` when Windows/Linux support is implemented. |
| Performance | Measure startup time. Set a formal threshold after initial measurements on the target machine, and prioritize performance improvements over added features. |

The exclusions in [PROJECT.md](PROJECT.md), sections 6, 7, 12, and 14, still apply. Mermaid, KaTeX, stdin, multiple files, and automated distribution are later-stage work. Images were not part of the minimum display requirements: Phase 1 replaces image syntax with alt text and does not load relative or external images. Reassess image support after using the app on a real machine.

A later UX decision added a small set of Vim-style keys so reading and closing can stay keyboard-only. It does not introduce editing modes or mode management.

## 2. Official specifications and technology choices

### Tauri 2

- Tauri 2 combines a Rust application with the OS WebView. A macOS `.app` stores its executable under `Contents/MacOS`, so a future installer could expose that executable as the `mjp` command. During development, test the generated executable directly. Sources: [Tauri architecture](https://v2.tauri.app/concept/architecture/), [macOS application bundle](https://v2.tauri.app/distribute/macos-application-bundle/).
- The Tauri CLI plugin accepts positional arguments, but a single path can be handled by Rust `std::env::args_os` without another plugin or JS argument handling. `OsString` also preserves OS paths that are not UTF-8. Decide whether `--help` and `--version` belong in this minimal CLI during implementation. Source: [CLI plugin](https://v2.tauri.app/plugin/cli/).
- The configured window can use `create: false` and be created from Rust only after validating the file. This prevents an empty window on a CLI error. Source: [Tauri configuration](https://v2.tauri.app/reference/config/).
- Use events to notify the frontend of changes and a narrow command to fetch document content. Keep file reading in Rust. Source: [calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/).
- Restrict WebView permissions through capabilities. CSP is not active unless configured. Do not give the frontend general filesystem or shell plugin access. Sources: [capabilities](https://v2.tauri.app/security/capabilities/), [CSP](https://v2.tauri.app/security/csp/).

### Markdown renderer candidates

| Candidate | Benefit | Concern | Initial decision |
| --- | --- | --- | --- |
| [Marked](https://github.com/markedjs/marked) | GFM is enabled by default; task lists and tables are easy to cover with one renderer. | Its HTML output is not sanitized, so a separate sanitizer is required. | Initial candidate for broad GFM coverage and simplicity. |
| [markdown-it](https://github.com/markdown-it/markdown-it) | Fast, CommonMark-compliant, can disable HTML, and handles tables and strikethrough. | GFM task lists need another plugin. | Initial fallback if Marked had performance or compatibility problems. |
| [remark-parse + remark-gfm](https://github.com/remarkjs/remark-gfm) | Explicit GFM support and strong AST extensibility. | Requires several packages and processing stages to produce HTML. | More machinery than this viewer needs. |

Marked was the first candidate used in implementation. Large-document parsing proved too slow, so the current app uses `markdown-it` with a task-list plugin. The measurements and reason for this change are in [PERFORMANCE.md](PERFORMANCE.md). The original Marked assessment used [Marked options](https://marked.js.org/using_advanced) and its [README](https://github.com/markedjs/marked).

### Syntax highlighter candidates

| Candidate | Benefit | Concern | Initial decision |
| --- | --- | --- | --- |
| [highlight.js](https://github.com/highlightjs/highlight.js) | Its core and only needed languages can be imported; processing is synchronous. | Registering every language increases bundle size. | Preferred. Start with JS/TS, JSON, Python, Rust, Shell, HTML/CSS, then measure. |
| [Shiki](https://shiki.style/guide/install) | Grammar and theme quality close to VS Code. | Theme, language, and WASM loading may slow first display. | Defer until a substantial quality difference justifies it. |
| [Prism](https://github.com/PrismJS/prism) | Can be configured lightly. | Requires separate language and style management. | Compare only if highlight.js needs replacing. |

Highlight only languages explicitly named on code fences; do not auto-detect. Render unknown languages as safely escaped text. Bundle light and dark highlight colors locally, without a CDN.

### Alternative architecture

SwiftUI plus WKWebView might yield an even smaller macOS-only design, but would require revisiting the Windows/Linux plan. The first choice is Tauri 2, Vanilla TypeScript, and Vite. React adds little for a view with only document, error, and theme state. Vite is needed for builds, not at runtime; installed users should not need Node.js or a development server. If Tauri/WebView startup dominates, measure it before changing frontend frameworks.

## 3. Minimal architecture

```text
terminal: mjp README.md
  └─ Rust CLI: validate arguments → resolve path → validate UTF-8 → spawn GUI → return
       ├─ GUI process: create one Tauri window only after validation
       ├─ watch the parent directory
       └─ read command + change event
            └─ Vanilla TypeScript: Markdown parser → sanitize HTML → update DOM
                 ├─ highlight.js (selected languages)
                 └─ CSS: follow OS appearance
```

- On macOS release builds, the CLI starts the same executable as a detached GUI child using the validated absolute path, then exits. The GUI remains until its window is closed. `tauri dev` stays in the foreground to keep the development server running. There is no daemon, localhost server, sidecar, or single-instance plugin. Two invocations create independent previews. Design and test Windows/Linux startup separately during porting.
- On initial load, the WebView subscribes to change events before fetching the text. If an event overlaps a read, reread once to avoid missing a save. Events request a reread rather than carrying the entire document.
- `Esc` and other shortcuts use small frontend handlers to request exit. The native window close path must also terminate the process; check for orphaned processes on macOS.
- Use one window about 800 px wide, with a CSS limit on content width. Adapt to narrower screens. Begin with the standard title bar; do not build a custom one before measuring startup and interaction.

## 4. File watching

The first choice is Rust [notify](https://docs.rs/notify/latest/notify/) with `recommended_watcher`. Watch the parent directory nonrecursively, not the file itself, and handle events involving the target filename. Editors differ in whether they overwrite, delete and recreate, or replace from a temporary file. Instead of interpreting each event type strictly, reread the target after a short debounce (initially 100–200 ms) and coalesce duplicates.

Retry briefly after a transient read failure. If it persists, retain the last valid content and display an error; clear the error when the file recovers. First preserve the absolute scroll offset, clamping it to the new maximum if the document shrinks. Release watch resources on exit. The `notify` documentation notes that events may fail on network filesystems, so the first release only guarantees local files; consider polling later if needed.

Tauri's [filesystem plugin](https://v2.tauri.app/plugin/file-system/) also has a watch API, but using it would require frontend file-access scope and permissions. Keeping reads and watching in Rust preserves a smaller security boundary.

## 5. Security and link policy

1. Treat input Markdown as untrusted. Sanitize the renderer's output with [DOMPurify](https://github.com/cure53/DOMPurify), limiting HTML to needed tags and attributes before inserting it into the DOM. Exclude scripts, event attributes, forms, iframes, SVG/MathML, and dangerous URLs. Raw HTML is not a Phase 1 feature. The implementation now uses `markdown-it` with raw HTML disabled.
2. Add a CSP that allows bundled scripts and styles plus Tauri IPC while blocking remote scripts, frames, objects, and form submissions. Initially, `img-src` should allow neither remote nor arbitrary local images. Check exact hashes, nonces, and IPC sources produced by Tauri when implementing the policy.
3. Never navigate the app WebView when a document link is clicked. Validate only `https:`, `http:`, and `mailto:`, then pass them to the OS default app. Do not open `javascript:`, `data:`, `file:`, or relative links in Phase 1. If using Tauri's [opener plugin](https://v2.tauri.app/plugin/opener/), recheck URLs in a narrow Rust command rather than granting unrestricted frontend access. Deny other normal navigation and new-window requests.
4. Do not add general filesystem, shell, or HTTP permissions, an external CDN, or a broad asset protocol exposing files to the WebView. Limit inputs to 10 MiB; reject larger files before opening a window and retain the last content with an error during reload. Reject nonregular files such as FIFOs. On Unix, open with `O_NONBLOCK` and inspect the opened handle to avoid blocking. Verify that links and images in Markdown cannot read arbitrary local files.

## 6. Proposed directory layout

This was the initial layout proposal; the current file split differs where implementation needs changed.

```text
<repository>/
├── PROJECT.md
├── PLAN.md
├── package.json
├── index.html
├── vite.config.ts
├── src/
│   ├── main.ts          # load, reload, and close events
│   ├── render.ts        # renderer, DOMPurify, highlight.js
│   └── style.css        # content, light/dark, scrolling
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   └── src/
│       ├── main.rs       # CLI entry point
│       └── lib.rs        # Tauri startup, reads, watching, links
└── tests/               # CLI and security fixtures if needed
```

Split files according to actual complexity. Avoid a UI framework, state-management library, and router.

## 7. Phase 1 implementation order and verification

1. **End-to-end startup:** Create the minimal Tauri 2 + Vanilla TypeScript path from Rust argument validation through a single window displaying plain text, then let the CLI exit. Check absolute and relative paths, zero or multiple arguments, missing or unreadable files, and exit codes. Try both the generated binary and the executable inside the `.app`.
2. **Rendering:** Add a Markdown parser, DOMPurify, and only needed highlight.js languages. Use one fixture with the syntax listed in PROJECT.md. Check unknown languages, long content, and horizontal scrolling of tables and code. The current parser is `markdown-it`.
3. **Appearance and controls:** Check light/dark switching, the standard title bar, scrolling, and process exit after `Esc`, `Cmd+W`, and window close on the target Mac.
4. **Live reload:** Add parent-directory watching and debounce; try ordinary save, atomic save, deletion and recreation, and rapid consecutive saves. Preserve scroll position if feasible.
5. **Security and performance:** Try inputs with `<script>`, event attributes, `javascript:` links, and dangerous image URLs. Confirm there is no arbitrary script execution, external WebView navigation, or arbitrary local file read. On one machine, repeatedly measure clean and successive command-to-render times, memory use, and JS bundle size. Record the values and improve only the slow paths.

### Phase 1 completion criteria

- `mjp README.md` returns the prompt quickly while the preview remains useful for a short reading session.
- The requested Markdown/GFM syntax and common code languages are readable.
- Saves reload automatically; deletion, replacement, and recovery do not break the window.
- CLI errors are clear, nonzero, and do not open a window.
- Malicious Markdown cannot execute arbitrary JavaScript, navigate to an external page in the WebView, or read arbitrary local files.
- Startup measurements and remaining limitations are recorded for the next phase.

## 8. Open questions from the initial plan

- Check `mjp` for naming conflicts across GitHub, Homebrew, crates.io, npm, PyPI, web search, and trademarks before distribution. The rename alone does not establish availability in any registry.
- macOS Apple Silicon is the Phase 1 test target, though Windows/Linux influence the design. The [Tauri CLI plugin](https://v2.tauri.app/plugin/cli/) notes a Windows GUI executable limitation for console output; verify CLI errors and `Ctrl+W` on Windows during porting. Production Windows builds use `http://tauri.localhost`, so also check whether the current `on_navigation` policy, which only accepts `tauri:` in release builds, blocks the initial page.
- Local images and relative file links require a carefully bounded file-exposure policy. If reading sessions show a strong need, design a scope based on the selected document in a later phase.
