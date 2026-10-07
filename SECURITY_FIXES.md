# セキュリティレビュー対応指示

2026-10-07時点のソースコード（`main` = `00a23a8`）をセキュリティレビューした結果、
即座に悪用可能な脆弱性は見つからなかった。以下は低優先度の改善指示である。
Codexによる確認結果（テスト設計、TOCTOU、読み込み上限、title表示、Linuxの扱い）を反映済み。

## 前提・制約

- [PROJECT.md](PROJECT.md) の原則（起動速度最優先、UIを増やさない、過剰設計しない）に従うこと。
- 指示された範囲以外の機能追加・リファクタリングはしない。
- 既存のセキュリティ対策（下記「維持すべき対策」）を弱める変更はしない。
- 変更後に以下が通ることを確認する。
  - `npm run build`
  - `cd src-tauri && cargo test`
- 修正ごとにコミットを分ける。

---

## 1. 通常ファイル以外を読まない（FIFO対策）

**対象:** [src-tauri/src/lib.rs](src-tauri/src/lib.rs) の `load_document()` と `Document::refresh()`、[src-tauri/Cargo.toml](src-tauri/Cargo.toml)

**問題:**
起動時の `load_document()` は `metadata.is_file()` で検査しているが、検査と読み込みが別の操作のため、
間にファイルを差し替えられると検査をすり抜ける。
`refresh()` は検査自体をしていない。
監視中のファイルがFIFO（名前付きパイプ）に差し替えられると読み込みがブロックし、
監視スレッドが停止してLive Reloadが動かなくなる。

さらに、FIFOは `open()` の時点で書き込み側が現れるまでブロックするため、
「開いてからハンドルで検査する」だけでは不十分である。

**対応:**
- ファイルを読む処理を1つの関数（例: `read_markdown(path) -> io::Result<String>`）にまとめ、`load_document()` と `refresh()` の両方から使う。
- その関数では次の順で処理する。
  1. Unixでは `std::os::unix::fs::OpenOptionsExt::custom_flags(libc::O_NONBLOCK)` を付けて開く（FIFOでも `open()` がブロックしない）。
  2. 開いたハンドルの `file.metadata()`（fstat）で `is_file()` を検査する。通常ファイルでなければ読まずにエラーを返す。
  3. 項目2のサイズ上限を適用して読み込む。
- 非Unix（Windows）では `O_NONBLOCK` を付けずに開き、2以降は同じにする。`#[cfg(unix)]` で分岐する。
- `libc` は現在macOS専用の依存になっているため、`[target.'cfg(unix)'.dependencies]` に移す。
- 検査済みのハンドルから読むことで、検査と読み込みの間の差し替え（TOCTOU）も防げる。
- 既存のエラーメッセージ（`file not found`、`not a regular file`、`file is not valid UTF-8` など）とリトライ（35ms × 2回）の挙動は変えない。
- `refresh()` で通常ファイル以外を検出した場合は、前回の内容を表示したまま `snapshot.error` に設定する（例: `Cannot read file: not a regular file`）。
- [AGENTS.md](AGENTS.md) の方針に従い、`O_NONBLOCK` を付ける理由（FIFOは `open()` でブロックするため）と、ハンドルで検査する理由（TOCTOU対策）をコードコメントに残す。

**テスト（Unixのみ、`#[cfg(unix)]`）:**
- `libc::mkfifo` で実際にFIFOを作り、`read_markdown()` がブロックせずにエラーを返すことを確認する。
  - 書き込み側は開かないこと（開くとブロックしない状態になり検証にならない）。
  - 修正漏れで無限にブロックしないよう、別スレッドで実行して `mpsc::Receiver::recv_timeout`（例: 2秒）で待ち、タイムアウトしたら失敗にする。
- 通常ファイル → FIFOへの差し替え後に `refresh()` がブロックせず、`error` が設定され前回の `text` が保持されることを確認する。
- ディレクトリでの検証は現行コードでも読み取りエラーになり修正を検証できないため、使わない。

---

## 2. 読み込むファイルサイズに上限を設ける

**対象:** 項目1で作る読み込み関数

**問題:**
ファイル全体をメモリに読み込み、WebViewのメインスレッドでレンダリングするため、
巨大なファイルを開くとメモリを消費しUIが固まる。

**対応:**
- 定数で上限を定義する（目安: `10 * 1024 * 1024` バイト = 10 MiB）。
- ハンドルの `metadata().len()` が上限を超えたら読まずにエラーにする。
- 加えて、読み込み自体を `Read::take(上限 + 1)` で制限し、読めたバイト数が上限を超えたらエラーにする。
  事前検査の後に読み込み中にファイルが伸びた場合にも対応するため。
- `load_document()`: GUIを起動せずCLIエラーで終了する。
  - メッセージ例: `mdq: huge.md: file is too large (max 10 MiB)`
- `refresh()`: 前回の内容を表示したまま `snapshot.error` にメッセージを設定する（削除時と同じ扱い）。

**テスト:**
- `File::set_len(上限 + 1)` で疎ファイルを作り、ディスクを消費せずに上限超過でエラーになることを確認する。
- 上限ちょうどのファイルは読めることを確認する（境界値）。

---

## 3. リンクの遷移先URLをホバーで確認できるようにする（UX改善）

**対象:** [src/main.ts](src/main.ts)

**位置づけ:**
これは使い勝手の改善であり、セキュリティ対策ではない。
ただし、表示内容がリンク先と食い違わないことを要件とする。

**問題:**
UIにステータスバーがないため、`[公式サイト](https://evil.example)` のようにリンクテキストと遷移先が異なっていても、
クリック前に遷移先を確認できない。
また、Markdownで明示された `title` をそのまま表示すると、title側に偽のURLを書けてしまう。

**対応:**
- レンダリング後の `a[href]` に対して、クリック時と同じ検証・正規化を通ったURLをツールチップの先頭に表示する。
  - `title` が未設定: `title` = `正規化済みURL`
  - `title` が明示されている: `title` = `正規化済みURL + "\n" + 明示されたtitle`
  - 開かない相対リンクや未対応スキームには追加のツールチップを設定しない。
- 実装はDOMPurifyによるサニタイズの**後**に行う（属性値は `setAttribute` で設定し、HTML文字列連結はしない）。
- ツールチップ以外のUI（ステータスバー、確認ダイアログ等）は追加しない。

**テスト:**
- 手動確認でよい: title なし・ありの両方で、ツールチップに遷移先URLが表示されること。

---

## 4. （記録のみ・今回は対応不要）Windowsでのナビゲーション許可

**対象:** [src-tauri/src/lib.rs](src-tauri/src/lib.rs) の `on_navigation`

現在は `tauri:` スキームのみ許可している。Windowsの本番ビルドではアプリのURLが
`http://tauri.localhost` になるため、初期ページの読み込みが拒否される可能性がある。
Linuxは通常 `tauri://localhost` のため影響は小さい。
Phase 1はmacOSのみが対象なので**今回は変更しない**。
Windows対応時に実機で確認する事項として、必要なら [PLAN.md](PLAN.md) に一行追記する。

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
- 項目1・2のテストが、修正前のコードでは失敗（またはタイムアウト）することを確認した結果
