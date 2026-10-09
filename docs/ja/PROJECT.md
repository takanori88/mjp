# mjp — Markdown. Just Preview.

[English](../../PROJECT.md)

この文書は製品の目的と当初の Phase 1 の範囲を記録する。現在実装済みの動作とビルド方法は [README.md](README.md) を参照する。

## 1. プロジェクト概要

`mjp` は、ターミナルからMarkdownファイルを**一瞬でGUIプレビューするための軽量CLIツール**。

```bash
mjp README.md
```

これだけで小さなネイティブウィンドウを開き、MarkdownをVS CodeのMarkdown Previewに近い品質でレンダリングする。

目的はMarkdownエディタを作ることではない。

コンセプトは、

> **Markdown. Just Preview.**

である。

macOSのQuick Lookのように「ちょっと内容を確認して、すぐ閉じる」体験をMarkdownファイルに提供する。

---

# 2. 背景

ターミナル中心で開発していると、Markdownファイルを確認する機会が非常に多い。

特にCodexなどのAI coding agentを使用すると、

- README.md
- AGENTS.md
- PLAN.md
- DESIGN.md
- SPEC.md
- IMPLEMENTATION.md

などのMarkdownファイルが頻繁に生成される。

現在の代表的な確認方法には、それぞれ問題がある。

### cat

```bash
cat README.md
```

Markdownソースがそのまま表示されるため読みづらい。

### less / bat

```bash
bat README.md
```

syntax highlightはされるが、Markdownとしてレンダリングされるわけではない。

### glow / mdcat

ターミナル内でMarkdownをレンダリングできるが、ターミナルの文字セルによる表現という制約がある。

VS CodeのMarkdown PreviewのようなHTML/CSSベースの表示にはならない。

### VS Code

```bash
code README.md
```

Markdown Previewは非常に見やすい。

しかし、

> 「READMEを10秒だけ確認したい」

という用途にVS Codeを起動するのは大げさ。

### ブラウザベースのMarkdown Viewer

ブラウザを起動し、タブを増やすこと自体がQuick Look用途には重い。

---

# 3. 解決したい問題

ターミナルからMarkdownを確認するとき、

```bash
mjp README.md
```

だけで、

1. 即座にウィンドウが開く
2. Markdownが美しくレンダリングされる
3. 内容を確認する
4. `Esc` で閉じる

という体験を提供する。

理想的には、

```text
$ mjp README.md

        ↓

┌──────────────────────────────────────┐
│ README.md                         ×  │
├──────────────────────────────────────┤
│                                      │
│  mjp                                 │
│  ───                                 │
│                                      │
│  Markdown. Just Preview.             │
│                                      │
│  Features                            │
│                                      │
│  • Instant preview                   │
│  • GitHub Flavored Markdown          │
│  • Live reload                       │
│                                      │
│  Installation (future)               │
│                                      │
│    brew install mjp                  │
│                                      │
└──────────────────────────────────────┘
```

となる。

---

# 4. プロダクト原則

## 4.1 Quick Lookである

`mjp` はMarkdown Viewerではなく、

**Markdown Quick Look**

である。

ユーザーはMarkdownを「管理」「編集」したいのではない。

単に、

> 見たい

だけである。

---

## 4.2 起動速度を最優先する

機能数より起動速度を優先する。

目標：

> コマンド実行からプレビュー表示まで体感待ち時間なし。

可能なら実測し、起動時間を継続的に確認する。

---

## 4.3 UIを増やさない

基本UIはMarkdown本文だけでよい。

不要なもの：

- toolbar
- sidebar
- file explorer
- tab bar
- status bar
- settings button

タイトルバーについても可能な限り簡素にする。

---

## 4.4 CLI First

GUIアプリを起動してファイルを選択するのではない。

基本インターフェースは常に、

```bash
mjp <file>
```

である。

---

# 5. MVP

Phase 1では以下だけを実装する。

## CLI

```bash
mjp README.md
```

相対パス・絶対パスの両方に対応する。

存在しないファイルの場合はGUIを起動せず、CLIに明確なエラーを返す。

例：

```text
mjp: README2.md: file not found
```

Markdown以外のファイルをどう扱うかは実装前に検討する。

---

## Markdown Rendering

最低限以下に対応する。

- CommonMark
- GitHub Flavored Markdown
- headings
- paragraphs
- bold
- italic
- strikethrough
- links
- blockquotes
- ordered lists
- unordered lists
- task lists
- tables
- inline code
- fenced code blocks
- horizontal rules

現在の実装は128 KiBまでのファイルをMarkdownとして整形する。それを超えるファイルは10 MiBまで全文をプレーンテキストで表示し、案内を出す。どちらも自動更新に対応し、大きな入力でも素早く確認できる表示を選ぶ。

---

## Syntax Highlight

fenced code blockをsyntax highlightする。

例：

```python
def hello():
    print("hello")
```

主要言語から対応すればよい。

---

## Theme

OSのLight / Dark modeに自動追従する。

基本デザインは、

- GitHub Markdown
- VS Code Markdown Preview

などを参考に、読みやすさを優先する。

特定製品のCSSをそのままコピーしない。

---

## Live Reload

表示中のMarkdownファイルを監視する。

```text
Editor
   │
   │ save
   ▼
README.md
   │
   │ file change
   ▼
mjp
   │
   ▼
automatic re-render
```

ユーザーによるreload操作は不要。

---

## Close

以下で即座に終了できる。

```text
Esc
Cmd + W    macOS
Ctrl + W   Windows/Linux
```

通常のウィンドウCloseも使用可能。

---

## Scrolling

