# mjp Phase 1 research and design plan

[日本語](../ja/PLAN.md)

Researched: 2026-10-06

Initial target: macOS Apple Silicon. Implementation began after this plan.

On 2026-10-08, the project was renamed from `mdq` to `mjp` (Markdown. Just Preview.) because an existing Homebrew formula already used the `mdq` command. The CLI, packages, and app identifier were renamed together; the GitHub repository was renamed to `mjp` as well, and the history was kept. The design and measurement assumptions below were not changed by the rename. This document also records subsequent implementation decisions where noted.

## 1. Requirements and completion criteria

`mjp <file>` opens one Markdown file, returns the shell prompt without waiting for the GUI, and closes immediately on `Esc`. Phase 1 has no editor or file management features.

| Area | Phase 1 requirement |
| --- | --- |
| CLI | Accept relative and absolute paths, then return the prompt while the GUI remains open. For multiple file arguments, a nonexistent or unreadable file, or a directory, print a clear reason to standard error and exit nonzero before opening a window. Attempt to read non-Markdown extensions as text. Report invalid UTF-8 clearly. |
| Display | Render CommonMark and GFM headings, paragraphs, emphasis, strikethrough, links, quotes, lists, task lists, tables, inline code, fenced code, and horizontal rules. Allow scrolling through long documents and wide tables or code. |
| Code | Highlight fenced code in common languages. Render unknown languages as escaped plain text. |
| Appearance | Follow the OS light/dark setting. Prioritize readable content width, line spacing, heading hierarchy, code, and tables. Do not add a toolbar, sidebar, tabs, or settings UI. |
| Reload | Detect saves and redraw automatically. Show a small in-window error if the file is deleted or cannot be read, then recover when it returns. Preserve scroll position if practical. |
| Close | Exit the window and process on `Esc`, macOS `Cmd+W`, or the normal window close action. Consider `Ctrl+W` when Windows/Linux support is implemented. |
| Performance | Measure startup time. Set a formal threshold after initial measurements on the target machine, and prioritize performance improvements over added features. |

The exclusions in [PROJECT.md](PROJECT.md), sections 6, 7, 12, and 14, still apply. Mermaid, KaTeX, multiple files, and automated distribution remain later-stage work. One-shot standard input is now supported as described below. Images were not part of the initial minimum display requirements. Local raster images are now supported for Markdown reading sessions, as described below; remote images and raw HTML remain outside the scope.

A later UX decision added a small set of Vim-style keys so reading and closing can stay keyboard-only. It does not introduce editing modes or mode management.

## 2. Official specifications and technology choices

### Tauri 2

