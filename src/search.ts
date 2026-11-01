// Keep one UTF-16 unit per unit so DOM offsets need no normalization map.
export function fold(text: string): string {
  return text.replace(/[A-Z\u0080-\uffff]/g, character => {
    const code = character.charCodeAt(0);
    const narrow = code >= 0xff01 && code <= 0xff5e
      ? String.fromCharCode(code - 0xfee0) : character;
    const lower = narrow.toLowerCase();
    return lower.length === 1 ? lower : narrow;
  });
}

export type Match = { segment: number; offset: number };
export const MAX_MATCHES = 1000;

export function step(index: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  if (index === -1) return direction === 1 ? 0 : count - 1;
  return (index + direction + count) % count;
}

export function retain(previousIndex: number, count: number): number {
  if (count === 0) return -1;
  return previousIndex >= 0 && previousIndex < count ? previousIndex : 0;
}

export function findMatches(segments: string[], query: string, limit: number): {
  starts: Match[]; truncated: boolean;
} {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid match limit");
  const starts: Match[] = [];
  if (!query) return { starts, truncated: false };
  for (let segment = 0; segment < segments.length; segment++) {
    const text = segments[segment];
    let offset = text.indexOf(query);
    while (offset !== -1) {
      if (starts.length === limit) return { starts, truncated: true };
      starts.push({ segment, offset });
      offset = text.indexOf(query, offset + query.length);
    }
  }
  return { starts, truncated: false };
}

type Point = { node: Text; offset: number };
type TextRun = {
  offset: number;
  length: number;
  start: Point;
  end: Point;
  collapsed: boolean;
};

export type SearchSegment = {
  text: string;
  range: (offset: number, length: number) => Range;
};

const blockTags = new Set([
  "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "TD", "TH", "PRE",
  "BLOCKQUOTE", "DT", "DD", "HR", "TABLE", "TR", "UL", "OL", "DIV",
]);
const excludedSelector = '.code-actions, .direction-note, [data-mjp-image], [role="search"]';

function pointAt(runs: TextRun[], offset: number, end: boolean): Point {
  let low = 0;
  let high = runs.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const run = runs[middle];
    if (offset >= run.offset + run.length) low = middle + 1;
    else high = middle;
  }
  const run = runs[low];
  if (run.collapsed) return end ? run.end : run.start;
  return { node: run.start.node, offset: run.start.offset + offset - run.offset + (end ? 1 : 0) };
}

