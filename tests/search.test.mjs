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

function searchControllerFixture(t, classes = null, style = null) {
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
  const controller = search.createSearch(article);
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
  return { article, window, controller, frames, input, frame };
}

{
  for (const [classes, style] of [
    [null, null], ['', ''], ['markdown-body keep', 'color:red; transform:translateX(2px) !important'],
  ]) {
    test(`search never changes article class or style with ${JSON.stringify([classes, style])}`, t => {
      const f = searchControllerFixture(t, classes, style);
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

function overlayBoxes(f) { return [...f.article.parentElement.querySelectorAll('.search-mark')]; }
function boxGeometry(box) { return ['left', 'top', 'width', 'height'].map(name => parseFloat(box.style[name])); }
function searchAndDraw(f, query = 'short') { f.input(query); f.frame(); f.frame(); }

test('draws one sibling box per nonzero match rectangle in page coordinates and distinguishes the current match', t => {
  const f = searchControllerFixture(t);
  f.window.scrollX = 25;
  f.window.scrollY = 200;
  f.window.Range.prototype.getClientRects = function () {
    return this.startOffset === 0 ? [rect(100.25, 140, 100), rect(120.5, 160, 120), rect(80, 0), { ...rect(90, 150), height: 0, bottom: 90 }] : [rect(180, 230, 200)];
  };
  searchAndDraw(f);
  const container = f.article.parentElement.querySelector('.search-marks');
  assert.ok(container);
  assert.equal(container.getAttribute('aria-hidden'), 'true');
  assert.equal(container.parentElement, f.article.parentElement);
  assert.equal(container.nextElementSibling === f.article || Boolean(container.compareDocumentPosition(f.article) & f.window.Node.DOCUMENT_POSITION_FOLLOWING), true);
  const boxes = overlayBoxes(f);
  assert.deepEqual(boxes.map(boxGeometry), [[125, 300.25, 40, 20], [145, 320.5, 40, 20], [225, 380, 30, 20]]);
  assert.deepEqual(boxes.map(box => box.classList.contains('search-mark-current')), [true, true, false]);
  assert.equal(f.article.querySelector('.search-mark'), null);
});

test('reuses box elements and attaches them in one fragment update while navigation uses the latest state', t => {
  const f = searchControllerFixture(t);
  searchAndDraw(f);
  const boxes = overlayBoxes(f);
  assert.equal(boxes.length, 2);
  const container = boxes[0].parentElement;
  const updates = new f.window.MutationObserver(() => {});
  updates.observe(container, { childList: true });
  t.after(() => updates.disconnect());
  f.controller.commit();
  f.controller.move(1);
  f.controller.move(-1);
  assert.equal(f.frames.size, 1);
  f.frame();
  assert.deepEqual(overlayBoxes(f), boxes);
  assert.equal(overlayBoxes(f)[0].classList.contains('search-mark-current'), true);
  assert.equal(updates.takeRecords().filter(record => record.addedNodes.length).length, 1);
});

for (const selector of ['pre', 'table']) {
  test(`clips rectangles against the visible ${selector}, including fully hidden and nested clips`, t => {
    const f = searchControllerFixture(t);
    f.article.innerHTML = selector === 'pre' ? '<div style="overflow-x:auto"><pre style="overflow-x:auto">short</pre></div>' : '<div style="overflow-x:auto"><table style="overflow-x:auto"><tr><td>short</td></tr></table></div>';
    f.controller.documentReplaced();
    f.article.firstChild.getBoundingClientRect = () => ({ ...rect(100, 180, 90), bottom: 160, height: 60 });
    f.article.querySelector(selector).getBoundingClientRect = () => ({ ...rect(110, 200, 100), bottom: 150, height: 40 });
    f.window.Range.prototype.getClientRects = () => [rect(100, 150, 80), rect(130, 230, 150), rect(110, 90, 50), rect(170, 140, 110)];
    searchAndDraw(f);
    assert.deepEqual(overlayBoxes(f).map(boxGeometry), [[100, 110, 50, 10], [150, 130, 30, 20]]);
  });

  test(`reclips boxes on captured horizontal ${selector} scrolling in the same frame as the badge`, t => {
    const f = searchControllerFixture(t);
    f.article.innerHTML = selector === 'pre' ? '<pre style="overflow-x:auto">short</pre>' : '<table style="overflow-x:auto"><tr><td>short</td></tr></table>';
    f.controller.documentReplaced();
    const scroller = f.article.querySelector(selector);
    scroller.getBoundingClientRect = () => ({ ...rect(90, 200, 100), bottom: 140, height: 50 });
    f.window.Range.prototype.getClientRects = () => [rect(100, 250 - scroller.scrollLeft, 180 - scroller.scrollLeft)];
    searchAndDraw(f);
    f.controller.commit();
    f.frame();
    assert.deepEqual(overlayBoxes(f).map(boxGeometry), [[180, 100, 20, 20]]);
    scroller.scrollLeft = 100;
    scroller.dispatchEvent(new f.window.Event('scroll'));
    assert.equal(f.frames.size, 1);
    f.frame();
    assert.deepEqual(overlayBoxes(f).map(boxGeometry), [[100, 100, 50, 20]]);
    assert.equal(f.article.parentElement.querySelector('.search-count').hidden, false);
  });
}

test('keeps overlays visible while editing and restores prior overlay visibility on cancellation', t => {
  const f = searchControllerFixture(t);
  searchAndDraw(f);
  f.controller.commit();
  f.frame();
  const prior = overlayBoxes(f);
  f.controller.open();
  searchAndDraw(f, 'shore');
  assert.equal(overlayBoxes(f).length, 1);
  f.controller.close();
  f.frame();
  assert.equal(f.controller.input.value, 'short');
  assert.equal(overlayBoxes(f).length, 2);
  assert.equal(overlayBoxes(f)[0], prior[0]);
});

for (const action of ['clear', 'empty', 'zero results', 'cancel', 'dispose']) {
  test(`removes all boxes on ${action} without allowing queued placement to revive them`, t => {
    const f = searchControllerFixture(t);
    searchAndDraw(f);
    assert.equal(overlayBoxes(f).length, 2);
    f.controller.commit();
    const queued = [...f.frames.values()];
    if (action === 'clear') f.controller.close();
    if (action === 'empty' || action === 'zero results') {
      f.controller.open();
      searchAndDraw(f, action === 'empty' ? '' : 'missing');
      if (action === 'empty') f.controller.commit();
    }
    if (action === 'cancel') {
      f.controller.close();
      f.controller.open();
      searchAndDraw(f, 'sh');
      f.controller.close();
    }
    if (action === 'dispose') f.controller.dispose();
    queued.forEach(callback => callback(0));
    f.frame();
    assert.equal(overlayBoxes(f).length, 0);
    if (action === 'dispose') assert.equal(f.article.parentElement.querySelector('.search-marks'), null);
  });
}

test('does not depend on CSS Highlight or change user Selection, even on confirmation and navigation', t => {
  const f = searchControllerFixture(t);
  Object.defineProperty(f.window, 'CSS', { get() { throw new Error('CSS Highlight must not be consulted'); } });
  const selection = f.window.getSelection();
  selection.setBaseAndExtent(f.article.firstChild.firstChild, 5, f.article.firstChild.firstChild, 0);
  searchAndDraw(f);
  f.controller.commit();
  f.frame();
  f.controller.move(1);
  f.frame();
  assert.equal(overlayBoxes(f).length, 2);
  assert.equal(selection.toString(), 'short');
  assert.equal(selection.anchorOffset, 5);
  assert.equal(selection.focusOffset, 0);
});

for (const total of [999, 1000, 1001]) {
  test(`draws only the retained 1000 matches at a total of ${total}`, t => {
    const f = searchControllerFixture(t);
    f.article.textContent = 'a'.repeat(total);
    f.controller.documentReplaced();
    searchAndDraw(f, 'a');
    assert.equal(overlayBoxes(f).length, Math.min(total, 1000));
  });
}

test('keeps page-coordinate boxes unchanged on window scrolling', t => {
  const f = searchControllerFixture(t);
  searchAndDraw(f);
  const before = overlayBoxes(f).map(boxGeometry);
  const layout = t.mock.method(f.window.Range.prototype, 'getClientRects');
  f.window.scrollY = 300;
  f.window.dispatchEvent(new f.window.Event('scroll'));
  assert.equal(f.frames.size, 0);
  assert.deepEqual(overlayBoxes(f).map(boxGeometry), before);
  assert.equal(layout.mock.callCount(), 0);
});

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
    const controller = search.createSearch(article);
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
    if (result === 'committed') assert.equal(article.parentElement.querySelectorAll('.search-mark-current').length, 1);
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

test('creates at most 1000 match Ranges', t => {
  const { article, window } = articleFixture(t, '<pre></pre>');
  const createRange = t.mock.method(window.document, 'createRange');
  for (const count of [999, 1000, 1001]) {
    article.firstChild.textContent = 'a'.repeat(count);
    const ranges = rangesFor(search.collectSegments(article), 'a');
    assert.equal(ranges.length, Math.min(count, 1000));
    assert.equal(createRange.mock.callCount(), Math.min(count, 1000));
    createRange.mock.resetCalls();
  }
});

test('searching markup-like text never inserts elements or changes the article', t => {
  const f = searchControllerFixture(t);
  const { article } = f;
  article.innerHTML = '<p>&lt;img src=x onerror=example()&gt; &amp; &lt;script&gt;</p>';
  f.controller.documentReplaced();
  const html = article.innerHTML;
  const paragraph = article.firstChild;
  const text = paragraph.firstChild;
  for (const query of ['<img src=x onerror=example()>', '<script>', '</p><img src=x>']) {
    searchAndDraw(f, query);
    assert.equal(overlayBoxes(f).length, query.startsWith('</p>') ? 0 : 1);
  }
  assert.equal(article.innerHTML, html);
  assert.equal(article.firstChild, paragraph);
  assert.equal(paragraph.firstChild, text);
  assert.equal(article.querySelector('img, script'), null);
});

test('search highlighting preserves rendered code copying and external link actions', async t => {
  const f = searchControllerFixture(t);
  const { window, article } = f;
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
  f.controller.documentReplaced();
  searchAndDraw(f, 'foo');
  assert.equal(overlayBoxes(f).length, 3);
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
