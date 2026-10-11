# 第三者の依存物

[English](../../THIRD_PARTY.md)

このリポジトリの MIT License は mjp 自身のコードに適用されます。依存物には各プロジェクトのライセンスが適用されます。依存物のソースはリポジトリに同梱せず、ビルド時に npm と Cargo が取得します。

次の表は 0.1.0 で解決されたアプリの直接依存と tauri-build を記録しています。開発用・間接依存を含む全体のバージョンは `package-lock.json` と `src-tauri/Cargo.lock` に固定されています。依存物のコードや、それを含むバイナリを再配布するときは、各バージョンのライセンスファイルを確認してください。

| パッケージ | バージョン | 元のライセンス式 | パッケージのソース |
| --- | --- | --- | --- |
| @tauri-apps/api | 2.12.1 | Apache-2.0 OR MIT | https://www.npmjs.com/package/@tauri-apps/api/v/2.12.1 |
| DOMPurify | 3.4.16 | MPL-2.0 OR Apache-2.0 | https://www.npmjs.com/package/dompurify/v/3.4.16 |
| highlight.js | 11.12.0 | BSD-3-Clause | https://www.npmjs.com/package/highlight.js/v/11.12.0 |
| markdown-it | 15.0.2 | MIT | https://www.npmjs.com/package/markdown-it/v/15.0.2 |
| markdown-it-task-lists | 2.1.1 | ISC | https://www.npmjs.com/package/markdown-it-task-lists/v/2.1.1 |
| tauri | 2.12.1 | Apache-2.0 OR MIT | https://crates.io/crates/tauri/2.12.1 |
| tauri-build (build) | 2.7.1 | Apache-2.0 OR MIT | https://crates.io/crates/tauri-build/2.7.1 |
| tauri-plugin-opener | 2.7.0 | Apache-2.0 OR MIT | https://crates.io/crates/tauri-plugin-opener/2.7.0 |
| notify | 8.2.0 | CC0-1.0 | https://crates.io/crates/notify/8.2.0 |
| serde | 1.0.229 | MIT OR Apache-2.0 | https://crates.io/crates/serde/1.0.229 |
| url | 2.5.8 | MIT OR Apache-2.0 | https://crates.io/crates/url/2.5.8 |
| libc | 0.2.190 | MIT OR Apache-2.0 | https://crates.io/crates/libc/0.2.190 |

`OR` は選択可能なライセンス、`AND` は列挙された条件をすべて満たすことを表します。Rust の間接依存には MPL-2.0 と Unicode-3.0 のものもあります。MPL は別のライセンスのコードとの組み合わせを認めますが、MPL 部分をコンパイルして配布する際には、対応するソースの入手先を利用者へ案内する必要があります。[Mozilla FAQ の質問8](https://www.mozilla.org/en-US/MPL/2.0/FAQ/#q8-i-want-to-distribute-outside-my-organization-executable-programs-or-libraries-that-i-have-compiled-from-someone-elses-unchanged-mpl-licensed-source-code-either-standalone-or-part-of-a-larger-work-what-do-i-have-to-do)を参照してください。

初回はソースのみの公開です。この一覧は、バイナリ配布に必要な表示をすべて同梱したものではありません。バイナリ配布前に、実際に含まれる依存バージョン、著作権・ライセンス本文、必要な NOTICE、Rust ランタイムの表示、対応するソースの入手先を揃えます。一部の crate は上流リポジトリのライセンスを参照しているため、一般的なライセンス本文で代用せず、その crate に記録されたソースのリビジョンから取得します。
