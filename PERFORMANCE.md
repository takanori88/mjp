# mjp Phase 2 performance measurements

[日本語](docs/ja/PERFORMANCE.md)

The first measurements below were taken on 2026-10-06 under the former name `mdq`. The project was renamed to `mjp` on 2026-10-08. The original command name and environment variable are retained as historical facts. The final section records the current display-mode measurements.

Measured: 2026-10-06 (JST)

Environment: macOS 26.6.2 / arm64, Tauri 2 release build

Scope: from invoking `mdq <file>` to the first Markdown render

## Method

- The small input was 41 bytes of Markdown (a heading, short text, and a task list). The large input was 1,407,618 bytes of technical-document-style Markdown (850 sections, paragraphs, and Rust code blocks). Both were UTF-8 files under `/private/tmp`.
- A measurement build enabled the Cargo `perf` feature and `VITE_MDQ_PERF=1` to record CLI, GUI, and WebView timestamps. At the time, the normal release build excluded those recording paths and IPC command from its compiled JS and executable.
- Each file was opened once, then five more times in succession. After the first-render timestamp, the measurement GUI process was stopped. The macOS file cache was not cleared, so “cold” means the first launch in this sequence, not an uncached OS launch.
- “Measured CLI” is the parent process's exit time measured externally. Other stages are relative to the start of CLI `main`. “Window created” marks completion of Tauri `build()`. “First render” is the second `requestAnimationFrame` after the DOM update: a proxy for visible display, not proof of the exact time the pixels appeared.

## Results

| Input | First CLI measured | First window created | First render | Subsequent CLI median (range) | Subsequent first-render median (range) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small, 41 B | 9.97 ms | 338.17 ms | 707.77 ms | 9.22 ms (9.01–11.99) | 650.61 ms (632.18–796.32) |
| Large, 1.41 MB | 12.39 ms | 318.57 ms | 1089.59 ms | 10.25 ms (9.52–10.54) | 1058.50 ms (1027.71–1121.57) |

Median stage times across the five subsequent launches, measured from the start of CLI `main`:

| Stage | Small | Large |
| --- | ---: | ---: |
| Just before CLI returns, after spawning the GUI | 1.45 ms | 1.73 ms |
| GUI process enters `main` | 6.65 ms | 6.67 ms |
| Window created | 294.21 ms | 301.51 ms |
| Markdown received | 626.61 ms | 625.50 ms |
| Markdown parsed | 629.61 ms | 677.50 ms |
| DOM inserted | 630.61 ms | 843.50 ms |
| Syntax highlighting complete | 631.61 ms | 876.50 ms |
| First-render proxy | 650.61 ms | 1058.50 ms |

For the small file, most of the wait was between creating the window/WebView and receiving the document. The large file also spent time inserting and rendering the DOM. CLI return normally took about 10 ms for both inputs.

The normal release build was also measured separately from the instrumentation build. The first launch immediately after a build took **451 ms** to return the CLI; after another rebuild, its first launch took **601 ms**. Five consecutive launches after the first build took **8.8, 8.9, 10.1, 9.4, and 9.7 ms**. In each case, the GUI process was still running one second after CLI return. The reason for the slow first launch after rebuilding remains unknown; it is not yet clear whether it occurs on a user's first launch after installation.

## Issue found during implementation

With the first Markdown parser, converting the approximately 1.4 MB document took more than 15 seconds in the WebView. When split into 100, 300, and 600 KB inputs, conversion completed 802, 1,921, and 5,384 ms after CLI start, respectively; the time grew sharply with input size. After switching to `markdown-it`, conversion of the same approximately 1.4 MB document took about 52 ms after receipt, and first render took about 1.06 seconds (median of subsequent launches).

A separate dense sample (1,147,519 bytes with 7,500 fenced code blocks) was also remeasured after the parser change. Markdown conversion took 110 ms after receipt and first render took 1,606 ms after CLI start. The previous pause of more than 25 seconds did not recur.

## Repeat the measurement

Measurement build:

```sh
VITE_MJP_PERF=1 npm run tauri build -- --bundles app --features perf
```

Normal build:

```sh
npm run tauri build -- --bundles app
```

Only the current measurement build writes stage timestamps to CSV with `MJP_PERF_LOG=/path/to/log.csv mjp <file>`. Setting `MJP_PERF_LOG` on a normal build does not enable recording.

## Display modes measured on 2026-10-09

On macOS 26.6.2 / arm64, a Tauri release measurement build was tested at the 128 KiB Markdown limit, one byte above it, and at the 10 MiB file limit. Larger inputs use complete plain-text display. Each cell below is one launch, measured from GUI process entry to the second animation frame after content insertion; it excludes the short CLI parent phase and is a display proxy, not a precise pixel-presentation timestamp.

| Input pattern | 128 KiB, Markdown | 128 KiB + 1 B, plain text | 10 MiB, plain text |
| --- | ---: | ---: | ---: |
| Repeated short JavaScript fences | 1.181 s | 0.956 s | 1.795 s |
| Repeated 64-level quote prefixes with list text | 1.368 s | 0.878 s | 1.548 s |
| Repeated links, 16 per paragraph | 0.765 s | 1.009 s | 1.136 s |

Inputs were ASCII patterns repeated and truncated to the exact byte size. All nine launches met the selected two-second target on this machine. These observations do not establish a worst-case bound for every input or hardware configuration. Plain-text launches emitted no Markdown-parsed mark, confirming that mode selection happened before parsing. DOM tests separately check the byte boundary, multibyte text, return to formatted display, and error/warning updates without replacing unchanged content.
