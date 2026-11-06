# Finding text

[日本語](../ja/SEARCH.md) · [README](../../README.md#finding-text)

Search follows Vim-style controls. Colored boxes mark matches over the text, with a stronger color for the current match. Opening search saves your reading position. Typing updates the matches and moves to the first match at or after the top of that saved reading area, accounting for the banner and search panel; if none remains, it wraps to the first match. Reopening an existing query also selects from your new reading position. When the current match is near the top or bottom edge or out of view, search scrolls it to the middle of the window.

Enter confirms the current match, closes the panel, and returns focus to the document. Highlights stay visible, with a count badge such as `[3/12]` at the end of the current matching line. A query with no matches stays editable as `0/0`; an empty query closes search and clears its marks. While open, the panel shows the current position and count. Search keeps the first 1000 matches: exactly 1000 shows `3/1000`, while more shows `3/1000+` (or `[3/1000+]` in the badge); navigation wraps within those stored matches.

Use `n` or `N` to move forward or backward without reopening the panel. If you have scrolled the current match out of view, `n` selects the first match at or after the top of the visible reading area, and `N` selects the last match at or before its bottom. If none remains in that direction, navigation wraps. A match already fully in view advances normally to the next or previous match.

Esc while search is open cancels the edit and restores the previous query, match number, marks, and saved scroll position. With search closed, Esc clears visible marks and the badge while retaining the query and match number; `n` or `N` shows them again and moves. Esc when no marks are visible closes the preview. With search open, `⌘F` refocuses the input and selects its query without changing the saved position. Reading shortcuts such as `j`, `k`, and `q` are inactive in the search input; Enter and Esc are left to the input method during IME composition.

Search covers rendered text, including code, table cells, and link labels, in the current document. Matching ignores case and fullwidth ASCII forms, but does not cross paragraphs, list items, table cells, or explicit line breaks. Alt text for local images eligible for loading is excluded even if loading fails. Alt text for remote images and images beyond the 64-reference limit remains searchable.

Live reload searches again with the same query, keeping the match number if it still exists and otherwise returning to the first match, without requesting a search scroll. The boxes and badge follow layout changes, including images loading; the badge is hidden while the panel is open, and both disappear when no matches remain.

Search uses the same overlay display on all WebViews and leaves document selection to the reader. `⌘C` uses the WebView's normal copy behavior for the focused input or document selection.
