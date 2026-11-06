# Configuration

[日本語](../ja/CONFIGURATION.md) · [README](../../README.md#configuration)

## File location and loading

Create `~/.config/mjp/config.toml` to configure previews. The location is fixed at `$HOME/.config/mjp/config.toml`; mjp does not use `XDG_CONFIG_HOME` and does not follow the XDG configuration specification. This gives terminal and Finder launches the same location when they have the same `HOME`. Changing `HOME` in a terminal selects a different location. An unset, empty, or relative `HOME` disables configuration silently.

Each GUI process reads configuration once before creating its first window. Settings apply to document, stdin, Welcome, and failure previews, including windows added later to the same process through Finder requests. Changes apply only to a new process: quit the receiving app before relaunching to use changed settings. There is no settings UI or runtime toggle.

The owner confirmed the native checks for Issue #37 slices 1–4 on 2026-11-06, including theme rendering and OS appearance changes, Finder startup, dimensions, placement and cascading, and always-on-top interaction. See the [Issue #37 verification record](https://github.com/takanori88/mjp/issues/37). Configuration loading's effect on startup time remains unmeasured on the target Mac.

## Warnings and defaults

Configuration must be a regular UTF-8 TOML file of at most 64 KiB; symbolic links to regular files are followed. A missing file is silent; a detected dangling link at `config.toml` produces a warning. Read failures and invalid TOML, including `01` or duplicate keys, discard all settings and use defaults with an in-window warning.

Invalid fields use the defaults described below while independent valid settings still apply. Unknown top-level settings produce warnings. A non-table `window` uses default window settings with one warning. Unknown keys directly under `window` each produce a warning; unknown nested tables produce one warning without inspecting their contents.

Warnings share the status banner, with live-reload warnings first. At most three warnings are displayed, each limited to 200 characters including any `…`, followed by the omitted count. A read error temporarily takes precedence, and warnings return after recovery.

## Theme configuration

```toml
theme = "dark"
```

Use `"light"` or `"dark"` for a fixed appearance. `"system"`, an omitted `theme`, or a missing file follows the OS appearance, including changes while mjp is running. Values are case-sensitive. An invalid `theme` uses `"system"`. There is no `--theme` CLI option.

## Window size configuration

Set either or both initial content dimensions:

```toml
[window]
width = 1000
height = 700
```

Dimensions use logical pixels (points on macOS), excluding the title bar. Previews open centered unless a position is configured below; an omitted or invalid width uses 800, and an omitted or invalid height uses 600. Each value must be an integer written with ASCII digits only, from `1` to `4294967295`. Signs (`+1000`), separators (`1_000`), base prefixes (`0x3e8`), floats, and strings are rejected with a warning for that field; the other dimension and theme still apply.

A valid explicit dimension enables Tauri's initial overflow prevention against the primary display's work area. The OS and display can constrain the actual content size; the entire title bar is not guaranteed to fit. Without valid explicit dimensions, the existing 800×600 size is retained. Manual resizing or moving to another display does not trigger another fit.

## Window position configuration

Open previews at the top right of the primary display's work area (excluding the menu bar and Dock). If you also set dimensions, combine these keys in one `[window]` table:

```toml
[window]
position = "top-right"
margin_x = 16
margin_y = 16
```

`margin_x` is the distance from the right edge and `margin_y` from the top edge, in logical pixels (points on macOS). Each defaults to 16 and accepts integers from `0` to `4294967295`, written with ASCII digits only. Invalid margins produce one warning per field and use 16; valid margins without `position` are accepted silently and have no placement effect. Only the case-sensitive string `"top-right"` is supported. An omitted position keeps centered placement without cascading; an invalid position does the same with a warning. If the primary display cannot be obtained, previews open centered without a warning and keep the configured dimensions.

Successive windows in the same process cascade 24 points left and down. The step is fixed. Positions wrap after the number that fit in the work area, so displayed positions can overlap. New windows reuse the smallest free cascade slot after closed windows are destroyed; moving a window manually does not change its slot. Welcome and failure previews share these rules. While Welcome occupies slot 0, the first document uses slot 1, and Welcome closes only after that document window is created successfully. Reopening an already open document only focuses it. Separate processes, including separate CLI launches, do not coordinate their positions.

The work area is read for each new window. Margins shrink when necessary to prioritize fitting; a content dimension larger than the work area aligns that axis to its left or top edge. Explicit dimensions still use the size fitting described above. Positioning aligns the outer top-left corner, but the title bar is not included in the bottom-edge calculation, so the outer bottom edge may extend by its height. Mixed-scale displays and left/right Dock placement remain unchecked on the target Mac.

## Always-on-top configuration

Keep previews above ordinary windows when another app is active in a normal desktop Space:

```toml
[window]
always_on_top = true
```

Add this key to the same `[window]` table as any dimensions or position settings. Only TOML booleans `true` and `false` are accepted. An omitted key or `false` keeps ordinary window behavior. Other types, such as `"true"`, `1`, or `[]`, use `false` with one warning while valid theme, size, and position settings still apply. This setting does not change size or placement.

This does not guarantee display on another Space or above a fullscreen app, or priority over other windows at the same or a higher level (including other apps' always-on-top windows). mjp windows share a level and can overlap normally; their stacking order is not fixed by opening order or cascade slot. On 2026-11-06, the owner confirmed that mjp is hidden in a Space where Chrome is fullscreen.

## Complete example

Use one `[window]` table for all window settings:

```toml
theme = "dark"

[window]
width = 1000
height = 700
position = "top-right"
margin_x = 16
margin_y = 16
always_on_top = true
```
