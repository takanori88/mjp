# mjp — Markdown. Just Preview.

[日本語](../ja/PROJECT.md)

This document records the product goals and original Phase 1 scope. For currently implemented behavior and build instructions, see [README.md](../../README.md).

## 1. Project overview

`mjp` is a lightweight CLI tool for opening a Markdown file in a GUI preview directly from the terminal:

```sh
mjp README.md
```

The aim is a small native window that renders Markdown with readability close to VS Code's Markdown Preview. It is a viewer for a quick glance, not a Markdown editor.

> **Markdown. Just Preview.**

Like macOS Quick Look, it should let someone check a file and close it immediately.

## 2. Background

Terminal-based development involves reading Markdown files frequently. Coding agents such as Codex make files like `README.md`, `AGENTS.md`, `PLAN.md`, `DESIGN.md`, `SPEC.md`, and `IMPLEMENTATION.md` especially common.

The usual ways to inspect them each have a cost:

- `cat README.md` shows source text rather than a rendered document.
- `less` and `bat` can color the source, but do not render it as Markdown.
- `glow` and `mdcat` render within terminal character cells, so their layout cannot match HTML/CSS previews.
- `code README.md` gives a readable preview, but opening an editor is excessive for a ten-second look.
- A browser-based viewer opens a browser and adds a tab to manage.

## 3. The experience to provide

```sh
mjp README.md
```

The intended flow is:

1. A preview window opens quickly.
2. Markdown is rendered clearly.
3. The user reads it.
4. `Esc` closes it.

An illustrative future experience:

```text
$ mjp README.md

        ↓

┌──────────────────────────────────────┐
│ README.md                         ×  │
├──────────────────────────────────────┤
│                                      │
│  mjp                                 │
│  ───                                 │
│                                      │
│  Markdown. Just Preview.             │
│                                      │
│  Features                            │
│                                      │
│  • Instant preview                   │
│  • GitHub Flavored Markdown          │
│  • Live reload                       │
│                                      │
│  Installation (future)               │
│                                      │
│    brew install mjp                  │
│                                      │
└──────────────────────────────────────┘
```

The Homebrew command in this illustration is a goal, not a currently available installation method.

## 4. Product principles

### 4.1 A Quick Look experience

`mjp` is for looking at Markdown, not managing or editing it. Reading should require almost no setup or interaction.

### 4.2 Startup speed first

Prioritize startup time over feature count. The target is no perceptible wait between running the command and seeing the preview. Measure startup when possible and keep checking it as development continues.

### 4.3 Minimal UI

The Markdown content is the primary interface. Do not add a toolbar, sidebar, file explorer, tab bar, status bar, or settings button for their own sake. Keep the title bar as simple as practical.

### 4.4 CLI first

Opening a GUI app and selecting a file is not the main workflow. The interface is:

```sh
mjp <file>
```

The macOS app also accepts Finder file-open requests. Each document gets its own window in the receiving process. CLI invocations remain independent and start with one preview; a CLI child can add windows if it later receives OS requests. This extends quick viewing without adding a file picker, tabs, or document management. See [PLAN.md](PLAN.md) for the lifetime rules and [README.md](../../README.md) for installation.

## 5. Minimum viable product

Phase 1 focuses on the following behavior.

### CLI

```sh
mjp README.md
```

Accept relative and absolute paths. When a file does not exist, report a clear error in the CLI without opening a GUI:

```text
mjp: README2.md: file not found
```

The original plan left handling of non-Markdown extensions for implementation. The current implementation attempts to read them as UTF-8 text; see [README.md](../../README.md).

### Markdown rendering

Support at least CommonMark and GitHub Flavored Markdown, including headings, paragraphs, bold, italic, strikethrough, links, blockquotes, ordered and unordered lists, task lists, tables, inline code, fenced code blocks, and horizontal rules.

The current implementation formats files up to 128 KiB as Markdown. Larger files, up to 10 MiB, show their complete source as plain text with a notice. Both modes support live reload; the display choice keeps a quick preview useful for larger inputs.

### Syntax highlighting

Highlight fenced code blocks, starting with common programming languages:

```python
def hello():
    print("hello")
```

### Theme

Follow the OS light and dark appearance automatically. Use GitHub Markdown and VS Code Markdown Preview as references for readability, including type, spacing, and code styling. Do not copy another product's CSS wholesale.

### Live reload

Watch the displayed file and rerender after a save without asking the user to reload:

```text
Editor → save → README.md → file change → mjp → automatic rerender
```

### Close

The Phase 1 plan called for `Esc` and macOS `Cmd+W`, as well as the normal window close action. These now close the current preview. The process exits when no windows or unfinished open requests remain; macOS `Cmd+Q` quits the entire process. `Ctrl+W` was a future Windows/Linux consideration, not a current shortcut.

