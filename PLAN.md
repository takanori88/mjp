# mdq Phase 1 調査・設計計画

調査日: 2026-10-06  
対象: macOS Apple Silicon。実装はこの計画の後に開始する。

## 1. 要件と完了条件

`mdq <file>` でMarkdownを一つだけ開き、CLIはすぐシェルへ戻り、GUIは`Esc`で即座に終了する。Phase 1はエディタやファイル管理機能を持たない。

| 領域 | Phase 1 の要件・判定 |
| --- | --- |
| CLI | 相対・絶対パスを受け付け、正常時はGUIを表示したままプロンプトを戻す。引数不足・複数指定・存在しないファイル・ディレクトリ・読めないファイルはGUI起動前に標準エラーへ理由を出し、非0で終了する。Markdown以外の拡張子もテキストとして試みる（拡張子で拒否しない）。UTF-8で読めない場合は明確にエラーにする。 |
| 表示 | CommonMarkとGFMの見出し、段落、強調、取り消し線、リンク、引用、リスト、タスクリスト、表、インラインコード、コードブロック、水平線を表示する。長文と横長の表・コードをスクロールできる。 |
| コード | 主要言語のfenced codeを色分けする。未知の言語はエスケープ済みプレーンテキストとして表示する。 |
| 見た目 | OSのLight/Darkに自動追従し、本文幅、行間、見出し階層、コード・表の可読性を優先する。ツールバー、サイドバー、タブ、設定UIは作らない。 |
| 更新 | 対象ファイルの保存を検出し、自動再描画する。削除・読み取り失敗時はウィンドウ内に小さなエラーを表示し、復旧後に再表示する。可能ならスクロール位置を維持する。 |
| 終了 | `Esc`、macOSの`Cmd+W`、通常の閉じる操作でウィンドウとプロセスを終了する。将来のWindows/Linuxでは`Ctrl+W`も扱う。 |
| 性能 | 起動時間を実測して記録する。正式な閾値は実機の初回測定後に設定し、改善の優先順位を機能追加より高くする。 |

Phase 1で扱わない機能は[PROJECT.md](PROJECT.md)の第6・7・12・14節に従う。特にMermaid、KaTeX、stdin、複数ファイル、配布自動化は後続段階とする。画像は明示された最低限の表示項目に含まれないため、Phase 1では相対・外部画像の読み込みを有効にせず、画像記法を代替テキストへ変換して表示する。画像表示の要否は実機での読書体験を見て次段階で判断する。

後続のUX判断として、最小限のVim風キー操作はQuick Lookの閲覧と終了をマウスなしで完結させるために採用し、編集やモード管理には広げない。

## 2. 公式仕様の確認と技術選択

### Tauri 2

