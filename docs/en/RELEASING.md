# Publishing the source

[日本語](../ja/RELEASING.md)

The first publication is source-only, for macOS Apple Silicon. It does not include prebuilt executables, a Homebrew package, or an installer. The repository owner controls commits, pushes, tags, releases, and visibility changes.

## Local verification

Use the tool versions in [README.md](../../README.md), and run from the repository root:

```sh
npm ci
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run build:release -- --bundles app -- --locked
./src-tauri/target/release/mjp --version
./src-tauri/target/release/mjp --help
./src-tauri/target/release/mjp README.md
```

Confirm the npm, Cargo, and Tauri versions agree (currently 0.1.0). On the target Mac, check window rendering, close shortcuts, live reload, and launching from a path containing spaces. The command-line and automated test results do not replace these GUI checks.

## Owner publication steps

1. Review the local diff, the MIT copyright notice, and [third-party dependency scope](THIRD_PARTY.md).
2. Inspect the complete set of branches and tags that will become visible, including deleted files in their history. Review author metadata and repository attachments as well as the current source.
3. Stage only intended source and documentation. Check the staged file list; do not include generated binaries, dependency directories, local notes, or credentials. A Git source snapshot is preferable to zipping the entire working folder.
4. Commit and push the reviewed changes when ready. Keep the current history unless there is a concrete reason to rewrite it.
5. Change repository visibility in GitHub, then check the repository and README from a signed-out browser. Tagging 0.1.0 or creating a source release can be a separate step.

## Later binary distribution

Before uploading binaries, prepare complete license notices and corresponding-source information, choose the signing and notarization policy, verify the downloaded artifact on another Mac, and document that installation path. Validate the final executable for build-machine paths and produce checksums. These steps are deferred for the source-only publication.
