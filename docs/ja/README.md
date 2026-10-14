# mjp

[English](../../README.md)

**Markdown. Just Preview.**

`mjp` は、ターミナルから Markdown ファイルを小さな GUI ウィンドウで開くツールです。エディタを起動せず、編集用の UI も加えず、素早く読むことに専念します。macOS のリリース版では、プレビューウィンドウを開いたままシェルのプロンプトに戻ります。

```sh
mjp README.md
```

## 機能

- 表やタスクリストを含む Markdown を単一ウィンドウに表示
- 主な言語の fenced code block をシンタックスハイライト
- OS のライト／ダーク表示に自動追従
- ファイル変更時に自動更新し、可能な範囲でスクロール位置を維持
- キーボードでの移動と素早い終了
- macOS のリリース版では、ウィンドウを開いたままシェルへ復帰

## 使い方

```sh
mjp <file>
```

読み取り可能な通常の UTF-8 ファイルを1つ指定します。上限は 10 MiB です。相対パスと絶対パスに対応し、拡張子による制限はありません。エラーはウィンドウを開く前にターミナルへ出力します。`mjp --help`（`-h`）で使い方、`mjp --version`（`-V`）でバージョンを表示します。名前がハイフンで始まるファイルには `mjp -- -notes.md` を使います。

128 KiB以下のファイルはMarkdownとして整形します。これを超えるファイルは初回表示を速く保つため、案内とともに全文をプレーンテキストで表示します。どちらの表示でも自動更新できます。

`http:`、`https:`、`mailto:` のリンクは OS の既定アプリで開きます。相対リンクと画像は現在のプレビューでは開いたり読み込んだりしません。

### Yazi + Neovim + mjp

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

## キーボード操作

| キー | 動作 |
| --- | --- |
| `Esc`、`q`、`⌘W` | macOS でプレビューを閉じる |
| `j`、`k` | 下／上にスクロール |
| `Ctrl+D`、`Ctrl+U` | 半画面分、下／上にスクロール |
| `gg` | 先頭へ移動（2回の `g` を1秒以内に押す） |
| `G`（`Shift+G`） | 末尾へ移動 |

## インストール

初回は macOS Apple Silicon 向けのソース公開です。公開済みのバイナリ、インストーラー、Homebrew パッケージはまだありません。

[Xcode Command Line Tools](https://v2.tauri.app/start/prerequisites/#macos)、Rust 1.90以降、Node.js 24.x（24.15.0以降）と npm を用意し、リポジトリのルートでビルドします。

```sh
git clone https://github.com/takanori88/mjp.git
cd mjp
npm ci
npm run build:release -- --bundles app -- --locked
./src-tauri/target/release/mjp README.md
```

生成されるコマンドは `mjp` です。アプリバンドルは `src-tauri/target/release/bundle/macos/` に作られます。

ユーザーアカウント用の CLI としてインストールするには、次を実行します。

```sh
mkdir -p "$HOME/.local/bin"
install -m 755 src-tauri/target/release/mjp "$HOME/.local/bin/mjp"
export PATH="$HOME/.local/bin:$PATH"
mjp --version
mjp README.md
```

新しいターミナルでも使えるよう、`export PATH` の行を `~/.zshrc` などのシェル起動ファイルに追加してください。更新時は再ビルドして `install` を繰り返し、削除時は `~/.local/bin/mjp` を削除します。インストールしたコマンドの実行に Node.js や Rust は不要です。

`.app` 内の `mjp.app/Contents/MacOS/mjp` も同じコマンドで、ターミナルからファイルを渡して使います。Finder で開いてファイルを選ぶ方式ではありません。ここで作成するビルドは Developer ID 署名・公証を行いません。バイナリ配布と、そのインストール体験の整備は後の段階です。

共有するバイナリは `build:release` で作成してください。依存ライブラリを含むコンパイル時に、ビルド環境のホーム、Cargo、Rustup、チェックアウトのパスを共通の `/build/` 配下のパスへ置き換えます。環境変数で指定された既存のコンパイラフラグは保持します。`cargo build` や `tauri build` を直接実行した場合、この置換は適用されません。生成された文字列やリンカーの出力には別のパスが含まれる可能性があるため、配布前には完成した実行ファイルを確認してください。

## 開発

CLI、ウィンドウ、ファイル監視には Tauri 2 と Rust を使用します。プレビューは Vanilla TypeScript、Vite、markdown-it、DOMPurify、highlight.js で構成しています。開発・検証対象は現在 macOS Apple Silicon です。Rust 1.90以降、Node.js 24.xの24.15.0以降、npm、Tauriが要求するmacOS開発ツールを使用してください。DOMテストにはjsdomとTypeScriptに対応したNode標準テストランナーを使います。

```sh
npm ci
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run build:release -- --bundles app -- --locked
```

製品の目的は [PROJECT.md](PROJECT.md)、設計判断は [PLAN.md](PLAN.md)、測定結果は [PERFORMANCE.md](PERFORMANCE.md) を参照してください。

英語版を標準文書とし、詳細文書は [docs/en/](../en/)、英語の README は[リポジトリのルート](../../README.md)に置いています。日本語版は `docs/ja/` に置いています。

## ライセンス

mjp は [MIT License](../../LICENSE) です。著作権表示は 2026 takanori88 としています。依存物には各プロジェクトのライセンスが適用されます。[第三者の依存物](THIRD_PARTY.md) と、ソース公開手順の [RELEASING.md](RELEASING.md) を参照してください。
