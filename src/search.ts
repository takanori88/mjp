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
