# ソースの公開手順

[English](../en/RELEASING.md)

初回は macOS Apple Silicon 向けのソースのみを公開します。ビルド済み実行ファイル、Homebrew パッケージ、インストーラーは含みません。コミット、プッシュ、タグ、リリース、公開設定の操作はリポジトリ所有者が行います。

## ローカル検証

[README.md](README.md) のツールバージョンを用い、リポジトリのルートで実行します。

```sh
npm ci
npm test
npm run build
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --all-targets --locked --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run build:release -- --bundles app -- --locked
./src-tauri/target/release/mjp --version
./src-tauri/target/release/mjp --help
./src-tauri/target/release/mjp README.md
```

npm、Cargo、Tauri のバージョンが一致することを確認します（現在は 0.1.0）。対象の Mac で表示、終了キー、自動更新、空白を含むパスからの起動を確認してください。CLI と自動テストの結果は、これらの GUI 確認を代替しません。

## 依存関係の更新と CI

[Dependabot](../../.github/dependabot.yml) は `src-tauri` の Cargo、ルートの npm、GitHub Actions を `Asia/Tokyo` の毎週月曜日に確認し、バージョン更新 PR はエコシステムごとに最大5件まで開きます。メジャー更新も対象です。CI 成功後に人間がレビューして手動マージします。この設定では自動マージや更新のグループ化を有効にしません。PR が多く保守しにくくなった場合にグループ化を検討します。

[CI ワークフロー](../../.github/workflows/ci.yml) は Dependabot を含む PR と `main` への push で動作します。`macOS checks` ジョブは macOS 15 Apple Silicon Runner、`package.json` の対応範囲の Node.js、rustfmt と Clippy を含む Rust 1.99.0 を使用します。`npm ci`、既存テスト、フロントエンドビルドの後、Rust のフォーマット、警告をエラーとする Clippy、Rust テストを実行します。Cargo の検証ではコミット済みロックファイルを使用します。これは CI に選んだツールチェーンであり、マニフェストが許容する全 Rust バージョンを検証するものではありません。

GitHub 公式 Action は完全なコミット SHA で固定します。npm のダウンロードと Cargo のレジストリ・インデックス・Git ダウンロードをキャッシュし、インストール済みモジュールやコンパイル済み成果物は再構築します。リポジトリトークンは読み取り専用とし、checkout の認証情報を残さず、リポジトリシークレットを必要としません。Release 作成、署名、公証は行いません。既存の Dependency graph、各種アラート、Dependabot security updates の設定は維持します。

確認済みの設定がデフォルトブランチに入った後、以下を確認します。

1. **Settings → Actions → General** で GitHub Actions と `actions/checkout`、`actions/setup-node`、`actions/cache` の利用が許可されていることを確認します。ワークフロー権限は読み取り専用で十分で、PR 書き込み権限やシークレットは不要です。
2. **Actions → CI** で PR と `main` push の実行結果を確認し、Dependabot の実際の更新 PR ができた際も確認します。ローカルテストの成功は GitHub 上でのワークフロー成功を意味しません。
3. **Insights → Dependency graph → Dependabot** で3種類の更新ジョブが認識されることと更新ログを確認します。バージョン更新はデフォルトブランチの設定から動作します。PR 上限5件はバージョン更新に適用され、セキュリティ更新には別の上限があります。
4. 運用を強制する場合は **Settings → Rules → Rulesets** で `main` 向けの有効なブランチルールを作り、PR と `macOS checks` の成功を必須にして、自動マージは無効のままにします。チェックは一度実行された後に選択します。Ruleset の利用可否は公開状態と GitHub プランに依存します。[GitHub の説明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)を参照してください。

## 所有者が行う公開操作

1. ローカルの差分、MIT の著作権表示、[依存物の範囲](THIRD_PARTY.md)を確認します。
2. 公開対象の全ブランチとタグについて、削除済みファイルを含む履歴を確認します。現在のソースに加え、作成者のメタデータやリポジトリの添付物も対象にします。
3. 意図したソースと文書だけをステージします。一覧を確認し、生成バイナリ、依存ディレクトリ、ローカルのメモ、認証情報を含めません。作業フォルダ全体の ZIP より、Git のソーススナップショットを使用します。
4. 準備が整ったら、確認済みの変更をコミットしてプッシュします。書き換える具体的な理由がない限り、既存履歴を保持します。
5. GitHub で公開設定を変更し、ログアウトしたブラウザでリポジトリと README を確認します。0.1.0 のタグやソースのリリースは、別の段階でも構いません。

## 後のバイナリ配布

バイナリをアップロードする前に、ライセンス表示と対応ソースの案内を揃え、署名・公証の方針を決め、別の Mac でダウンロードした成果物を確認し、そのインストール手順を記載します。完成した実行ファイルにビルド環境のパスが残っていないか調べ、チェックサムを作成します。これらはソースのみの初回公開では後の段階に回します。