### Scrolling

Allow ordinary scrolling in long documents. Preserve the scroll position across a reload if feasible; postpone it if it makes the first implementation too complex.

## 6. Outside the MVP

Phase 1 does not include Markdown editing, a file explorer, tabs, project management, a settings UI, plugins or extensions, AI features, Git integration, a terminal renderer, Neovim or VS Code extensions, collaborative editing, cloud sync, PDF or HTML export, presentation mode, WYSIWYG, or a diagram editor.

Do not add features solely because they seem useful. Keep the quick preview experience central.

## 7. Mermaid and KaTeX

Mermaid and KaTeX could be valuable, but are not required for the MVP. Revisit them in Phase 2 after basic Markdown rendering and startup speed are satisfactory.

For example, a future preview could recognize:

````markdown
```mermaid
graph LR
    A --> B
```
````

## 8. Technical direction

The initial preferred architecture was:

```text
Tauri 2
  ├── Rust
  │   ├── CLI arguments
  │   ├── file handling
  │   └── file watching
  └── WebView
      ├── Markdown parser
      ├── GFM
      ├── syntax highlighting
      └── CSS
```

Avoid Electron by default because its runtime and memory cost work against a quick-look tool. Before implementation, verify the then-current Tauri 2 documentation and propose a simpler or faster architecture if one is supported by evidence. The resulting investigation is in [PLAN.md](PLAN.md).

## 9. Frontend

Evaluate whether React is needed. With state largely limited to the Markdown content, an error, and the theme, the flow may be as simple as:

```text
Markdown → HTML → WebView
```

Vanilla TypeScript may be a better fit. Choose by startup speed, implementation simplicity, binary size, then maintainability. Do not adopt React merely because it is common.

## 10. Security

Markdown may be untrusted input. Account for raw HTML, JavaScript, script tags, event handlers, and dangerous URLs. Markdown must not be able to execute arbitrary JavaScript. Define what happens when the user follows an external link. The concrete controls and tradeoffs are recorded in [PLAN.md](PLAN.md).

## 11. User experience

A normal session should last seconds or tens of seconds:

```text
mjp README.md → read → Esc
```

Think of `mjp` as a temporary visual display invoked from the CLI, rather than a place to manage documents.

## 12. Future CLI ideas

After the MVP, consider a theme override:

```sh
mjp README.md --theme dark
```

One-shot standard input is now supported:

```sh
cat README.md | mjp
git show HEAD:README.md | mjp
mjp -
```

The theme override remains a future idea. Standard input is read once to EOF. See [README.md](../../README.md) for current limits and behavior.

## 13. Cross-platform scope

Start development and verification on macOS Apple Silicon. Avoid unnecessary OS-specific design where possible so macOS, Windows, and Linux can be considered later. Revisit Windows and Linux support after Phase 1.

## 14. Distribution

The long-term goal is a simple macOS Homebrew installation, either from Homebrew core:

```sh
brew install mjp
```

or from a project tap:

```sh
brew install <owner>/tap/mjp
```

Neither method has been published yet. Future GitHub Releases may offer macOS arm64 and x86_64, Windows x64, and Linux x64 builds. Automated build and release through GitHub Actions is a Phase 2 candidate.

## 15. Position among other viewers

Existing tools include feature-rich Markdown viewers and editors, terminal renderers, browser previews, and IDE integrations. `mjp` does not aim to outnumber their features. Its differentiator is fast startup with very little interaction:

```text
cat       → fast, but reads as source
bat       → highlighted source
glow      → terminal rendering
VS Code   → high-quality preview inside an IDE
browser   → high-quality preview in a browser
mjp       → high-quality quick glance
```

## 16. Name

`mjp` means **Markdown. Just Preview.** It is short to type:

```sh
mjp README.md
```

Before distribution, check for naming conflicts on GitHub, Homebrew, crates.io, npm, PyPI, the broader web, and relevant trademark registries.

## 17. Success criteria

Phase 1 succeeds when `mjp README.md` feels fast and simple enough that opening VS Code for a brief read is unnecessary. Specifically: quick startup, readable rendering, a short command, automatic refresh after saves, immediate closing with `Esc`, and little to learn.

## 18. Original implementation brief

The original instruction for Codex was to read this project definition and **not start coding immediately**. It first required:

1. Organizing the requirements.
2. Checking the current official Tauri 2 specification.
3. Comparing Markdown renderer candidates.
4. Comparing syntax highlighter candidates.
5. Evaluating file-watching approaches.
6. Identifying security concerns.
7. Proposing the smallest architecture that prioritizes startup speed.
8. Proposing a directory layout.
9. Writing a Phase 1 implementation plan in `PLAN.md`.

Implementation followed that planning step. The standing product constraint is to avoid overdesign and reach the `mjp README.md` experience through the shortest practical path.
