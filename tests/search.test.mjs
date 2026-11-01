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

function searchControllerFixture(t, classes = null, style = null, highlights = true) {
  const { article, window } = articleFixture(t, '<p>short short <em>shore</em></p>');
  if (classes !== null) article.setAttribute('class', classes);
  if (style !== null) article.setAttribute('style', style);
  window.Range.prototype.getBoundingClientRect = () => ({ top: 100.25, bottom: 124.75, left: 100, right: 140, width: 40, height: 24.5 });
  window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
  window.scrollBy = () => {};
  window.scrollTo = () => {};
  const frames = new Map();
  let frameId = 0;
  window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const marks = fakeHighlights();
  const controller = search.createSearch(article, highlights ? { highlights: marks } : {});
  t.after(() => controller.dispose());
  const input = value => {
    controller.input.value = value;
    controller.input.dispatchEvent(new window.Event('input'));
  };
  const frame = () => {
    const queued = [...frames.values()];
    frames.clear();
    queued.forEach(callback => callback(0));
  };
  controller.open();
  return { article, window, controller, marks, frames, input, frame };
}

for (const highlights of [true, false]) {
  for (const [classes, style] of [
    [null, null], ['', ''], ['markdown-body keep', 'color:red; transform:translateX(2px) !important'],
  ]) {
    test(`search never changes article class or style with ${highlights ? 'CSS highlights' : 'Selection'} and ${JSON.stringify([classes, style])}`, t => {
      const f = searchControllerFixture(t, classes, style, highlights);
      const html = f.article.innerHTML;
      const nodes = [...f.article.querySelectorAll('*')].flatMap(node => [node, ...node.childNodes]);
      const observer = new f.window.MutationObserver(() => {});
      observer.observe(f.article, { attributes: true, attributeFilter: ['class', 'style'] });
      t.after(() => observer.disconnect());
      const unchanged = () => {
        assert.equal(observer.takeRecords().length, 0);
        assert.equal(f.article.getAttribute('class'), classes);
        assert.equal(f.article.getAttribute('style'), style);
        assert.equal(f.article.innerHTML, html);
        assert.deepEqual([...f.article.querySelectorAll('*')].flatMap(node => [node, ...node.childNodes]), nodes);
      };
      for (const query of ['s', 'sh', 'short']) {
        f.input(query);
        f.frame();
        unchanged();
        assert.equal(f.frames.size, 0);
      }
      f.controller.commit();
      f.frame();
      unchanged();
      for (const direction of [1, -1]) {
        f.controller.move(direction);
        f.frame();
        unchanged();
      }
      f.controller.documentReplaced();
      f.frame();
      unchanged();
      f.controller.close();
      f.frame();
      unchanged();
      f.controller.open();
      for (const query of ['missing', '']) {
        f.input(query);
        f.frame();
        unchanged();
      }
      f.controller.commit();
      f.frame();
      unchanged();
      f.controller.dispose();
      f.frame();
      unchanged();
      assert.equal(f.frames.size, 0);
    });
  }
}

const rect = (top, right, left = 0) => ({ top, bottom: top + 20, left, right, width: right - left, height: 20 });

for (const [html, query, tail, rectangles, expected] of [
  ['<pre><code>hit end\nthis line is much longer</code></pre>', 'hit', ' end', [rect(100, 160)], 160],
  ['<pre><code>hit<span> across</span><em> nodes\nlonger next line</em></code></pre>', 'hit', ' across nodes', [rect(100, 180), rect(100, 220)], 220],
  ['<pre><code>first\nhit end</code></pre>', 'hit', ' end', [rect(120, 170)], 170],
  ['<p>hit <a href="#">link</a> <em>emphasis</em> <code>code</code> tail</p><p>outside</p>', 'hit', ' link emphasis code tail', [rect(100, 170), rect(100, 210), rect(120, 450)], 210],
  ['<p>first line hit end</p>', 'line hit', ' end', [rect(120, 180)], 180],
  ['<p>hit</p>', 'hit', '', [], 140],
]) {
  test(`finds the text line end for ${html} without including other lines or segments`, t => {
    const { window, article } = articleFixture(t, html);
    const segments = search.collectSegments(article);
    const { starts: [match] } = search.findMatches(segments.map(segment => segment.text), query, 10);
    const tails = [];
    window.Range.prototype.getClientRects = function () { tails.push(this.toString()); return rectangles; };
    const line = rect(html.includes('first') ? 120 : 100, 140);
    assert.equal(segments[match.segment].lineEnd(match.offset + query.length, line), expected);
    assert.deepEqual(tails, [tail]);
  });
}

