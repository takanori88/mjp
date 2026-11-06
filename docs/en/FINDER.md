# Opening files from Finder

[日本語](../ja/FINDER.md) · [README](../../README.md#opening-files-from-finder)

The app opens a separate window for each file. Opening the same file again brings its existing window to the front; duplicate requests during a load share that load. Each open request processes its first 10 selected inputs. Excess inputs and files that cannot be read appear together in one **Files that could not be opened** window, with up to 10 details and an omitted count. Correct the file or request, then open it again to retry. Files that opened successfully continue to reload after saves; a later read failure appears in that preview's error banner and clears when the file recovers.

Launching `mjp.app` without a file shows a welcome window with usage instructions. It closes after a document window is successfully created. Each preview closes independently, and mjp exits after the last window closes and all accepted open requests finish. `⌘Q` or **Quit** exits the entire process, including while a file is loading.

The CLI starts with one preview in its own process. Normal Finder launches are expected to deliver files to the existing app instance. Directly using the executable inside `mjp.app` as a CLI can create multiple instances; any CLI child that receives an OS open request adds windows in that same process. For terminal use, install the separate command in `~/.local/bin` as shown below.
