import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as search from '../src/search.ts';

test('fold preserves UTF-16 positions while equating ASCII case and fullwidth forms', () => {
  assert.equal(search.fold('ＡａAaＺｚ０９！～'), 'aaaazz09!~');
  for (const text of ['İ', '😀\ud800', 'カか　\u00a0', 'Straße', 'Ａİ😀a']) {
    assert.equal(search.fold(text).length, text.length);
  }
  assert.equal(search.fold('İ😀\ud800カか'), 'İ😀\ud800カか');
  assert.equal(search.fold('ẞ'), 'ß');
});

test('findMatches keeps nonoverlapping document order and never crosses segments', () => {
  assert.deepEqual(search.findMatches(['aaaa', 'aa'], '', 10), { starts: [], truncated: false });
  assert.deepEqual(search.findMatches(['aaaa', 'aa'], 'aa', 10), {
    starts: [{ segment: 0, offset: 0 }, { segment: 0, offset: 2 }, { segment: 1, offset: 0 }], truncated: false,
  });
  assert.deepEqual(search.findMatches(['ab', 'cd'], 'bc', 10), { starts: [], truncated: false });
  assert.throws(() => search.findMatches(['a'], 'a', 0), RangeError);
});

test('findMatches truncates only after the provisional limit is exceeded', () => {
  const limit = 10000;
  for (const count of [limit - 1, limit, limit + 1]) {
    const result = search.findMatches(['a'.repeat(count)], 'a', limit);
    assert.equal(result.starts.length, Math.min(count, limit));
    assert.equal(result.truncated, count > limit);
    assert.deepEqual(result.starts.at(-1), { segment: 0, offset: Math.min(count, limit) - 1 });
  }
});

test('step and retain recover empty results and keep navigation within current results', () => {
  for (const direction of [-1, 1]) assert.equal(search.step(0, 0, direction), -1);
  assert.equal(search.step(-1, 3, 1), 0);
  assert.equal(search.step(-1, 3, -1), 2);
  assert.equal(search.step(2, 3, 1), 0);
  assert.equal(search.step(0, 3, -1), 2);
  assert.equal(search.retain(2, 3), 2);
  assert.equal(search.retain(3, 3), 0);
  assert.equal(search.retain(-1, 3), 0);
  assert.equal(search.retain(0, 0), -1);
});