test('calculates a line end in 10 MiB of plain text using only the rest of the matching line', t => {
  const { window, article } = articleFixture(t, '<pre></pre>');
  const line = 'hit ' + 'x'.repeat(75) + '\n';
  const text = line.repeat(131072);
  assert.equal(Buffer.byteLength(text), 10 * 1024 * 1024);
  article.querySelector('pre').textContent = text;
  const [segment] = search.collectSegments(article);
  const tails = [];
  window.Range.prototype.getClientRects = function () {
    tails.push([this.startOffset, this.endOffset, this.startContainer, this.endContainer]);
    return [rect(100, 600)];
  };
  for (const start of [0, text.length / 2, text.length - line.length]) {
    assert.equal(segment.lineEnd(start + 3, rect(100, 140)), 600);
    assert.deepEqual(tails.at(-1), [start + 3, start + 79, article.querySelector('pre').firstChild, article.querySelector('pre').firstChild]);
  }
  assert.equal(tails.length, 3);
});

for (const [query, result, open, shown] of [
  ['one', 'committed', false, true],
  ['', 'closed', false, false],
  ['missing', 'empty', true, true],
]) {
  test(`commit returns ${result} for ${JSON.stringify(query)} and exposes its resulting panel state`, t => {
    const { article, window } = articleFixture(t, '<p>one one one</p>');
    window.Range.prototype.getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 100, right: 140, width: 40, height: 20 });
    window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
    window.scrollBy = () => {};
    const frames = new Map();
    let frameId = 0;
    window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
    window.cancelAnimationFrame = id => frames.delete(id);
    const highlights = fakeHighlights();
    const controller = search.createSearch(article, { highlights });
    t.after(() => controller.dispose());
    controller.open();
    controller.input.value = query;
    controller.input.dispatchEvent(new window.Event('input'));
    assert.equal(controller.commit(), result);
    assert.equal(controller.isOpen, open);
    assert.equal(controller.isShown, shown);
    if (result === 'committed') {
      assert.equal(frames.size, 1);
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach(callback => callback(0));
      assert.equal(article.parentElement.querySelector('.search-count').textContent, '[1/3]');
      assert.equal(article.getAttribute('style'), null);
    } else assert.equal(frames.size, 0);
    assert.equal(window.document.activeElement, open ? controller.input : article);
    if (result === 'committed') assert.equal([...highlights.registry.get('mjp-search-current')][0].startOffset, 0);
    if (result === 'empty') assert.equal(article.parentElement.querySelector('[role="search"] [aria-live]').textContent, '0/0');
  });
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
    const highlight = new Set(ranges);
    created.push(highlight);
    return highlight;
  } };
}

test('retains registered highlights while incremental queries replace every old Range', t => {
  const { article } = articleFixture(t, '<p>yes yazi yard yazi</p>');
  const segments = search.collectSegments(article);
  const highlights = fakeHighlights();
  const set = t.mock.method(highlights.registry, 'set');
  const remove = t.mock.method(highlights.registry, 'delete');
  const first = rangesFor(segments, 'y');
  search.updateHighlights(highlights, first, 0);
  const all = highlights.registry.get('mjp-search');
  const current = highlights.registry.get('mjp-search-current');
  let previous = first;
  for (const query of ['ya', 'yaz', 'yazi']) {
    const ranges = rangesFor(segments, query);
    search.updateHighlights(highlights, ranges, 1);
    assert.equal(highlights.registry.get('mjp-search'), all);
    assert.equal(highlights.registry.get('mjp-search-current'), current);
    assert.deepEqual([...all], ranges);
    assert.deepEqual([...current], [ranges[1]]);
    for (const range of previous) {
      assert.equal(all.has(range), false);
      assert.equal(current.has(range), false);
    }
    previous = ranges;
  }
  search.updateHighlights(highlights, previous, 0);
  assert.equal(highlights.registry.get('mjp-search-current'), current);
  assert.deepEqual([...current], [previous[0]]);
  assert.equal(current.priority, 1);
  assert.equal(highlights.created.length, 2);
  assert.equal(set.mock.callCount(), 2);
  assert.equal(remove.mock.callCount(), 0);
});