export function collectSegments(article: HTMLElement): SearchSegment[] {
  const document = article.ownerDocument;
  const segments: SearchSegment[] = [];
  let parts: string[] = [];
  let runs: TextRun[] = [];
  let length = 0;
  let space: { start: Point; end: Point } | undefined;

  function flush(): void {
    if (length) {
      const text = fold(parts.join(""));
      const positions = runs;
      segments.push({
        text,
        range(offset, size) {
          if (!Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 1 || offset + size > text.length) {
            throw new RangeError("Invalid search range");
          }
          const start = pointAt(positions, offset, false);
          const end = pointAt(positions, offset + size - 1, true);
          const range = document.createRange();
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          return range;
        },
      });
    }
    parts = [];
    runs = [];
    length = 0;
    space = undefined;
  }

  function append(node: Text, offset: number, text: string): void {
    if (!text) return;
    if (space && length) {
      parts.push(" ");
      runs.push({ offset: length++, length: 1, ...space, collapsed: true });
    }
    space = undefined;
    parts.push(text);
    runs.push({
      offset: length, length: text.length,
      start: { node, offset }, end: { node, offset: offset + text.length }, collapsed: false,
    });
    length += text.length;
  }

  function visit(node: Node, pre: boolean): void {
    if (node.nodeType === 3) {
      const text = node as Text;
      if (pre) append(text, 0, text.data);
      else {
        for (const part of text.data.matchAll(/[ \t\n\r]+|[^ \t\n\r]+/g)) {
          const offset = part.index;
          if (/^[ \t\n\r]/.test(part[0])) {
            space = {
              start: space?.start ?? { node: text, offset },
              end: { node: text, offset: offset + part[0].length },
            };
          } else append(text, offset, part[0]);
        }
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.matches(excludedSelector)) {
      flush();
      return;
    }
    const boundary = blockTags.has(element.tagName) || element.tagName === "BR";
    if (boundary) flush();
    for (const child of element.childNodes) visit(child, pre || element.tagName === "PRE");
    if (boundary) flush();
  }

  for (const child of article.childNodes) visit(child, false);
  flush();
  return segments;
}

export function createMatchRanges(segments: SearchSegment[], starts: Match[], queryLength: number): Range[] {
  return starts.map(match => segments[match.segment].range(match.offset, queryLength));
}

export type SearchHighlights = {
  registry: Pick<HighlightRegistry, "set" | "delete">;
  create: (ranges: Range[]) => Highlight;
};

export function updateHighlights(highlights: SearchHighlights, ranges: Range[], index: number): void {
  const { registry, create } = highlights;
  if (!ranges.length) {
    registry.delete("mjp-search");
    registry.delete("mjp-search-current");
    return;
  }
  registry.set("mjp-search", create(ranges));
  if (ranges[index]) {
    const current = create([ranges[index]]);
    current.priority = 1;
    registry.set("mjp-search-current", current);
  } else registry.delete("mjp-search-current");
}

function matchViewport(range: Range, view: Window, overlays: HTMLElement[]) {
  const rect = range.getBoundingClientRect();
  let top = 0;
  let obscured = false;
  for (const overlay of overlays) {
    if (overlay.hidden) continue;
    const bounds = overlay.getBoundingClientRect();
    if (bounds.bottom > 0 && bounds.top < view.innerHeight && rect.left < bounds.right && rect.right > bounds.left) {
      top = Math.max(top, bounds.bottom);
      obscured ||= rect.top < bounds.bottom && rect.bottom > bounds.top;
    }
  }
  return { rect, top, obscured };
}

function revealMatch(range: Range, article: HTMLElement, overlays: HTMLElement[]): void {
  const view = article.ownerDocument.defaultView!;
  for (let ancestor = range.startContainer.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const overflow = view.getComputedStyle(ancestor).overflowX;
    if ((overflow === "auto" || overflow === "scroll") && ancestor.clientWidth > 0) {
      const bounds = ancestor.getBoundingClientRect();
      const left = bounds.left + ancestor.clientLeft;
      const match = range.getBoundingClientRect();
      if (match.left < left || match.right > left + ancestor.clientWidth) {
        ancestor.scrollLeft += match.left - left - Math.max(0, (ancestor.clientWidth - match.width) / 2);
      }
    }
    if (ancestor === article) break;
  }

  const { rect: match, top, obscured } = matchViewport(range, view, overlays);
  if (match.top < 0 || match.bottom > view.innerHeight || obscured) {
    view.scrollBy(0, (match.top + match.bottom) / 2 - (top + view.innerHeight) / 2);
  }
}

type SelectionState = Pick<Selection, "anchorNode" | "anchorOffset" | "focusNode" | "focusOffset"> & {
  ranges: Range[];
};

function selectionState(selection: Selection): SelectionState {
  return {
    ranges: Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)),
    anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode, focusOffset: selection.focusOffset,
  };
}

function sameSelection(selection: Selection, state: SelectionState): boolean {
  return selection.rangeCount === state.ranges.length &&
    selection.anchorNode === state.anchorNode && selection.anchorOffset === state.anchorOffset &&
    selection.focusNode === state.focusNode && selection.focusOffset === state.focusOffset &&
    state.ranges.every((range, index) => selection.getRangeAt(index) === range);
}

