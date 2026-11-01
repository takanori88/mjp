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
export const MAX_MATCHES = 10000;

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
