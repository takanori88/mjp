# Third-party dependencies

[日本語](docs/ja/THIRD_PARTY.md)

The MIT license in this repository covers mjp's own code. Dependencies retain their upstream licenses. Their source is not vendored in this repository; npm and Cargo obtain it when building.

This table records the direct application dependencies (and tauri-build) resolved for 0.1.0. `package-lock.json` and `src-tauri/Cargo.lock` record the full dependency graph, including development and transitive packages. Consult the license files in each exact package before redistributing its code or a binary containing it.

| Package | Version | Upstream license expression | Package source |
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

`OR` expressions offer alternative licenses; `AND` expressions require all listed terms. Transitive Rust dependencies include MPL-2.0 and Unicode-3.0 components. The MPL permits combination with separately licensed code, while requiring recipients of compiled MPL components to be told where their corresponding source is available. See the [Mozilla FAQ, question 8](https://www.mozilla.org/en-US/MPL/2.0/FAQ/#q8-i-want-to-distribute-outside-my-organization-executable-programs-or-libraries-that-i-have-compiled-from-someone-elses-unchanged-mpl-licensed-source-code-either-standalone-or-part-of-a-larger-work-what-do-i-have-to-do).

The initial publication is source-only. This overview is not a complete binary-distribution notice bundle. Before distributing binaries, collect the exact included dependency versions, their copyright and license texts, required NOTICE files, Rust runtime notices, and source-availability information. Some crate archives refer to license files in their upstream repository; resolve those files at the crate's recorded source revision rather than substituting a generic license text.
