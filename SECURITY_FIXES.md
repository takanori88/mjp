# セキュリティレビュー対応指示

2026-10-07時点のソースコード（`main` = `00a23a8`）をセキュリティレビューした結果、
即座に悪用可能な脆弱性は見つからなかった。以下は低優先度の改善指示である。

## 前提・制約

- [PROJECT.md](PROJECT.md) の原則（起動速度最優先、UIを増やさない、過剰設計しない）に従うこと。
- 指示された範囲以外の機能追加・リファクタリングはしない。
- 既存のセキュリティ対策（下記「維持すべき対策」）を弱める変更はしない。
- 変更後に以下が通ることを確認する。
  - `npm run build`
  - `cd src-tauri && cargo test`
- 修正ごとにコミットを分ける。

---

## 1. Live Reload時に通常ファイル以外を読まない

**対象:** [src-tauri/src/lib.rs](src-tauri/src/lib.rs) の `Document::refresh()`

**問題:**
起動時の `load_document()` は `metadata.is_file()` で通常ファイルか検査しているが、
`refresh()` は検査せずに `fs::read_to_string` を呼んでいる。
監視中のファイルがFIFO（名前付きパイプ）に差し替えられると読み込みがブロックし、
監視スレッドが停止してLive Reloadが動かなくなる。

**対応:**
- `refresh()` で読み込み前に `fs::metadata(&self.path)` を取り、`is_file()` でなければ読まずにエラー扱いにする。
- エラーメッセージは既存の `Cannot read file: ...` と同じ流れで `snapshot.error` に入れる（例: `Cannot read file: not a regular file`）。
- 既存のリトライ（35ms × 2回）の挙動は変えない。

**テスト:**
- 監視対象をディレクトリに差し替えた場合に `refresh()` がブロックせず、`error` が設定されることを確認するユニットテストを追加する。
  （FIFOはプラットフォーム依存になるため、ディレクトリでの代替検証でよい）

---

## 2. 読み込むファイルサイズに上限を設ける

**対象:** [src-tauri/src/lib.rs](src-tauri/src/lib.rs) の `load_document()` と `Document::refresh()`

**問題:**
ファイル全体をメモリに読み込み、WebViewのメインスレッドでレンダリングするため、
巨大なファイルを開くとメモリを消費しUIが固まる。

**対応:**
- 定数で上限を定義する（目安: `10 * 1024 * 1024` バイト = 10 MiB）。
- `load_document()`: `metadata.len()` が上限を超えたらGUIを起動せずCLIエラーで終了する。
  - メッセージ例: `mdq: huge.md: file is too large (max 10 MiB)`
- `refresh()`: 上限を超えた場合は前回の内容を表示したまま `snapshot.error` にメッセージを設定する（削除時と同じ扱い）。

**テスト:**
- 上限を超えるファイルで `load_document()` がエラーになることを確認する。
  テストで大きなファイルを書かずに済むよう、上限判定を関数に切り出して境界値を検証する形でもよい。

---

## 3. リンクの遷移先URLをホバーで確認できるようにする

**対象:** [src/main.ts](src/main.ts)

**問題:**
UIにステータスバーがないため、`[公式サイト](https://evil.example)` のようにリンクテキストと遷移先が異なっていても、
クリック前に遷移先を確認できない。

**対応:**
- レンダリング後の `a[href]` に対して、`title` 属性が未設定であれば `href` の値を `title` に設定する。
  - Markdownで `[text](url "title")` と明示されたtitleがある場合は上書きしない。
- 実装はDOMPurifyによるサニタイズの**後**に行う（属性値は `setAttribute` で設定し、HTML文字列連結はしない）。
- ツールチップ以外のUI（ステータスバー、確認ダイアログ等）は追加しない。

**テスト:**
- 手動確認でよい: リンクにホバーするとURLがツールチップ表示されること、明示titleが保持されること。

---

## 4. （記録のみ・今回は対応不要）Windows/Linuxでのナビゲーション許可

**対象:** [src-tauri/src/lib.rs](src-tauri/src/lib.rs) の `on_navigation`

現在は `tauri:` スキームのみ許可している。Windowsの本番ビルドではアプリのURLが
`http://tauri.localhost` になるため、初期ページの読み込みが拒否される可能性がある。
Phase 1はmacOSのみが対象なので**今回は変更しない**。
Windows/Linux対応時に実機で確認する事項として、必要なら [PLAN.md](PLAN.md) に一行追記する。

---

## 維持すべき対策（変更しないこと）

| 対策 | 場所 |
|---|---|
| markdown-it `html: false` | `src/main.ts` |
| DOMPurifyで `script`/`style`/`iframe`/`object`/`embed`/`form`/`img`/`svg` と `style` 属性を禁止 | `src/main.ts` |
| 画像を代替テキストに変換（外部リソースを読み込まない） | `src/main.ts` |
| リンクは `http`/`https`/`mailto` のみ、フロントとRust両方で検証 | `src/main.ts`, `open_external` |
| 厳格なCSP（`script-src 'self'`, `img-src 'none'` 等） | `src-tauri/tauri.conf.json` |
| `on_navigation` で外部遷移を拒否、`on_new_window` で新規ウィンドウを拒否 | `src-tauri/src/lib.rs` |
| capabilityは `core:event:allow-listen` / `allow-unlisten` のみ | `src-tauri/capabilities/default.json` |
| GUI子プロセスはshellを介さず正規化済み絶対パスで起動 | `src-tauri/src/launch.rs` |

## 完了報告に含めること

- 各項目の変更概要とコミットハッシュ
- 追加したテストと実行結果
- 手動確認した内容（項目3）
