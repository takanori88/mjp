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
npm run tauri build -- --bundles app
./src-tauri/target/release/mjp README.md
```

GitHub リポジトリ名は旧名の `mdq` のままですが、生成されるコマンドは `mjp` です。アプリバンドルは `src-tauri/target/release/bundle/macos/` に作られます。

## 開発

CLI、ウィンドウ、ファイル監視には Tauri 2 と Rust を使用します。プレビューは Vanilla TypeScript、Vite、markdown-it、DOMPurify、highlight.js で構成しています。開発・検証対象は現在 macOS Apple Silicon です。ビルドには Rust 1.90 以降、Node.js `^20.19.0` または `>=22.12.0`、npm、Tauri が要求する macOS 開発ツールが必要です。

```sh
npm ci
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles app
```

製品の目的は [PROJECT.md](PROJECT.md)、設計判断は [PLAN.md](PLAN.md)、改名前の測定結果は [PERFORMANCE.md](PERFORMANCE.md) を参照してください。

ルートの英語版が標準文書で、日本語版は `docs/ja/` に置いています。
