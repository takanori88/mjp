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

test('findMatches truncates only after the confirmed 1000-match limit is exceeded', () => {
  const limit = 1000;
  assert.equal(search.MAX_MATCHES, limit);
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

function articleFixture(t, html) {
  const { window } = new JSDOM('<article></article>');
  t.after(() => window.close());
  const article = window.document.querySelector('article');
  article.innerHTML = html;
  return { window, article };
}

function rangesFor(segments, query, limit = search.MAX_MATCHES) {
  const folded = search.fold(query);
  const { starts } = search.findMatches(segments.map(segment => segment.text), folded, limit);
  return search.createMatchRanges(segments, starts, folded.length);
}

test('collects inline text across emphasis, code, and link nodes in document order', t => {
  const { article } = articleFixture(t, '<p> Ａ<em>b</em><code>C</code><a href="https://example.com">d</a> e </p>');
  const segments = search.collectSegments(article);
  assert.deepEqual(segments.map(segment => segment.text), ['abcd e']);
  const [range] = rangesFor(segments, 'ａＢcD');
  assert.equal(range.toString(), 'ＡbCd');
  assert.equal(range.startContainer, article.querySelector('p').firstChild);
  assert.equal(range.startOffset, 1);
  assert.equal(range.endContainer, article.querySelector('a').firstChild);
  assert.equal(range.endOffset, 1);
});

for (const html of [
  '<h1>a</h1><p>b</p>', '<p>a</p><p>b</p>', '<p>a<br>b</p>',
  '<ul><li>a</li><li>b</li></ul>', '<ul><li>a<ul><li>b</li></ul>c</li></ul>',
  '<table><tr><td>a</td><td>b</td></tr></table>',
  '<table><tr><th>a</th><th>b</th></tr></table>',
  '<blockquote>a</blockquote>b', '<dl><dt>a</dt><dd>b</dd></dl>',
  '<div>a</div>b', 'a<hr>b', '<pre>a</pre>b',
]) {
  test(`keeps matches within structural text segments: ${html}`, t => {
    const { article } = articleFixture(t, html);
    const segments = search.collectSegments(article);
    assert.deepEqual(segments.map(segment => segment.text), html.includes('>c<') ? ['a', 'b', 'c'] : ['a', 'b']);
    assert.equal(rangesFor(segments, 'ab').length, 0);
    assert.equal(rangesFor(segments, 'a b').length, 0);
  });
}

test('collapses only ASCII layout whitespace across inline nodes and trims segment edges', t => {
  const { article } = articleFixture(t, '<p> \ta <a>b </a>\n\t c\r d \n</p><p>a　b&nbsp;c</p>');
  const segments = search.collectSegments(article);
  assert.deepEqual(segments.map(segment => segment.text), ['a b c d', 'a　b\u00a0c']);
  assert.equal(rangesFor(segments, 'a b c d').length, 1);
  assert.equal(rangesFor(segments, 'a b c').length, 1);
  assert.equal(rangesFor(segments, 'a　b\u00a0c').length, 1);
  assert.equal(rangesFor(segments, 'b c').length, 1);
});

test('maps a collapsed space to the entire original whitespace run across text nodes', t => {
  const { article } = articleFixture(t, '<p> a <a>b </a>\n\t c </p>');
  const paragraph = article.firstChild;
  const linkText = article.querySelector('a').firstChild;
  const afterLink = article.querySelector('a').nextSibling;
  const segments = search.collectSegments(article);
  const spaces = rangesFor(segments, ' ');
  assert.equal(spaces.length, 2);
  assert.equal(spaces[0].startContainer, paragraph.firstChild);
  assert.equal(spaces[0].startOffset, 2);
  assert.equal(spaces[0].endContainer, paragraph.firstChild);
  assert.equal(spaces[0].endOffset, 3);
  assert.equal(spaces[1].startContainer, linkText);
  assert.equal(spaces[1].startOffset, 1);
  assert.equal(spaces[1].endContainer, afterLink);
  assert.equal(spaces[1].endOffset, 3);
  const [trailing] = rangesFor(segments, 'b ');
  assert.equal(trailing.startContainer, linkText);
  assert.equal(trailing.startOffset, 0);
  assert.equal(trailing.endContainer, afterLink);
  assert.equal(trailing.endOffset, 3);
});

test('preserves preformatted whitespace across highlighted inline nodes', t => {
  const { article } = articleFixture(t, '<pre><code> a <span> \n</span>\tb </code></pre>');
  const segments = search.collectSegments(article);
  assert.deepEqual(segments.map(segment => segment.text), [' a  \n\tb ']);
  assert.equal(rangesFor(segments, 'a b').length, 0);
  const [range] = rangesFor(segments, 'a  \n\tb');
  assert.equal(range.toString(), 'a  \n\tb');
});

for (const excluded of [
  '<div class="code-actions"><button>omit</button></div>',
  '<div class="direction-note">omit</div>', '<span data-mjp-image="0">omit</span>',
  '<div role="search"><input value="omit">omit</div>',
]) {
  test(`excludes auxiliary content and separates adjacent text: ${excluded}`, t => {
    const { article } = articleFixture(t, `a${excluded}b`);
    const segments = search.collectSegments(article);
    assert.deepEqual(segments.map(segment => segment.text), ['a', 'b']);
    assert.equal(rangesFor(segments, 'omit').length, 0);
    assert.equal(rangesFor(segments, 'ab').length, 0);
  });
}

test('collects plain-text content as one segment with offsets after line breaks', t => {
  const { article, window } = articleFixture(t, '<pre></pre>');
  const text = ' A\n  B\t😀 '.repeat(1024);
  const node = window.document.createTextNode(text);
  article.firstChild.append(node);
  const segments = search.collectSegments(article);
  assert.deepEqual(segments.map(segment => segment.text), [search.fold(text)]);
  const ranges = rangesFor(segments, 'b\t😀', 1024);
  assert.equal(ranges.length, 1024);
  assert.equal(ranges[0].startContainer, node);
  assert.equal(ranges[0].startOffset, 5);
  assert.equal(ranges[0].endContainer, node);
  assert.equal(ranges[0].endOffset, 9);
  assert.equal(ranges.at(-1).toString(), 'B\t😀');
});

test('keeps image fallback search results stable through local image loading', async t => {
  const { window, article } = articleFixture(t, '');
  globalThis.window = window;
  const { createDocumentRenderer } = await import('../src/render.ts');
  const { MAX_IMAGES } = await import('../src/images.ts');
  window.scrollTo = () => {};
  let finish;
  const render = createDocumentRenderer(article, window.document.createElement('aside'), undefined,
    () => new Promise(resolve => { finish = resolve; }));
  const altImages = Array.from({ length: MAX_IMAGES + 1 }, (_, index) => `![local${index}](image${index}.png)`).join(' ');
  render({ text: `![remote](https://example.com/a.png) ${altImages}`, revision: 0, warning: null, error: null });
  const before = search.collectSegments(article).map(segment => segment.text);
  assert.equal(before.includes('remote'), true);
  assert.equal(before.includes(`local${MAX_IMAGES}`), true);
  assert.equal(before.some(text => text.includes('local0')), false);
  finish(new ArrayBuffer(0));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(search.collectSegments(article).map(segment => segment.text), before);
});

function fakeHighlights() {
  const registry = new Map();
  const created = [];
  return { registry, created, create(ranges) {
    const highlight = [...ranges];
    created.push(highlight);
    return highlight;
  } };
}

test('registers all matches and the current match without changing any document nodes', t => {
  const { article } = articleFixture(t, '<p>Ｆ<em>o</em>o foo</p><pre><code>FOO</code></pre>');
  const html = article.innerHTML;
  const nodes = [...article.querySelectorAll('*')].flatMap(node => [node, ...node.childNodes]);
  const ranges = rangesFor(search.collectSegments(article), 'foo');
  const highlights = fakeHighlights();
  search.updateHighlights(highlights, ranges, 1);
  const all = highlights.registry.get('mjp-search');
  const current = highlights.registry.get('mjp-search-current');
  assert.deepEqual(all.map(range => range.toString()), ['Ｆoo', 'foo', 'FOO']);
  assert.deepEqual([...current], [all[1]]);
  assert.equal(current.priority, 1);
  assert.equal(all[0].startContainer, article.querySelector('p').firstChild);
  assert.equal(all[0].startOffset, 0);
  assert.equal(all[0].endContainer, article.querySelector('em').nextSibling);
  assert.equal(all[0].endOffset, 1);
  search.updateHighlights(highlights, ranges, 2);
  assert.deepEqual([...highlights.registry.get('mjp-search-current')], [all[2]]);
  search.updateHighlights(highlights, [], -1);
  assert.equal(highlights.registry.has('mjp-search'), false);
  assert.equal(highlights.registry.has('mjp-search-current'), false);
  assert.equal(article.innerHTML, html);
  const after = [...article.querySelectorAll('*')].flatMap(node => [node, ...node.childNodes]);
  assert.equal(after.length, nodes.length);
  after.forEach((node, index) => assert.equal(node, nodes[index]));
});

test('creates and registers at most 1000 match Ranges', t => {
  const { article, window } = articleFixture(t, '<pre></pre>');
  const highlights = fakeHighlights();
  const createRange = t.mock.method(window.document, 'createRange');
  for (const count of [999, 1000, 1001]) {
    article.firstChild.textContent = 'a'.repeat(count);
    const ranges = rangesFor(search.collectSegments(article), 'a');
    assert.equal(ranges.length, Math.min(count, 1000));
    assert.equal(createRange.mock.callCount(), Math.min(count, 1000));
    search.updateHighlights(highlights, ranges, ranges.length - 1);
    assert.equal(highlights.registry.get('mjp-search').length, ranges.length);
    assert.equal(highlights.registry.get('mjp-search-current')[0], ranges.at(-1));
    createRange.mock.resetCalls();
  }
});

test('searching markup-like text never inserts elements or changes the article', t => {
  const { article } = articleFixture(t, '<p>&lt;img src=x onerror=example()&gt; &amp; &lt;script&gt;</p>');
  const html = article.innerHTML;
  const paragraph = article.firstChild;
  const text = paragraph.firstChild;
  const highlights = fakeHighlights();
  for (const query of ['<img src=x onerror=example()>', '<script>', '</p><img src=x>']) {
    const ranges = rangesFor(search.collectSegments(article), query);
    search.updateHighlights(highlights, ranges, ranges.length ? 0 : -1);
    assert.equal(ranges.length, query.startsWith('</p>') ? 0 : 1);
    if (ranges.length) assert.equal(ranges[0].toString(), query);
  }
  assert.equal(article.innerHTML, html);
  assert.equal(article.firstChild, paragraph);
  assert.equal(paragraph.firstChild, text);
  assert.equal(article.querySelector('img, script'), null);
});

test('search highlighting preserves rendered code copying and external link actions', async t => {
  const { window, article } = articleFixture(t, '');
  globalThis.window = window;
  const { startPreview } = await import('../src/preview.ts');
  window.scrollTo = () => {};
  const copies = [];
  const links = [];
  await startPreview(article, window.document.createElement('aside'), {
    subscribe: async () => {},
    getDocument: async () => ({ text: '```js\nconst foo = "foo";\n```\n\n[foo](https://example.com)', revision: 0, error: null, warning: null }),
    close: async () => {},
    openExternal: async url => { links.push(url); },
    writeText: async text => { copies.push(text); },
  });
  const code = article.querySelector('code');
  const button = article.querySelector('button');
  const anchor = article.querySelector('a');
  const html = article.innerHTML;
  const highlights = fakeHighlights();
  const ranges = rangesFor(search.collectSegments(article), 'foo');
  search.updateHighlights(highlights, ranges, 0);
  assert.deepEqual(highlights.registry.get('mjp-search').map(range => range.toString()), ['foo', 'foo', 'foo']);
  assert.equal(article.innerHTML, html);
  assert.equal(article.querySelector('code'), code);
  assert.equal(article.querySelector('button'), button);
  assert.equal(article.querySelector('a'), anchor);
  button.click();
  anchor.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(copies, ['const foo = "foo";\n']);
  assert.deepEqual(links, ['https://example.com/']);
});
