# Publishing the source

[日本語](../ja/RELEASING.md)

The first publication is source-only, for macOS Apple Silicon. It does not include prebuilt executables, a Homebrew package, or an installer. The repository owner controls commits, pushes, tags, releases, and visibility changes.

## Local verification

Use the tool versions in [README.md](../../README.md), and run from the repository root:

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

Confirm the npm, Cargo, and Tauri versions agree (currently 0.1.0). On the target Mac, check window rendering, close shortcuts, live reload, and launching from a path containing spaces. The command-line and automated test results do not replace these GUI checks.

## Dependency updates and CI

[Dependabot](../../.github/dependabot.yml) checks Cargo in `src-tauri`, npm at the root, and GitHub Actions every Monday in `Asia/Tokyo`, with at most five open version-update PRs per ecosystem. Major updates remain eligible. Review and merge updates manually after CI succeeds; automatic merging and update grouping are not enabled by this configuration. Reconsider grouping only if the PR volume becomes difficult to maintain.

The [CI workflow](../../.github/workflows/ci.yml) runs on pull requests, including Dependabot PRs, and pushes to `main`. The `macOS checks` job uses a macOS 15 Apple Silicon runner, Node.js from `package.json`'s supported range, and Rust 1.99.0 with rustfmt and Clippy. It installs with `npm ci`, runs the existing tests and frontend build, then checks Rust formatting, Clippy with warnings denied, and Rust tests. Cargo checks use the committed lockfile. This is the selected CI toolchain, not verification of every Rust version allowed by the manifest.

GitHub's Actions are pinned to full commit SHAs. npm downloads and Cargo registry/index/Git downloads are cached; installed modules and compiled artifacts are rebuilt. The workflow uses a read-only repository token, does not persist checkout credentials, and requires no repository secrets. It does not publish releases or perform signing or notarization. Keep the existing dependency graph, alerts, and Dependabot security-update settings.

After the reviewed configuration reaches the default branch:

1. In **Settings → Actions → General**, ensure GitHub Actions and the `actions/checkout`, `actions/setup-node`, and `actions/cache` actions are allowed. Read-only workflow permissions are sufficient; PR write permissions and secrets are unnecessary.
2. Check a PR run and the `main` push run in **Actions → CI**, including a real Dependabot update when one is available. A local test result does not confirm a hosted workflow run.
3. In **Insights → Dependency graph → Dependabot**, verify all three update jobs are recognized and inspect their update logs. Version updates start from the default-branch configuration. The five-PR cap applies to version updates; security updates have separate limits.
4. To enforce the workflow, use **Settings → Rules → Rulesets** to create an active branch ruleset for `main`, require a pull request and the successful `macOS checks` status, and keep automatic merging disabled. Select the check after it has run. Ruleset availability depends on repository visibility and your GitHub plan; see [GitHub's ruleset documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository).

## Owner publication steps

1. Review the local diff, the MIT copyright notice, and [third-party dependency scope](THIRD_PARTY.md).
2. Inspect the complete set of branches and tags that will become visible, including deleted files in their history. Review author metadata and repository attachments as well as the current source.
3. Stage only intended source and documentation. Check the staged file list; do not include generated binaries, dependency directories, local notes, or credentials. A Git source snapshot is preferable to zipping the entire working folder.
4. Commit and push the reviewed changes when ready. Keep the current history unless there is a concrete reason to rewrite it.
5. Change repository visibility in GitHub, then check the repository and README from a signed-out browser. Tagging 0.1.0 or creating a source release can be a separate step.

## Later binary distribution

Before uploading binaries, prepare complete license notices and corresponding-source information, choose the signing and notarization policy, verify the downloaded artifact on another Mac, and document that installation path. Validate the final executable for build-machine paths and produce checksums. These steps are deferred for the source-only publication.
