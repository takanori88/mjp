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

読み取り可能な通常の UTF-8 ファイルを1つ指定します。上限は 10 MiB です。相対パスと絶対パスに対応し、拡張子による制限はありません。エラーはウィンドウを開く前にターミナルへ出力します。現時点では CLI オプションはありません。

128 KiB以下のファイルはMarkdownとして整形します。これを超えるファイルは初回表示を速く保つため、案内とともに全文をプレーンテキストで表示します。どちらの表示でも自動更新できます。

`http:`、`https:`、`mailto:` のリンクは OS の既定アプリで開きます。相対リンクと画像は現在のプレビューでは開いたり読み込んだりしません。

## キーボード操作

| キー | 動作 |
| --- | --- |
| `Esc`、`q`、`⌘W` | macOS でプレビューを閉じる |
| `j`、`k` | 下／上にスクロール |
| `Ctrl+D`、`Ctrl+U` | 半画面分、下／上にスクロール |
| `gg` | 先頭へ移動（2回の `g` を1秒以内に押す） |
| `G`（`Shift+G`） | 末尾へ移動 |

## インストール

公開済みのパッケージやインストーラーはまだありません。このリポジトリを取得した状態から、macOS アプリをソースビルドできます。

```sh
npm ci
npm run build:release -- --bundles app
./src-tauri/target/release/mjp README.md
```

生成されるコマンドは `mjp` です。アプリバンドルは `src-tauri/target/release/bundle/macos/` に作られます。

共有するバイナリは `build:release` で作成してください。依存ライブラリを含むコンパイル時に、ビルド環境のホーム、Cargo、Rustup、チェックアウトのパスを共通の `/build/` 配下のパスへ置き換えます。環境変数で指定された既存のコンパイラフラグは保持します。`cargo build` や `tauri build` を直接実行した場合、この置換は適用されません。生成された文字列やリンカーの出力には別のパスが含まれる可能性があるため、配布前には完成した実行ファイルを確認してください。

## 開発

CLI、ウィンドウ、ファイル監視には Tauri 2 と Rust を使用します。プレビューは Vanilla TypeScript、Vite、markdown-it、DOMPurify、highlight.js で構成しています。開発・検証対象は現在 macOS Apple Silicon です。Rust 1.90以降、Node.js 24.xの24.15.0以降、npm、Tauriが要求するmacOS開発ツールを使用してください。DOMテストにはjsdomとTypeScriptに対応したNode標準テストランナーを使います。

```sh
npm ci
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run build:release -- --bundles app
```

製品の目的は [PROJECT.md](PROJECT.md)、設計判断は [PLAN.md](PLAN.md)、測定結果は [PERFORMANCE.md](PERFORMANCE.md) を参照してください。

ルートの英語版が標準文書で、日本語版は `docs/ja/` に置いています。