test('clears hidden or zero-result highlights and reuses their registrations when results return', t => {
  const { article } = articleFixture(t, '<p>yes yazi yard yazi</p>');
  const segments = search.collectSegments(article);
  const highlights = fakeHighlights();
  const first = rangesFor(segments, 'y');
  search.updateHighlights(highlights, first, 0);
  const all = highlights.registry.get('mjp-search');
  const current = highlights.registry.get('mjp-search-current');
  for (let cycle = 0; cycle < 2; cycle++) {
    search.updateHighlights(highlights, [], -1);
    assert.equal(highlights.registry.get('mjp-search'), all);
    assert.equal(highlights.registry.get('mjp-search-current'), current);
    assert.equal(all.size, 0);
    assert.equal(current.size, 0);
    const ranges = rangesFor(segments, cycle ? 'yazi' : 'ya');
    search.updateHighlights(highlights, ranges, 1);
    assert.equal(highlights.registry.get('mjp-search'), all);
    assert.equal(highlights.registry.get('mjp-search-current'), current);
    assert.deepEqual([...all], ranges);
    assert.deepEqual([...current], [ranges[1]]);
    assert.equal(first.some(range => all.has(range) || current.has(range)), false);
  }
  assert.equal(highlights.created.length, 2);
});

test('retains initially empty highlights and clears only the current contents for an invalid index', t => {
  const { article } = articleFixture(t, '<p>yazi yazi</p>');
  const highlights = fakeHighlights();
  search.updateHighlights(highlights, [], -1);
  const all = highlights.registry.get('mjp-search');
  const current = highlights.registry.get('mjp-search-current');
  assert.ok(all);
  assert.ok(current);
  assert.equal(all.size, 0);
  assert.equal(current.size, 0);
  const ranges = rangesFor(search.collectSegments(article), 'yazi');
  for (const index of [0, -1, ranges.length]) {
    search.updateHighlights(highlights, ranges, index);
    assert.equal(highlights.registry.get('mjp-search'), all);
    assert.equal(highlights.registry.get('mjp-search-current'), current);
    assert.deepEqual([...all], ranges);
    assert.deepEqual([...current], index === 0 ? [ranges[0]] : []);
  }
  assert.equal(highlights.created.length, 2);
});

test('registers all matches and the current match without changing any document nodes', t => {
  const { article } = articleFixture(t, '<p>Ｆ<em>o</em>o foo</p><pre><code>FOO</code></pre>');
  const html = article.innerHTML;
  const nodes = [...article.querySelectorAll('*')].flatMap(node => [node, ...node.childNodes]);
  const ranges = rangesFor(search.collectSegments(article), 'foo');
  const highlights = fakeHighlights();
  search.updateHighlights(highlights, ranges, 1);
  const all = highlights.registry.get('mjp-search');
  const current = highlights.registry.get('mjp-search-current');
  assert.deepEqual([...all].map(range => range.toString()), ['Ｆoo', 'foo', 'FOO']);
  assert.deepEqual([...current], [ranges[1]]);
  assert.equal(current.priority, 1);
  assert.equal(ranges[0].startContainer, article.querySelector('p').firstChild);
  assert.equal(ranges[0].startOffset, 0);
  assert.equal(ranges[0].endContainer, article.querySelector('em').nextSibling);
  assert.equal(ranges[0].endOffset, 1);
  search.updateHighlights(highlights, ranges, 2);
  assert.deepEqual([...highlights.registry.get('mjp-search-current')], [ranges[2]]);
  search.updateHighlights(highlights, [], -1);
  assert.equal(highlights.registry.get('mjp-search'), all);
  assert.equal(highlights.registry.get('mjp-search-current'), current);
  assert.equal(all.size, 0);
  assert.equal(current.size, 0);
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
    assert.equal(highlights.registry.get('mjp-search').size, ranges.length);
    assert.equal([...highlights.registry.get('mjp-search-current')][0], ranges.at(-1));
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
  assert.deepEqual([...highlights.registry.get('mjp-search')].map(range => range.toString()), ['foo', 'foo', 'foo']);
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