function focusKeepingSelection(element: HTMLElement): void {
  const selection = element.ownerDocument.defaultView!.getSelection();
  const previous = selection && selectionState(selection);
  // preventScroll does not prevent a focus change from collapsing the document selection.
  element.focus({ preventScroll: true });
  if (!selection || !previous || sameSelection(selection, previous)) return;
  selection.removeAllRanges();
  for (const range of previous.ranges) selection.addRange(range);
  if (previous.anchorNode && previous.focusNode &&
    (selection.anchorNode !== previous.anchorNode || selection.anchorOffset !== previous.anchorOffset)) {
    selection.setBaseAndExtent(previous.anchorNode, previous.anchorOffset, previous.focusNode, previous.focusOffset);
  }
}

type SearchOptions = {
  highlights?: SearchHighlights;
  status?: HTMLElement;
};

type SearchOrigin = { scrollY: number; query: string; index: number; shown: boolean };

export function createSearch(article: HTMLElement, options: SearchOptions = {}) {
  const document = article.ownerDocument;
  const view = document.defaultView!;
  const panel = document.createElement("div");
  panel.className = "search-panel";
  panel.setAttribute("role", "search");
  panel.hidden = true;
  const input = document.createElement("input");
  input.type = "search";
  input.setAttribute("aria-label", "Find in document");
  input.placeholder = "Find in document";
  input.autocomplete = "off";
  input.spellcheck = false;
  const count = document.createElement("span");
  count.setAttribute("aria-live", "polite");
  count.setAttribute("aria-atomic", "true");
  panel.append(input, count);
  article.before(panel);
  article.tabIndex = -1;

  let shown = false;
  let segmentsStale = true;
  let matchesStale = true;
  let queryChanged = false;
  let query = "";
  let index = -1;
  let segments: SearchSegment[] = [];
  let ranges: Range[] = [];
  let truncated = false;
  let frame: number | undefined;
  let disposed = false;
  let selected: SelectionState | undefined;
  let origin: SearchOrigin | undefined;

  function cancelSearch(): void {
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
  }

  function ensureFresh(): boolean {
    const changed = queryChanged;
    if (segmentsStale) {
      segments = collectSegments(article);
      segmentsStale = false;
    }
    if (matchesStale) {
      const folded = fold(query);
      const result = findMatches(segments.map(segment => segment.text), folded, MAX_MATCHES);
      ranges = createMatchRanges(segments, result.starts, folded.length);
      truncated = result.truncated;
      index = queryChanged ? indexFromOrigin() : retain(index, ranges.length);
      matchesStale = false;
      queryChanged = false;
    }
    return changed;
  }

  function indexFromOrigin(): number {
    if (!ranges.length) return -1;
    if (!origin) return 0;
    const originY = origin.scrollY;
    const scrollY = view.scrollY;
    const overlays = options.status ? [panel, options.status] : [panel];
    const found = ranges.findIndex(range => {
      const { rect, top } = matchViewport(range, view, overlays);
      return rect.top + scrollY >= originY + top;
    });
    return found === -1 ? 0 : found;
  }

  function indexFromViewport(direction: 1 | -1): number {
    if (!ranges.length) return -1;
    const overlays = options.status ? [panel, options.status] : [panel];
    const current = ranges[index] && matchViewport(ranges[index], view, overlays);
    if (current && current.rect.top >= 0 && current.rect.bottom <= view.innerHeight && !current.obscured) {
      return step(index, ranges.length, direction);
    }
    if (direction === 1) {
      const found = ranges.findIndex(range => {
        const { rect, top } = matchViewport(range, view, overlays);
        return rect.top >= top;
      });
      return found === -1 ? 0 : found;
    }
    for (let candidate = ranges.length - 1; candidate >= 0; candidate--) {
      if (ranges[candidate].getBoundingClientRect().bottom <= view.innerHeight) return candidate;
    }
    return ranges.length - 1;
  }

  function paint(): void {
    if (!panel.hidden) count.textContent = `${index + 1}/${ranges.length}${truncated ? "+" : ""}`;
    if (options.highlights) updateHighlights(options.highlights, shown ? ranges : [], index);
    else if (!shown) clearSelection();
  }

  function clearSelection(): void {
    const previous = selected;
    selected = undefined;
    if (!previous) return;
    const selection = view.getSelection();
    if (selection && sameSelection(selection, previous)) selection.removeAllRanges();
  }

  function selectCurrent(): void {
    if (options.highlights) return;
    const range = ranges[index];
    if (!range) {
      clearSelection();
      return;
    }
    const selection = view.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    // User adjustments to Selection must not change the cached match ranges.
    selection.addRange(range.cloneRange());
    if (!panel.hidden && document.activeElement !== input) {
      input.focus({ preventScroll: true });
      selection.setBaseAndExtent(range.startContainer, range.startOffset, range.endContainer, range.endOffset);
    }
    selected = selectionState(selection);
  }

  function reveal(): void {
    if (ranges[index]) revealMatch(ranges[index], article, options.status ? [panel, options.status] : [panel]);
  }

  function onInput(): void {
    if (disposed || panel.hidden || input.value === query) return;
    query = input.value;
    matchesStale = true;
    queryChanged = true;
    if (frame === undefined) {
      frame = view.requestAnimationFrame(() => {
        frame = undefined;
        if (disposed || panel.hidden) return;
        ensureFresh();
        paint();
        reveal();
      });
    }
  }
  input.addEventListener("input", onInput);

  return {
    get input(): HTMLInputElement { return input; },
    get isOpen(): boolean { return !panel.hidden; },
    get isShown(): boolean { return shown; },
    open(): void {
      if (disposed) return;
      cancelSearch();
      const opening = panel.hidden;
      if (opening) origin = { scrollY: view.scrollY, query, index, shown };
      panel.hidden = false;
      shown = true;
      const changed = ensureFresh();
      if (opening && !changed) index = indexFromOrigin();
      paint();
      input.value = query;
      focusKeepingSelection(input);
      input.select();
    },
    commit(): "committed" | "closed" | "empty" {
      if (disposed || panel.hidden) return "closed";
      cancelSearch();
      ensureFresh();
      if (query && !ranges.length) {
        paint();
        return "empty";
      }
      panel.hidden = true;
      shown = Boolean(query);
      origin = undefined;
      paint();
      focusKeepingSelection(article);
      if (shown) {
        selectCurrent();
        reveal();
      }
      return shown ? "committed" : "closed";
    },
    close(): void {
      if (disposed) return;
      cancelSearch();
      const previous = panel.hidden ? undefined : origin;
      if (previous) {
        query = previous.query;
        input.value = query;
        matchesStale = true;
        queryChanged = false;
        ensureFresh();
        index = retain(previous.index, ranges.length);
        shown = previous.shown;
      } else shown = false;
      paint();
      if (previous) view.scrollTo(0, previous.scrollY);
      panel.hidden = true;
      origin = undefined;
      focusKeepingSelection(article);
    },
    move(direction: 1 | -1): boolean {
      if (disposed || (!query && panel.hidden)) return false;
      cancelSearch();
      ensureFresh();
      index = indexFromViewport(direction);
      shown = true;
      paint();
      selectCurrent();
      reveal();
      return true;
    },
    documentReplaced(): void {
      if (disposed) return;
      cancelSearch();
      clearSelection();
      segments = [];
      ranges = [];
      segmentsStale = true;
      matchesStale = true;
      if (shown) {
        ensureFresh();
        paint();
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      origin = undefined;
      cancelSearch();
      shown = false;
      panel.hidden = true;
      paint();
      input.removeEventListener("input", onInput);
      panel.remove();
      segments = [];
      ranges = [];
    },
  };
}