- Tauri 2 combines a Rust application with the OS WebView. A macOS `.app` stores its executable under `Contents/MacOS`, so a future installer could expose that executable as the `mjp` command. During development, test the generated executable directly. Sources: [Tauri architecture](https://v2.tauri.app/concept/architecture/), [macOS application bundle](https://v2.tauri.app/distribute/macos-application-bundle/).
- The Tauri CLI plugin accepts positional arguments, but a single path can be handled by Rust `std::env::args_os` without another plugin or JS argument handling. `OsString` also preserves OS paths that are not UTF-8. Decide whether `--help` and `--version` belong in this minimal CLI during implementation. Source: [CLI plugin](https://v2.tauri.app/plugin/cli/).
- The configured window can use `create: false` and be created from Rust only after validating the file. This prevents an empty window on a CLI error. Source: [Tauri configuration](https://v2.tauri.app/reference/config/).
- Use events to notify the frontend of changes and a narrow command to fetch document content. Keep file reading in Rust. Source: [calling Rust from the frontend](https://v2.tauri.app/develop/calling-rust/).
- Declare app commands in the build manifest and grant the main window the four commands it uses. The `perf` feature additionally selects the measurement command and its capability from a separate subdirectory. Normal builds exclude that capability and remove the generated measurement permission left by an earlier feature build, so switching build modes in one checkout is repeatable. The Rust opener wrapper remains the only link-opening interface exposed to the frontend.
- Debug navigation uses the origin from `build.devUrl`, so changing the development server address requires no matching Rust edit. That allowance is compiled only with debug assertions; packaged-page navigation is unchanged.
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

Highlighted code uses a separate DOMPurify configuration that preserves text and spans with highlight classes, including nested scopes and embedded languages. Keeping this transformation in a small function with a replaceable highlighter lets tests check both normal formatting and the allowed output structure independently. DOM tests use jsdom only during development; the application continues to use the WebView DOM.

Render Markdown only up to 128 KiB of UTF-8 input. Check this before parsing; larger documents, up to the existing 10 MiB file limit, display their complete source as plain text with a notice. A byte limit keeps the decision inexpensive and independent of Markdown structure. The selected target is an initial render within two seconds on the measured Mac for the three input families in [PERFORMANCE.md](PERFORMANCE.md); this is a measured target, not a guarantee for every document or device. Status updates remain independent of whether the text changed, so read errors and watcher warnings take precedence over the plain-text notice. Keep the existing IPC snapshot format during this change.

### Copying fenced code

Mark fence tokens through the existing Markdown renderer and add native buttons with DOM APIs after sanitization and highlighting. This distinguishes fences without a language from indented code while retaining the parser's normal escaping. Keep controls outside `pre` and `code`, at the top right in a narrow column beside the horizontally scrollable code. Sharing a row preserves the original top padding; reserving the control column keeps long lines readable even while scrolling. Icons and tooltips convey the result without adding a feedback row. Create the SVG icons with DOM APIs from embedded GitHub Octicons path data, matching GitHub's copy control without adding an icon dependency; [THIRD_PARTY.md](THIRD_PARTY.md) records its MIT notice. Exclude the controls from text selection so copying document text does not pick up tooltip or status text. Copy `code.textContent` without trimming; this preserves displayed whitespace and the parser's normalized line endings. Leave out control characters other than tab and line feed, and other default-ignorable characters, so the clipboard holds what the reader saw; the result names the omission. Keep joiners, variation selectors, and bidirectional formatting, because emoji, scripts such as Persian and Indic, ideographic variants, and right-to-left text display differently without them. Because embedding, override, and isolate controls can make the displayed order differ from the copied order, a code block containing them gets a short note above it instead of a rewritten copy, following how code hosts and editors label such text. Showing the note at display time reaches readers who select text by hand as well as those who use the button. Inline code and the large-file plain-text view keep their existing presentation.

Pass a text-writing function through the preview bridge and invoke `navigator.clipboard.writeText` directly during button activation. This uses the WebView API without another runtime dependency or clipboard-read permission; report unavailable APIs and rejected writes as failures. On 2026-10-21, a separate macOS WKWebView harness loaded the production frontend at `tauri://localhost` with a stubbed Tauri document bridge. Native click, Enter, and Space events each copied the expected text to the system clipboard, including a tab, Japanese characters, symbols, and trailing newlines. Light appearance at 800 px and dark appearance at 360 px were visually checked with the earlier stroke icons; the Octicons icons and GitHub tooltip colors have not yet been checked in that harness. This verifies the frontend and WebView path, not the complete packaged Tauri app or VoiceOver announcements.

Use a stable, numbered accessible button name and a visually hidden polite live region for each block's progress and result. Use a borderless icon button with a visible keyboard focus outline. Show the tooltip to its left after a 200 ms hover delay, and immediately on keyboard focus or during a copy attempt. Hide it immediately when hover and focus end, including after a failure, so no tooltip stays over the code; the error icon remains until the next attempt and the live region announces the failure. Tooltip colors follow GitHub's Primer emphasis tokens for light and dark appearance. On success, show a green checkmark for two seconds before restoring the copy icon. A new attempt cancels the previous reset timer, and document replacement or page exit clears all timers and pending UI updates. Ignore repeat activation while a write is pending using `aria-disabled` rather than disabling focus. File-error messages remain independent. DOM tests inject the writer to cover copying, failure, retry, and replacement without using the system clipboard.

### Local images

Keep image syntax in Markdown while leaving raw HTML disabled. The parser emits inert placeholders, and the frontend inserts image elements only after `get_image` returns raster bytes through Tauri's binary response. This avoids exposing a general file-serving protocol and does not put document-provided URLs into image sources. PNG, JPEG, GIF, and WebP signatures select the image MIME type; decoding stays in the WebView. Failed reads or decoding retain alt text.

The image scope is the nearest ancestor containing a `.git` marker, or the Markdown file's containing directory when there is no marker. This lets translated documents share repository images through parent-relative paths without making arbitrary absolute paths available. On Unix, retain an open scope directory and walk normalized relative components with `openat` and `O_NOFOLLOW`; directory components must be directories, and the opened leaf must be a regular file. Symlinks are not accepted, including ones inside the scope. Other platforms need an equivalent scoped-open implementation before local images are enabled.

Read each image with the existing 10 MiB file-size ceiling, including a bounded read for files that grow. Fetch images sequentially after text rendering, reuse Blob URLs for repeated sources, and revoke them on document replacement or page exit. Ignore old results after replacement. Allow at most 64 image occurrences and 32 MiB of distinct encoded image bytes per rendering; stop fetching new sources when the aggregate limit is reached. These are transfer and retention limits, not a bound on image decoding time or expanded pixel memory. Image-only saves are not watched in this first implementation; reopening the preview or changing the Markdown text reloads images. Images do not load in the large-document plain-text mode.

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
- Keep Tauri command and event wiring in `main.ts`, and pass those operations to the preview controller. This lets DOM tests exercise the same loading, rendering, keyboard, and link handlers as the app without starting a native window. Only the latest requested read may update content or its error banner, including when earlier requests finish later.
- `Esc` and other shortcuts use small frontend handlers to request exit. The native window close path must also terminate the process; check for orphaned processes on macOS.
- Use one window about 800 px wide, with a CSS limit on content width. Adapt to narrower screens. Begin with the standard title bar; do not build a custom one before measuring startup and interaction.
- Plain and modifier clicks keep opening supported links in the default application. Auxiliary link clicks and drops have no preview action. DOM drop handlers cover the entire window, including margins. Keep Tauri's native drag-drop handling enabled as before; this setting controls native event handling rather than declaring whether the application accepts drops.

### One-shot standard input

Accept `command | mjp` and `mjp < file` without requiring an input flag. An explicit file takes precedence, `mjp -` explicitly selects stdin, and `mjp -- -` selects a file named `-`. With no arguments at a terminal, show help; explicit stdin at a terminal reports an error rather than waiting for interactive input. Read to EOF with the existing 10 MiB ceiling, checking at most one extra byte, and validate UTF-8 before starting a GUI. Preserve whitespace and allow an empty document. The existing 128 KiB rendering threshold still applies.

Represent the document path as optional so standard input shares the existing snapshot and rendering pipeline without inventing a watched file. Use `stdin` as its title and leave its image scope unavailable. Custom titles remain follow-up work; do not infer filesystem access from the caller's working directory.

An explicit image base directory for standard input (for example `--base-dir`) is deferred, not planned. When the Markdown exists as a file, `mjp <file>` already resolves its images and adds live reload. Output from `git show` would pair an old document with current working-tree images, and remote or generated text rarely has local images to show. Alt text keeps the content readable without the images. The option would add CLI rules and a new filesystem read path to standard input for little gain. Reconsider it only for a concrete workflow that needs local images in piped text.

Live previews of editor buffers (Issue #14 stages 3 and 4: Neovim integration and live updates, including the `--stream` proposal) will not be adopted. `mjp <file>` already refreshes after every save, and editor autosave keeps the preview close to the current edits. Live previews would require document framing, update throttling, disconnect handling, process lifetime management, and editor-specific integration code merely to show changes before saving. Keeping file-based reload fits the lightweight, editor-independent direction in [PROJECT.md](PROJECT.md), which excludes Neovim extensions. Reconsider this only for a concrete workflow that needs to preview continuous updates to a document that does not exist as a file.

In macOS release builds, transfer the validated text through an anonymous pipe to the detached GUI child. The child reads and validates its input before initializing the window. Close the pipe after writing so EOF completes the document; return after the handoff without waiting for the window to close. Stop and reap the child if writing fails. This keeps document text out of command arguments, environment variables, and temporary files. File-based startup keeps its existing path handoff, and development builds continue in the foreground. No additional dependencies or frontend IPC commands are needed.

### Documents belong to windows

Every preview has a process-unique `preview-<n>` label and a registry entry containing its document and image scope. Commands resolve the caller's injected WebView label, and reload subscriptions receive only that window's events. A shared template and `preview-*` capabilities keep CLI previews on the same path as future OS-opened windows without accepting a frontend-selected document. Window creation and render performance marks carry the injected label; process startup marks remain separate.


Registry entries own stoppable watcher handles, while workers retain only their document. Removal happens on `Destroyed`, after a close can no longer be cancelled. A failed window build rolls back the entry and watcher. The registry lock is released before stopping or joining a worker. Stopping wakes event/debounce waits and serializes with refresh publication so closed previews cannot receive later updates. Labels are never reused during a process lifetime.

Closing one window leaves the others running. Natural exit requires both an empty registry and no unfinished open requests; explicit Quit exits the whole process. Exiting after the last preview is mjp's lightweight reading-session choice, unlike document apps that remain alive with no windows.

## 4. File watching

The first choice is Rust [notify](https://docs.rs/notify/latest/notify/) with `recommended_watcher`. Watch the parent directory nonrecursively, not the file itself, and handle events involving the target filename. Editors differ in whether they overwrite, delete and recreate, or replace from a temporary file. Instead of interpreting each event type strictly, reread the target after a short debounce (initially 100–200 ms) and coalesce duplicates.

Retry briefly after a transient read failure. If it persists, retain the last valid content and display an error; clear the error when the file recovers. First preserve the absolute scroll offset, clamping it to the new maximum if the document shrinks. Release watch resources on exit. The `notify` documentation notes that events may fail on network filesystems, so the first release only guarantees local files; consider polling later if needed.

Follow the selected path across saves rather than pinning a file identity. This preserves both editor saves that rename a temporary file over the original and deletion followed by recreation. File type and size checks continue to use the opened handle, keeping validation and reading on the same object. This choice matches a live preview of an editable local file.

Use a 140 ms quiet period after relevant file events, with a 700 ms total debounce limit. Unrelated sibling events do not restart the quiet period. The limit allows up to five quiet periods before attempting a reread, keeping continuous saves visible while retaining the existing brief retries for incomplete writes.

Tauri's [filesystem plugin](https://v2.tauri.app/plugin/file-system/) also has a watch API, but using it would require frontend file-access scope and permissions. Keeping reads and watching in Rust preserves a smaller security boundary.

## 5. Security and link policy

1. Treat input Markdown as untrusted. Sanitize the renderer's output with [DOMPurify](https://github.com/cure53/DOMPurify), limiting HTML to needed tags and attributes before inserting it into the DOM. Exclude scripts, event attributes, forms, iframes, SVG/MathML, and dangerous URLs. Raw HTML is not a Phase 1 feature. The implementation now uses `markdown-it` with raw HTML disabled.
2. Add a CSP that allows bundled scripts and styles plus Tauri IPC while blocking remote scripts, frames, objects, and form submissions. Use `img-src blob:` for image bytes returned by the scoped Rust command; remote, data, and file URLs remain unavailable to image elements. Check exact hashes, nonces, and IPC sources produced by Tauri when implementing the policy.
3. Never navigate the app WebView when a document link is clicked. Validate only `https:`, `http:`, and `mailto:`, then pass them to the OS default app. Do not open `javascript:`, `data:`, `file:`, or relative links in Phase 1. If using Tauri's [opener plugin](https://v2.tauri.app/plugin/opener/), recheck URLs in a narrow Rust command rather than granting unrestricted frontend access. Deny other normal navigation and new-window requests.
4. Do not add general filesystem, shell, or HTTP permissions, an external CDN, or a broad asset protocol exposing files to the WebView. Limit inputs to 10 MiB; reject larger files before opening a window and retain the last content with an error during reload. Reject nonregular files such as FIFOs. On Unix, open with `O_NONBLOCK` and inspect the opened handle to avoid blocking. Verify that links and images in Markdown cannot read arbitrary local files.

## 6. Directory layout

The application layout below is a simplified overview; some components are split into additional files.

Keep detailed English documents in `docs/en/` and their Japanese counterparts in `docs/ja/` so language versions are grouped consistently and the repository root stays concise. English remains canonical. Keep the English README at the root as the entry point, alongside `AGENTS.md`, `CLAUDE.md`, and `LICENSE`.

```text
<repository>/
├── README.md
├── AGENTS.md
├── CLAUDE.md
├── LICENSE
├── docs/
│   ├── en/              # PROJECT.md, PLAN.md, PERFORMANCE.md, RELEASING.md, THIRD_PARTY.md
│   └── ja/              # README.md and Japanese counterparts
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

Automated checks cover real local file notifications through document refresh in Rust, and change subscriptions through DOM updates in the frontend. These checks share the application's processing functions. The Tauri event transport, OS link opening, native window lifecycle, and WKWebView behavior still require macOS integration checks; passing the separate suites does not establish that full path.

- `mjp README.md` returns the prompt quickly while the preview remains useful for a short reading session.
- The requested Markdown/GFM syntax and common code languages are readable.
- Saves reload automatically; deletion, replacement, and recovery do not break the window.
- CLI errors are clear, nonzero, and do not open a window.
- Malicious Markdown cannot execute arbitrary JavaScript, navigate to an external page in the WebView, or read arbitrary local files.
- Startup measurements and remaining limitations are recorded for the next phase.

## 8. Release build paths

The `build:release` entry point applies Rust source-path remapping to the application and its dependencies. It derives the home, Cargo, Rustup, and checkout prefixes at build time and uses stable `/build/` destinations, keeping source locations useful without tying shared executables to one developer's directory layout. Cargo's encoded compiler flags preserve spaces in paths and existing environment-supplied flags. Development commands keep their normal source paths.

## 9. Source distribution

The first public distribution contains source only under the MIT License. Keep the current 0.1.0 version consistent across npm, Cargo, and Tauri; derive CLI `--version` output from Cargo's package version. Handle help and version before document loading, and use `--` to preserve access to file names that look like options. The user-local CLI installation copies the self-contained executable, avoiding a system-wide installer for this first step. The app declares macOS 11.0 as its deployment minimum for Apple Silicon; this is not a claim of testing on every older macOS release.

Dependencies retain their original terms. Binary release notices, Developer ID signing, notarization, and automated publishing are deferred until binary distribution is planned. Source publication keeps the existing Git history; changing repository visibility remains a separate owner action.

## 10. Dependency maintenance and CI

Check Cargo, npm, and GitHub Actions weekly with Dependabot, keeping major updates eligible and reviewing each update manually after CI succeeds. Start without grouping so each dependency change remains easy to assess; cap open version-update PRs at five per ecosystem.

Use one macOS 15 Apple Silicon CI job for the current target. Keep the platform selection at the job level and Rust working directories explicit so later OS jobs can reuse the checks without claiming Windows/Linux support today. Set up Rust before npm tests because the release-tooling test compiles a small Rust fixture. Pin the CI Rust toolchain to 1.99.0 to keep Clippy diagnostics stable until deliberately upgraded, and read Node's supported range from `package.json` to avoid duplicating it. Build frontend assets before Cargo checks because Tauri consumes them. Keep dependency downloads cached and rebuild artifacts to avoid retaining stale application outputs. GitHub-provided actions use full commit SHAs and the workflow needs only read access, allowing ordinary and Dependabot PRs to use the same checks without secrets. See [RELEASING.md](RELEASING.md) for the maintenance procedure and owner-side settings.

## 11. Open questions from the initial plan

- Check `mjp` for naming conflicts across GitHub, Homebrew, crates.io, npm, PyPI, web search, and trademarks before distribution. The rename alone does not establish availability in any registry.
- macOS Apple Silicon is the Phase 1 test target, though Windows/Linux influence the design. The [Tauri CLI plugin](https://v2.tauri.app/plugin/cli/) notes a Windows GUI executable limitation for console output; verify CLI errors and `Ctrl+W` on Windows during porting. Production Windows builds use `http://tauri.localhost`, so also check whether the current `on_navigation` policy, which only accepts `tauri:` in release builds, blocks the initial page.
- Relative file links and remote images remain deferred. Local raster images use the scoped reader described above.