長いMarkdownを普通にスクロールできる。

可能であればlive reload時にスクロール位置を維持する。

ただしMVP実装が複雑になる場合は後回しでよい。

---

# 6. MVPでは実装しないもの

これは重要な制約である。

以下はPhase 1では実装しない。

- Markdown編集
- file explorer
- tabs
- project management
- settings UI
- plugin system
- extension system
- AI機能
- Git integration
- terminal renderer
- Neovim plugin
- VS Code extension
- collaborative editing
- cloud sync
- PDF export
- HTML export
- presentation mode
- WYSIWYG
- diagram editor

特に、

> 「便利そうだから」

という理由だけで機能を追加しないこと。

---

# 7. Mermaid / KaTeX

MermaidとKaTeXは有用だがMVP必須ではない。

Phase 2候補とする。

````markdown
```mermaid
graph LR
    A --> B
```
````

Markdown基本表示と起動速度が十分良好になってから検討する。

---

# 8. 技術方針

第一候補：

```text
Tauri 2
  │
  ├── Rust
  │     ├── CLI argument
  │     ├── file handling
  │     └── file watcher
  │
  └── WebView
        ├── Markdown parser
        ├── GFM
        ├── syntax highlight
        └── CSS
```

Electronは原則使用しない。

理由：

- Quick Look用途としてランタイムが大きい
- 起動速度を重視したい
- メモリ使用量を抑えたい

ただしCodexは実装開始前に、2026年現在のTauri 2の公式ドキュメントを確認し、より単純・高速な構成があれば提案すること。

---

# 9. フロントエンド

Reactが本当に必要か検討すること。

アプリケーションの状態管理はほぼ存在しないため、

```text
Markdown
   ↓
HTML
   ↓
WebView
```

だけならVanilla TypeScriptの方が適している可能性がある。

優先順位は、

1. 起動速度
2. 実装の単純さ
3. バイナリサイズ
4. 保守性

とする。

「一般的だからReact」という理由だけでReactを採用しないこと。

---

# 10. セキュリティ

Markdownは信頼できない入力である可能性がある。

そのため、

- raw HTML
- JavaScript
- script tags
- event handlers
- dangerous URLs

などについて安全性を考慮する。

原則としてMarkdown内の任意JavaScriptを実行させない。

外部リンクをクリックした場合の挙動についても設計する。

---

# 11. UX

理想的な操作時間は、

```text
mjp README.md
      ↓
読む
      ↓
Esc
```

数秒〜数十秒。

つまりアプリケーションというより、

> **CLIから呼び出す一時的な視覚表示装置**

として設計する。

---

# 12. CLIの将来候補

MVP完成後に以下を検討する。

```bash
mjp README.md --theme dark
```

```bash
cat README.md | mjp
```

```bash
git show HEAD:README.md | mjp
```

stdin対応は特に有用なのでPhase 2の優先候補とする。

将来的には、

```bash
mjp -
```

も検討する。

---

# 13. クロスプラットフォーム

最初の開発・検証対象：

```text
macOS Apple Silicon
```

ただし設計段階から、

```text
macOS
Windows
Linux
```

を阻害するOS依存コードは可能な限り避ける。

Phase 1完成後にWindows/Linux対応を検討する。

---

# 14. 配布

将来的にはmacOSで、

```bash
brew install mjp
```

または、

```bash
brew install <owner>/tap/mjp
```

だけで導入できる状態を目指す。

GitHub Releasesで、

- macOS arm64
- macOS x86_64
- Windows x64
- Linux x64

などの配布を検討する。

GitHub Actionsによる自動build/releaseもPhase 2候補。

---

# 15. 競合との差別化

既存Markdown Viewerには、

- 高機能Viewer
- Markdown Editor
- terminal renderer
- browser preview
- IDE integration

などが存在する。

mjpはこれらと機能数で競争しない。

差別化は、

> **起動の速さと操作の少なさ**

である。

比較イメージ：

```text
cat       → 速いが読みにくい
bat       → ソースを見る
glow      → terminal rendering
VS Code   → 高品質だがIDE
browser   → 高品質だがbrowser
mjp       → 高品質 + Quick Look
```

---

# 16. 名前

名称：

```text
mjp
```

意味：

```text
Markdown. Just Preview.
```

CLIで非常に入力しやすい。

```bash
mjp README.md
```

ただし公開前に、

- GitHub
- Homebrew
- crates.io
- npm
- PyPI
- Web検索
- 商標

などで名称衝突を確認すること。

---

# 17. 成功条件

Phase 1の成功条件は機能数ではない。

以下を満たせば成功とする。

```bash
mjp README.md
```

を実行して、

> 「これならVS Code開かなくていいな」

と思えること。

具体的には、

- 起動が速い
- Markdownが綺麗
- コマンドが簡単
- 保存すると勝手に更新される
- Escですぐ消える
- 操作方法を覚える必要がない

こと。

---

# 18. Codexへの初回指示

このPROJECT.mdを読んだ後、すぐに実装を開始しないこと。

まず以下を実施する。

1. 要件を整理する
2. Tauri 2の現在の公式仕様を確認する
3. Markdownレンダリングライブラリ候補を比較する
4. syntax highlightingライブラリ候補を比較する
5. file watching方式を検討する
6. セキュリティ上の注意点を整理する
7. 起動速度を最優先した最小構成を提案する
8. ディレクトリ構成を提案する
9. Phase 1の実装計画を作成する

結果を `PLAN.md` にまとめる。

この段階では実装しない。

過剰設計を避け、

> `mjp README.md`

という体験を最短で実現することを最優先する。
