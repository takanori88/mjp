# Yazi + Neovim + mjp

[日本語](../ja/YAZI.md) · [README](../../README.md#yazi--neovim--mjp)

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
