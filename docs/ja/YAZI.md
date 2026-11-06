# Yazi + Neovim + mjp

[English](../en/YAZI.md) · [README](README.md#yazi--neovim--mjp)

Yazi でファイルを選び、Neovim で編集し、`mjp` の別ウィンドウで保存後の表示を確認できます。ファイルを介して連携するため、エディタ用のプラグインは不要です。

この使い方は Yazi 26.1.22 と macOS の mjp リリース版で手動確認しています。`mjp` と `nvim` に `PATH` が通っていることを確認し、次の設定を `~/.config/yazi/yazi.toml` に追加してください。既存のセクションがある場合は、その中に追加してセクションを重複させないでください。

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

すでに `open.rules` を定義している場合は、代わりにそのリストの先頭へ上記の Markdown 用ルール2行を追加しても構いません。`text/*` のルールより前に置き、残りのルールは維持してください。`%s1` は選択した最初のファイルを渡します。設定記法は [Yazi の opener 設定](https://yazi-rs.github.io/docs/configuration/yazi/#opener)を参照してください。`piper` と `bat` など、Yazi 内のプレビュー設定はそのまま併用できます。

1. Yazi を再起動し、ローカルの Markdown ファイルを1つ選んで Enter を押します。
2. **起動直後は mjp にフォーカスが移ります。Neovim で編集する前に、ターミナルへフォーカスを戻してください。**
3. `:w` で保存すると、mjp のプレビューが自動更新されます。
4. Neovim を終了すると Yazi に戻ります。プレビューは開いたままなので、読み終えたら mjp にフォーカスして `Esc` または `q` で閉じます。

macOS のリリース版は mjp 自身がプレビューを別プロセスに切り離すため、CLI の成功後に `&&` で Neovim を起動できます。`block = true` は Neovim の終了までターミナルを使えるようにする指定です。この opener に `&` や `orphan = true` は不要です。この使い方はリリース版を前提としており、`tauri dev` は対象外です。