- Tauri 2はRustのアプリ本体とOSのWebViewを組み合わせる。macOSの`.app`には実行ファイルが`Contents/MacOS`に入るため、将来はその実行ファイルへ`mdq`コマンドを導く配布を検討できる。開発中は生成された実行ファイルを直接呼んでCLI動作を検証する。出典: [Tauri Architecture](https://v2.tauri.app/concept/architecture/)、[macOS Application Bundle](https://v2.tauri.app/distribute/macos-application-bundle/)。
- Tauri 2のCLIプラグインは位置引数を扱える。ただし単一のパスだけならRustの`std::env::args_os`で十分で、追加プラグインとJS側の引数取得を省ける。非UTF-8のOSパスも`OsString`として受け取り、ファイル読込時に処理する。`--help`と`--version`の必要性は最小CLIとして実装時に決める。出典: [CLI plugin](https://v2.tauri.app/plugin/cli/)。
- 設定上のウィンドウは`create: false`にでき、検証後だけRust側で作成できる。これによりエラー時に空のウィンドウを出さずに済む。出典: [Tauri Configuration](https://v2.tauri.app/reference/config/)。
- Rustからフロントエンドへの変更通知はイベント、フロントエンドからの本文取得は限定したコマンドで行う。読み込みの主体をRustにまとめる。出典: [Calling Rust from the Frontend](https://v2.tauri.app/develop/calling-rust/)。
- WebViewの権限はcapabilitiesで絞り、CSPは設定しない限り有効にならない。ファイルシステム・shell等の汎用プラグインをフロントエンドに与えない。出典: [Capabilities](https://v2.tauri.app/security/capabilities/)、[CSP](https://v2.tauri.app/security/csp/)。

### Markdownレンダラ候補

| 候補 | 利点 | 懸念 | 判断 |
| --- | --- | --- | --- |
| [Marked](https://github.com/markedjs/marked) | GFMが標準で有効。タスクリスト・表を含め、単一のレンダラで実装しやすい。 | 出力HTMLを無害化しないため、別のサニタイザが必須。 | **採用候補**。GFMの網羅と単純さを優先。 |
| [markdown-it](https://github.com/markdown-it/markdown-it) | CommonMark準拠で高速。HTMLは無効化でき、表・取り消し線も扱える。 | GFMタスクリスト等には追加プラグインが必要。 | Markedで性能・互換性に問題が出た場合の代替。 |
| [remark-parse + remark-gfm](https://github.com/remarkjs/remark-gfm) | GFMを明示的に組み込め、AST拡張に強い。 | HTML化まで複数パッケージと処理段階が必要。 | 今回の単純なviewerには過剰。 |

MarkedのGFM既定値とサニタイズに関する仕様: [Marked Options](https://marked.js.org/using_advanced)、[Marked README](https://github.com/markedjs/marked)。

### シンタックスハイライト候補

| 候補 | 利点 | 懸念 | 判断 |
| --- | --- | --- | --- |
| [highlight.js](https://github.com/highlightjs/highlight.js) | coreと必要言語だけを読み込める。同期的に処理できる。 | すべての言語を登録するとバンドルが増える。 | **採用候補**。最初はJS/TS、JSON、Python、Rust、Shell、HTML/CSSなどに限定し、実測で調整。 |
| [Shiki](https://shiki.style/guide/install) | VS Code系の文法・テーマに近い。 | テーマ・言語・WASMの読み込みが初回表示に影響しうる。 | Phase 1では採用せず、品質差が大きい場合に再評価。 |
| [Prism](https://github.com/PrismJS/prism) | 軽量な基本構成を組める。 | 言語管理と見た目の調整が別途必要。 | highlight.jsとの実測比較が必要な場合のみ検討。 |

言語はコードフェンスで指定されたものだけをハイライトし、自動言語判定は使わない。未知の言語は安全にエスケープして表示する。Light/Dark用のハイライト色はアプリに同梱する。CDNには依存しない。

### 代替構成との比較

macOS専用のSwiftUI + WKWebViewならネイティブ側をさらに絞れる可能性はあるが、Windows/Linuxを視野に入れた設計をやり直すことになる。Tauri 2 + Vanilla TypeScript + Viteを第一案とする。Reactは画面状態が本文・エラー・テーマ程度しかないため採用しない。Viteはビルド時だけ使い、実行時にNode.jsや開発サーバーを必要としない。TauriとWebViewの起動コストが支配的なら、フレームワークを変える前に実測して確認する。

## 3. 最小アーキテクチャ

```text
terminal: mdq README.md
  └─ Rust CLI: 引数検査 → 絶対パス化 → UTF-8読込確認 → GUIを起動して終了
       ├─ GUIプロセス: 成功時のみTauriの単一ウィンドウを作成
       ├─ 親ディレクトリを監視
       └─ 読込コマンド + 変更イベント
            └─ Vanilla TypeScript: Marked → HTML無害化 → 本文DOMへ反映
                 ├─ highlight.js (必要言語のみ)
                 └─ CSS: OSテーマに追従
```

- macOSのリリース版では、CLIが検証済みの絶対パスで同じ実行ファイルをGUI子プロセスとして起動し、端末から切り離して終了する。GUIはウィンドウを閉じるまで動く。`tauri dev`では開発サーバーを保つため前景のまま動かす。常駐デーモン、localhostサーバー、sidecar、single-instanceプラグインは置かない。同時に2回実行した場合は独立した2つのプレビューとする。Windows/Linuxの起動方法は移植時にOS別に実装・検証する。
- 初期表示では、WebViewが変更イベントの受信準備をした後に本文を取得する。イベントと読込が重なった場合は後続の再読込を一度行い、保存内容の取りこぼしを防ぐ。ファイル全文をイベントに載せず、再読込要求だけを送る。
- `Esc`とショートカットは最小のフロントエンド処理で終了要求を出す。ネイティブの閉じる操作も同じ終了経路に集め、macOSでウィンドウだけが閉じてプロセスが残らないことを確認する。
- ウィンドウは幅約800pxの単一画面とし、本文の最大幅をCSSで制限する。狭い画面では画面幅に追従する。装飾は標準タイトルバーを基点とし、起動と操作の実測前に独自タイトルバーを作らない。

## 4. File watching

方式はRustの[notify](https://docs.rs/notify/latest/notify/) `recommended_watcher`を第一案とする。監視対象はファイルそのものではなく親ディレクトリを非再帰で監視し、対象ファイル名に関係するイベントだけを扱う。編集ソフトによって上書き・削除後の再作成・一時ファイルからの置換が異なるため、イベント種別を厳密に解釈せず、短いdebounce（初期値100〜200ms）後に対象パスを読み直す。重複イベントはまとめる。

一時的な読み取り失敗は短く再試行し、なお失敗した場合は最後の正常表示を残してエラーを示す。ファイルが復旧したら自動で消す。再描画前後のスクロール位置は絶対値をまず維持し、長さが大きく変わったときは新しい最大値に収める。監視資源は終了時に解放する。`notify`の公式資料はネットワークファイルシステムでイベントが届かない可能性を記載しているため、初回リリースの動作保証はローカルファイルとし、必要なら後続でpollingを検討する。

Tauriの[fs plugin](https://v2.tauri.app/plugin/file-system/)にもwatch APIはあるが、今回それを使うとフロントエンドにファイルアクセス範囲・権限を追加する必要がある。Rust内で読込と監視を完結させる方が境界を小さく保てる。

## 5. セキュリティとリンク方針

1. 入力Markdownは信頼しない。Markedが生成したHTMLを[DOMPurify](https://github.com/cure53/DOMPurify)でHTMLプロファイルと必要最小限のタグ・属性に絞って無害化してからDOMへ入れる。`script`、イベント属性、フォーム、iframe、SVG/MathML、危険なURLを許可しない。raw HTMLはPhase 1の機能として保証せず、安全なタグ以外は表示しない。
2. HTMLの無害化に加えて、CSPでアプリ同梱のスクリプト・スタイルとTauri IPCだけを許し、リモートスクリプト・フレーム・オブジェクト・フォーム送信を拒否する。`img-src`は初期段階でリモート・任意ローカルを許可しない。CSPの正確な値はTauriが挿入するハッシュ/nonceとIPCソースを踏まえて実装時に検証する。
3. リンククリックはアプリ内WebViewを移動させない。`https:`、`http:`、`mailto:`だけを明示的に検査し、OS既定のアプリへ渡す。`javascript:`、`data:`、`file:`、相対リンクはPhase 1では開かない。Tauriの[opener](https://v2.tauri.app/plugin/opener/)を使う場合も、フロントエンドへ無制限のopen権限を与えず、Rust側の限定コマンドでURLを再検査する。WebViewの通常ナビゲーション・新規ウィンドウ要求もアプリ内URL以外は拒否する。
4. 汎用fs/shell/HTTP権限、外部CDN、ファイルをWebViewへ直接公開する広いasset protocol scopeは使わない。入力が大きすぎる場合の上限とエラー表示は性能測定時に決める。Markdown中のリンクと画像から任意ファイルを読めないことを確認する。

## 6. 提案ディレクトリ構成

```text
mdq/
├── PROJECT.md
├── PLAN.md
├── package.json
├── index.html
├── vite.config.ts
├── src/
│   ├── main.ts          # 読込・更新・終了イベント
│   ├── render.ts        # Marked / DOMPurify / highlight.js
│   └── style.css        # 本文、Light/Dark、スクロール
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   └── src/
│       ├── main.rs       # CLIの入口
│       └── lib.rs        # Tauri起動・読込・監視・リンク
└── tests/               # 必要なCLI・安全性フィクスチャ
```

ファイル分割は実装量に応じて増やす。UIフレームワーク、状態管理ライブラリ、ルーターは導入しない。

## 7. Phase 1 実装順と確認方法

1. **起動の縦断経路**: Tauri 2 + Vanilla TypeScriptを最小構成で起こし、`mdq <file>`のRust引数検査から単一ウィンドウにプレーンテキストを表示し、CLIを終了させる。絶対・相対パス、空・複数引数、存在しない/読めないファイル、終了コードを確認する。生成バイナリと`.app`内実行ファイルの両方で動作を試す。
2. **レンダリング**: Marked、DOMPurify、必要言語だけのhighlight.jsを入れる。PROJECT.mdにある記法を一枚に集めた確認用Markdownで表示を確認する。未知のコード言語・長文・表・コードの横スクロールを確認する。
3. **見た目と操作**: Light/Dark、自動切替、標準タイトルバー、スクロール、`Esc`/`Cmd+W`/Closeによるプロセス終了を実機で確認する。
4. **Live Reload**: 親ディレクトリ監視とdebounceを加え、通常保存・atomic save・削除と再作成・連続保存を試す。スクロール位置の維持を可能な範囲で入れる。
5. **安全性と性能の仕上げ**: `<script>`、イベント属性、`javascript:`リンク、危険な画像URLなどを含む入力を試し、コードが実行されずWebViewが外部へ移動しないことを確認する。クリーン起動と連続起動の「コマンド開始→本文表示」、メモリ使用量、JSバンドルサイズを同一実機で複数回測る。数値を記録し、遅い箇所だけを改善する。

### Phase 1 の完了判定

- `mdq README.md`でシェルへすぐ戻り、数秒の閲覧に十分な表示・終了体験ができる。
- 指定されたMarkdown/GFM記法と主要コード言語が読める。
- 保存で自動更新され、削除・置換・復旧時もウィンドウが破綻しない。
- CLIエラーはウィンドウを出さずに分かる文面と非0終了を返す。
- 悪意あるMarkdownから任意JavaScript・外部ページ遷移・任意ローカルファイル読込が起きない。
- 起動計測結果と未対応事項を記録し、次段階の判断材料にする。

## 8. 実装前に確認する小さな論点

- `mdq`という名前の公開可否は、配布前にGitHub/Homebrew/crates.io/npm/PyPI/一般Web・商標で確認する。Phase 1のローカル開発は仮称のまま進める。
- Windows/Linuxは設計対象だがPhase 1の検証対象はmacOS Apple Silicon。WindowsのGUI実行ファイルでは呼び出し元コンソールへのテキスト出力に制約があることが[Tauri CLI plugin](https://v2.tauri.app/plugin/cli/)に記されている。WindowsでのCLIエラー表示と`Ctrl+W`は移植時に実機確認する。
- ローカル画像・相対ファイルリンクは安全なファイル公開範囲の設計が必要なためPhase 1では開かない。閲覧上の必要性が高いと判明した場合、選択ファイル基準で対象を絞る方式を別途設計する。
