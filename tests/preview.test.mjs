import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as searchModule from '../src/search.ts';

globalThis.window = new JSDOM().window;
const { startPreview } = await import('../src/preview.ts');
const snapshot = (text, revision = 0, error = null) => ({ text, revision, error, warning: null });

async function setup(t, deferred = false, loadSearch = async () => searchModule) {
  const { window } = new JSDOM('<article></article><aside></aside>');
  t.after(() => window.close());
  const article = window.document.querySelector('article');
  const status = window.document.querySelector('aside');
  const by = t.mock.method(window, 'scrollBy', () => {});
  const to = t.mock.method(window, 'scrollTo', () => {});
  const registry = new Map();
  window.CSS = { highlights: registry };
  window.Highlight = class extends Set { constructor(...ranges) { super(ranges); } };
  const frames = new Map();
  let frameNumber = 0;
  window.requestAnimationFrame = callback => { frames.set(++frameNumber, callback); return frameNumber; };
  window.cancelAnimationFrame = id => { frames.delete(id); };
  let matchRect = { top: 100, bottom: 120, left: 100, right: 140, width: 40, height: 20 };
  window.Range.prototype.getBoundingClientRect = function () {
    return typeof matchRect === 'function' ? matchRect(this) : matchRect;
  };
  window.Range.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
  const observers = [];
  window.ResizeObserver = class {
    targets = new Set();
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.targets.clear(); }
    notify(target) { this.callback([{ target }], this); }
  };
  const pending = [];
  const calls = [];
  let changed;
  let current = snapshot('# Initial');
  const boot = startPreview(article, status, {
    subscribe: async callback => { calls.push('subscribe'); changed = callback; },
    getDocument: () => {
      calls.push('read');
      return deferred ? new Promise((resolve, reject) => pending.push({ resolve, reject })) : Promise.resolve(current);
    },
    close: async () => { calls.push('close'); },
    openExternal: async url => { calls.push(['open', url]); },
    writeText: async text => { calls.push(['copy', text]); },
    loadSearch: () => { calls.push('search'); return loadSearch(); },
  });
  await new Promise(resolve => setImmediate(resolve));
  if (!deferred) await boot;
  to.mock.resetCalls();
  const key = (key, options = {}, target = article) => {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
  };
  return { window, article, status, calls, pending, boot, by, to, key, registry, frames, observers,
    frame: () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(0));
    },
    setMatchRect: rect => { matchRect = rect; },
    changed: () => changed(), setSnapshot: value => { current = value; } };
}

test('subscribes before reading and renders subsequent document notifications', async t => {
  const f = await setup(t);
  assert.deepEqual(f.calls, ['subscribe', 'read']);
  assert.equal(f.article.querySelector('h1').textContent, 'Initial');
  Object.defineProperty(f.window, 'scrollY', { value: 240 });
  f.setSnapshot(snapshot('# Saved', 1));
  await f.changed();
  assert.equal(f.article.querySelector('h1').textContent, 'Saved');
  assert.deepEqual(f.to.mock.calls[0].arguments, [0, 240]);
  const content = f.article.firstChild;
  f.setSnapshot(snapshot('# Saved', 2, 'Cannot read file'));
  await f.changed();
  assert.equal(f.article.firstChild, content);
  assert.equal(f.status.textContent, 'Cannot read file');
  f.setSnapshot(snapshot('# Recreated', 3));
  await f.changed();
  assert.equal(f.status.hidden, true);
  assert.equal(f.article.querySelector('h1').textContent, 'Recreated');
});

function assertNoSearchRanges(registry) {
  for (const name of ['mjp-search', 'mjp-search-current']) assert.equal(registry.get(name)?.size ?? 0, 0);
}

async function openFind(f, text = 'one one one', key = '/') {
  f.setSnapshot(snapshot(text, 1));
  await f.changed();
  f.by.mock.resetCalls();
  f.to.mock.resetCalls();
  assert.equal(f.key(key, key === 'f' ? { metaKey: true } : {}).defaultPrevented, true);
  await new Promise(resolve => setImmediate(resolve));
  const panel = f.window.document.querySelector('[role="search"]');
  assert.ok(panel);
  return { panel, input: panel.querySelector('input'), count: panel.querySelector('[aria-live="polite"]') };
}

function queueFind(f, input, value) {
  input.value = value;
  input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
}

function typeFind(f, input, value) {
  queueFind(f, input, value);
  f.frame();
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('typing y through yazi updates registered highlights in place through hiding, redisplay, and replacement', async t => {
  const f = await setup(t);
  const { input } = await openFind(f, 'yes yazi yard yazi');
  const set = t.mock.method(f.registry, 'set');
  typeFind(f, input, 'y');
  const all = f.registry.get('mjp-search');
  const current = f.registry.get('mjp-search-current');
  let previous = [...all];
  for (const query of ['ya', 'yaz', 'yazi']) {
    typeFind(f, input, query);
    assert.equal(f.registry.get('mjp-search'), all);
    assert.equal(f.registry.get('mjp-search-current'), current);
    assert.deepEqual([...all].map(range => range.toString()), query === 'ya' ? ['ya', 'ya', 'ya'] : [query, query]);
    assert.deepEqual([...current], [[...all][0]]);
    assert.equal(previous.some(range => all.has(range) || current.has(range)), false);
    previous = [...all];
  }
  f.key('Enter', {}, input);
  f.key('Escape');
  assertNoSearchRanges(f.registry);
  assert.equal(all.size, 0);
  assert.equal(current.size, 0);
  f.key('n');
  assert.equal(f.registry.get('mjp-search'), all);
  assert.equal(f.registry.get('mjp-search-current'), current);
  assert.deepEqual([...all].map(range => range.toString()), ['yazi', 'yazi']);
  assert.deepEqual([...current], [[...all][1]]);
  previous = [...all];
  f.setSnapshot(snapshot('new yazi', 2));
  await f.changed();
  assert.equal(f.registry.get('mjp-search'), all);
  assert.equal(f.registry.get('mjp-search-current'), current);
  assert.equal(all.size, 1);
  assert.equal(previous.some(range => all.has(range) || current.has(range)), false);
  assert.equal([...all][0].startContainer, f.article.querySelector('p').firstChild);
  assert.equal(set.mock.callCount(), 0);
});

test('clears both registered highlights before unregistering them on page exit', async t => {
  const f = await setup(t);
  const { input } = await openFind(f);
  typeFind(f, input, 'one');
  const all = f.registry.get('mjp-search');
  const current = f.registry.get('mjp-search-current');
  const removed = [];
  t.mock.method(f.registry, 'delete', name => {
    removed.push([name, f.registry.get(name).size]);
    return Map.prototype.delete.call(f.registry, name);
  });
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  assert.deepEqual(removed, [['mjp-search', 0], ['mjp-search-current', 0]]);
  assert.equal(all.size, 0);
  assert.equal(current.size, 0);
  assert.equal(f.registry.size, 0);
});

const badgeRect = (top, right, left = 100) => ({ top, bottom: top + 20, left, right, width: right - left, height: 20 });

async function badgeFixture(t, text = 'one one one', fallback = false) {
  const f = await setup(t);
  if (fallback) f.window.CSS.highlights = undefined;
  const controls = await openFind(f, text);
  const badge = f.window.document.querySelector('.search-count');
  assert.ok(badge);
  badge.getBoundingClientRect = () => badgeRect(0, 56, 0);
  f.article.getBoundingClientRect = () => badgeRect(0, 650, 50);
  return { ...f, ...controls, badge };
}

for (const fallback of [false, true]) {
  test(`shows a sibling count badge after confirmation and navigation using ${fallback ? 'Selection' : 'CSS highlights'}`, async t => {
    const f = await badgeFixture(t, 'one one one', fallback);
    const children = [...f.article.querySelectorAll('*')];
    const html = f.article.innerHTML;
    assert.equal(f.badge.hidden, true);
    typeFind(f, f.input, 'one');
    assert.equal(f.badge.hidden, true);
    f.key('Enter', {}, f.input);
    f.frame();
    assert.equal(f.badge.hidden, false);
    assert.equal(f.badge.textContent, '[1/3]');
    assert.equal(f.badge.getAttribute('aria-live'), 'polite');
    assert.equal(f.badge.parentElement, f.article.parentElement);
    assert.equal(f.badge.style.left, '148px');
    assert.equal(f.badge.style.top, '100px');
    f.key('n');
    f.frame();
    assert.equal(f.badge.textContent, '[2/3]');
    f.key('N');
    f.frame();
    assert.equal(f.badge.textContent, '[1/3]');
    assert.equal(f.article.innerHTML, html);
    assert.deepEqual([...f.article.querySelectorAll('*')], children);
    f.key('Escape');
    assert.equal(f.badge.hidden, true);
  });
}

for (const total of [999, 1000, 1001]) {
  test(`shows the confirmed count cap in the badge for ${total} matches`, async t => {
    const f = await badgeFixture(t, 'a'.repeat(total));
    typeFind(f, f.input, 'a');
    f.key('Enter', {}, f.input);
    f.key('n');
    f.key('n');
    f.frame();
    assert.equal(f.badge.textContent, `[3/${Math.min(total, 1000)}${total > 1000 ? '+' : ''}]`);
  });
}

test('places the badge at the last matching line and the same-line text end in document coordinates', async t => {
  const f = await badgeFixture(t, 'one **two** [tail](https://example.com)\n\nother');
  f.window.scrollY = 200;
  f.window.scrollX = 25;
  f.window.Range.prototype.getClientRects = function () {
    if (this.toString() === 'one two') return [badgeRect(80, 200), badgeRect(100, 180)];
    assert.equal(this.toString(), ' tail');
    return [badgeRect(100, 260), badgeRect(120, 600)];
  };
  typeFind(f, f.input, 'one two');
  f.key('Enter', {}, f.input);
  f.frame();
  assert.equal(f.badge.style.left, '293px');
  assert.equal(f.badge.style.top, '300px');
});

test('overlays the badge inside the article right edge when the line has no remaining space', async t => {
  const f = await badgeFixture(t);
  f.window.Range.prototype.getClientRects = () => [badgeRect(100, 640)];
  typeFind(f, f.input, 'one');
  f.key('Enter', {}, f.input);
  f.frame();
  assert.equal(f.badge.style.left, '594px');
});

for (const [text, selector] of [['```\none tail\n```', 'pre'], ['|one tail|\n|---|\n|value|', 'table']]) {
  test(`keeps the badge inside the visible ${selector} scrolling area`, async t => {
    const f = await badgeFixture(t, text);
    const scroller = f.article.querySelector(selector);
    scroller.style.overflowX = 'auto';
    scroller.getBoundingClientRect = () => badgeRect(100, 252, 50);
    Object.defineProperty(scroller, 'clientWidth', { value: 200 });
    Object.defineProperty(scroller, 'clientLeft', { value: 2 });
    f.window.Range.prototype.getClientRects = () => [badgeRect(100, 600)];
    typeFind(f, f.input, 'one');
    f.key('Enter', {}, f.input);
    f.frame();
    assert.equal(f.badge.style.left, '196px');
  });
}

for (const event of ['resize', 'article size', 'status size', 'scroll', 'load', 'error']) {
  test(`repositions the badge after ${event} without searching or changing document sizes`, async t => {
    const f = await badgeFixture(t, 'one <img>');
    const image = f.window.document.createElement('img');
    f.article.append(image);
    typeFind(f, f.input, 'one');
    f.key('Enter', {}, f.input);
    f.frame();
    const current = f.registry.get('mjp-search-current');
    const articleBounds = f.article.getBoundingClientRect();
    const statusBounds = f.status.getBoundingClientRect();
    f.setMatchRect(badgeRect(240, 300));
    if (event === 'resize') f.window.dispatchEvent(new f.window.Event('resize'));
    else if (event.endsWith('size')) {
      const target = event === 'article size' ? f.article : f.status;
      assert.ok(f.observers[0].targets.has(target));
      f.observers[0].notify(target);
    } else image.dispatchEvent(new f.window.Event(event));
    assert.equal(f.frames.size, 1);
    f.frame();
    assert.equal(f.badge.style.left, '308px');
    assert.equal(f.badge.style.top, '240px');
    assert.equal(f.registry.get('mjp-search-current'), current);
    assert.deepEqual(f.article.getBoundingClientRect(), articleBounds);
    assert.deepEqual(f.status.getBoundingClientRect(), statusBounds);
  });
}

test('coalesces badge placement separately from search and uses the latest match geometry', async t => {
  const f = await badgeFixture(t);
  typeFind(f, f.input, 'one');
  f.key('Enter', {}, f.input);
  f.key('n');
  f.key('n');
  f.window.dispatchEvent(new f.window.Event('resize'));
  f.article.dispatchEvent(new f.window.Event('scroll'));
  f.observers[0].notify(f.article);
  f.setMatchRect(badgeRect(260, 400));
  const layout = t.mock.method(f.window.Range.prototype, 'getClientRects');
  assert.equal(f.frames.size, 1);
  f.frame();
  assert.equal(layout.mock.callCount(), 2);
  assert.equal(f.badge.style.left, '408px');
  assert.equal(f.badge.style.top, '260px');
  assert.equal(f.badge.textContent, '[3/3]');
});

for (const action of ['open', 'clear', 'pagehide']) {
  test(`suppresses queued badge placement after ${action}`, async t => {
    const f = await badgeFixture(t);
    typeFind(f, f.input, 'one');
    f.key('Enter', {}, f.input);
    const queued = [...f.frames.values()];
    if (action === 'open') f.key('f', { metaKey: true });
    else if (action === 'clear') f.key('Escape');
    else f.window.dispatchEvent(new f.window.Event('pagehide'));
    queued.forEach(callback => callback(0));
    f.frame();
    assert.equal(f.badge.hidden, true);
    assert.equal(f.frames.size, 0);
  });
}

test('restores the badge on cancel and refreshes it against replacement content until results become empty', async t => {
  const f = await badgeFixture(t, 'old old old new');
  typeFind(f, f.input, 'old');
  f.key('Enter', {}, f.input);
  f.key('n');
  f.frame();
  assert.equal(f.badge.textContent, '[2/3]');
  f.key('f', { metaKey: true });
  typeFind(f, f.input, 'new');
  assert.equal(f.badge.hidden, true);
  f.key('Escape', {}, f.input);
  f.frame();
  assert.equal(f.badge.hidden, false);
  assert.equal(f.badge.textContent, '[2/3]');
  f.setSnapshot(snapshot('old old', 2));
  await f.changed();
  f.setMatchRect(badgeRect(220, 340));
  f.frame();
  assert.equal(f.badge.textContent, '[2/2]');
  assert.equal(f.badge.style.top, '220px');
  f.setSnapshot(snapshot('new', 3));
  await f.changed();
  f.frame();
  assert.equal(f.badge.hidden, true);
});

test('keeps the badge hidden for empty confirmation and zero-result searches', async t => {
  const f = await badgeFixture(t);
  typeFind(f, f.input, 'missing');
  f.key('Enter', {}, f.input);
  f.frame();
  assert.equal(f.badge.hidden, true);
  typeFind(f, f.input, '');
  f.key('Enter', {}, f.input);
  f.window.dispatchEvent(new f.window.Event('resize'));
  f.frame();
  assert.equal(f.badge.hidden, true);
});

test('removes badge observers and all placement listeners on page exit', async t => {
  const f = await badgeFixture(t);
  typeFind(f, f.input, 'one');
  f.key('Enter', {}, f.input);
  f.frame();
  const removeArticle = t.mock.method(f.article, 'removeEventListener');
  const removeWindow = t.mock.method(f.window, 'removeEventListener');
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  assert.equal(f.window.document.querySelector('.search-count'), null);
  assert.equal(f.observers[0].targets.size, 0);
  assert.deepEqual(removeArticle.mock.calls.map(call => [call.arguments[0], call.arguments[2]]), [['scroll', true], ['load', true], ['error', true]]);
  assert.ok(removeWindow.mock.calls.some(call => call.arguments[0] === 'resize'));
  f.window.dispatchEvent(new f.window.Event('resize'));
  for (const event of ['scroll', 'load', 'error']) f.article.dispatchEvent(new f.window.Event(event));
  f.observers[0].notify(f.article);
  assert.equal(f.frames.size, 0);
});

function matchTops(f, tops) {
  f.setMatchRect(range => {
    const top = tops[range.startOffset] - f.window.scrollY;
    return { top, bottom: top + 20, left: 100, right: 140, width: 40, height: 20 };
  });
}

async function confirmFindAt(f, index) {
  const controls = await openFind(f, 'one one one one');
  typeFind(f, controls.input, 'one');
  f.key('Enter', {}, controls.input);
  for (let i = 0; i < index; i++) f.key('n');
  Object.defineProperty(f.window, 'innerHeight', { value: 400 });
  return controls;
}

for (const fallback of [false, true]) {
  const display = fallback ? 'Selection' : 'CSS highlights';
  const currentRange = f => fallback ? f.window.getSelection().getRangeAt(0) : [...f.registry.get('mjp-search-current')][0];
  for (const shown of [false, true]) {
    for (const [position, current, scrollY, key, expected] of [
      ['above', 0, 400, 'n', 2], ['above', 0, 400, 'N', 2],
      ['below', 3, 0, 'n', 0], ['below', 3, 0, 'N', 1],
    ]) {
      test(`${key} continues from the viewport with the current match ${position}, shown=${shown}, using ${display}`, async t => {
        const f = await setup(t);
        if (fallback) f.window.CSS.highlights = undefined;
        const { panel } = await confirmFindAt(f, current);
        if (!shown) f.key('Escape');
        matchTops(f, { 0: 100, 4: 300, 8: 500, 12: 900 });
        f.window.scrollY = scrollY;
        f.by.mock.resetCalls();
        assert.equal(f.key(key).defaultPrevented, true);
        assert.equal(currentRange(f).startOffset, expected * 4);
        assert.equal(panel.hidden, true);
        assert.equal(f.window.document.activeElement, f.article);
        assert.equal(f.by.mock.callCount(), 0);
        if (!fallback) assert.equal(f.registry.get('mjp-search').size, 4);
      });
    }
  }

  for (const [key, scrollY, tops, expected, delta] of [
    ['n', 1000, [100, 300, 500, 900], 0, -1090],
    ['N', 0, [1000, 1200, 1400, 1800], 3, 1610],
  ]) {
    test(`${key} wraps when no match remains beyond the viewport boundary using ${display}`, async t => {
      const f = await setup(t);
      if (fallback) f.window.CSS.highlights = undefined;
      await confirmFindAt(f, 1);
      matchTops(f, Object.fromEntries(tops.map((top, index) => [index * 4, top])));
      f.window.scrollY = scrollY;
      f.by.mock.resetCalls();
      f.key(key);
      assert.equal(currentRange(f).startOffset, expected * 4);
      assert.deepEqual(f.by.mock.calls.map(call => call.arguments), [[0, delta]]);
    });
  }

  for (const shown of [false, true]) {
    for (const key of ['n', 'N']) {
      test(`${key} chooses viewport matches in replacement content with shown=${shown} using ${display}`, async t => {
        const f = await setup(t);
        if (fallback) f.window.CSS.highlights = undefined;
        const { panel } = await confirmFindAt(f, 0);
        if (!shown) f.key('Escape');
        f.setSnapshot(snapshot('new one one one one', 2));
        await f.changed();
        matchTops(f, { 4: 100, 8: 300, 12: 500, 16: 900 });
        f.window.scrollY = 400;
        f.by.mock.resetCalls();
        f.key(key);
        const range = currentRange(f);
        assert.equal(range.startOffset, 12);
        assert.equal(range.startContainer, f.article.querySelector('p').firstChild);
        assert.equal(range.toString(), 'one');
        assert.equal(panel.hidden, true);
        assert.equal(f.by.mock.callCount(), 0);
      });
    }
  }
}

for (const [position, tops, key, expected, scrolls = false] of [
  ['inside', [0, 100, 200, 300], 'n', 2], ['inside', [0, 100, 200, 300], 'N', 0],
  ['at the top', [-100, 0, 100, 200], 'n', 2], ['at the top', [-100, 0, 100, 200], 'N', 0, true],
  ['at the bottom', [100, 380, 500, 700], 'n', 2, true], ['at the bottom', [100, 380, 500, 700], 'N', 0],
  ['partly above', [-100, -10, 100, 500], 'n', 2], ['partly above', [-100, -10, 100, 500], 'N', 2],
  ['partly below', [100, 390, 500, 700], 'n', 0], ['partly below', [100, 390, 500, 700], 'N', 0],
]) {
  test(`${key} selects the expected match when the current match is ${position}`, async t => {
    const f = await setup(t);
    await confirmFindAt(f, 1);
    matchTops(f, Object.fromEntries(tops.map((top, index) => [index * 4, top])));
    f.by.mock.resetCalls();
    f.key(key);
    assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, expected * 4);
    assert.equal(f.by.mock.callCount(), scrolls ? 1 : 0);
  });
}

for (const key of ['n', 'N']) {
  for (const obstacle of ['visible banner', 'hidden banner', 'banner beside the match', 'closed search panel']) {
    test(`${key} considers a ${obstacle} when deciding whether to step from the current match`, async t => {
      const f = await setup(t);
      const { panel } = await confirmFindAt(f, 0);
      matchTops(f, { 0: 20, 4: 40, 8: 60, 12: 300 });
      const overlay = obstacle === 'closed search panel' ? panel : f.status;
      overlay.hidden = obstacle === 'hidden banner' || obstacle === 'closed search panel';
      const left = obstacle === 'banner beside the match' ? 600 : 0;
      overlay.getBoundingClientRect = () => ({ top: 0, bottom: 60, left, right: 800, width: 800 - left, height: 60 });
      f.by.mock.resetCalls();
      f.key(key);
      const expected = key === 'N' ? 3 : obstacle === 'visible banner' ? 2 : 1;
      assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, expected * 4);
      assert.equal(f.by.mock.callCount(), 0);
    });
  }
}

for (const key of ['n', 'N']) {
  test(`${key} leaves empty replacement results hidden without scrolling`, async t => {
    const f = await setup(t);
    const { panel } = await confirmFindAt(f, 0);
    f.setSnapshot(snapshot('missing', 2));
    await f.changed();
    f.by.mock.resetCalls();
    assert.equal(f.key(key).defaultPrevented, true);
    assertNoSearchRanges(f.registry);
    assert.equal(panel.hidden, true);
    assert.equal(f.by.mock.callCount(), 0);
  });
}

async function editPriorSearch(f, shown = true) {
  const controls = await openFind(f, 'old old old new new');
  typeFind(f, controls.input, 'old');
  f.key('Enter', {}, controls.input);
  f.key('n');
  if (!shown) f.key('Escape');
  f.window.scrollY = 180;
  f.key('f', { metaKey: true });
  f.by.mock.resetCalls();
  f.to.mock.resetCalls();
  f.to.mock.mockImplementation((_x, y) => { f.window.scrollY = y; });
  return controls;
}

for (const shown of [false, true]) {
  for (const execute of [false, true]) {
    test(`cancels ${execute ? 'executed' : 'queued'} edits back to the prior query, index, visibility=${shown}, and scroll`, async t => {
      const f = await setup(t);
      const { panel, input } = await editPriorSearch(f, shown);
      queueFind(f, input, 'new');
      if (execute) f.frame();
      f.window.scrollY = 900;
      f.key('Escape', {}, input);
      assert.equal(input.value, 'old');
      assert.equal(panel.hidden, true);
      assert.equal(f.window.scrollY, 180);
      assert.deepEqual(f.to.mock.calls.map(call => call.arguments), [[0, 180]]);
      assert.equal(f.window.document.activeElement, f.article);
      assert.equal(f.calls.includes('close'), false);
      assert.equal(f.frames.size, shown ? 1 : 0);
      if (shown) {
        assert.deepEqual([...f.registry.get('mjp-search')].map(range => range.toString()), ['old', 'old', 'old']);
        assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 4);
      } else assertNoSearchRanges(f.registry);
      const current = f.registry.get('mjp-search-current');
      f.frame();
      assert.equal(f.registry.get('mjp-search-current'), current);
      assert.equal(f.frames.size, 0);
      if (shown) assert.equal(f.window.document.querySelector('.search-count').textContent, '[2/3]');
      assert.equal(f.by.mock.callCount(), 0);
      if (!shown) {
        f.key('n');
        assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 8);
      }
    });
  }
}

for (const [text, count, offset] of [['old new old', 2, 8], ['new old', 1, 4], ['new new', 0, -1]]) {
  test(`cancels against replacement content with ${count} remaining prior-query matches`, async t => {
    const f = await setup(t);
    const { panel, input } = await editPriorSearch(f);
    typeFind(f, input, 'new');
    f.setSnapshot(snapshot(text, 2));
    await f.changed();
    f.to.mock.resetCalls();
    f.key('Escape', {}, input);
    assert.equal(panel.hidden, true);
    assert.equal(input.value, 'old');
    assert.deepEqual(f.to.mock.calls.map(call => call.arguments), [[0, 180]]);
    assert.equal(f.by.mock.callCount(), 0);
    if (count) {
      assert.equal(f.registry.get('mjp-search').size, count);
      const range = [...f.registry.get('mjp-search-current')][0];
      assert.equal(range.toString(), 'old');
      assert.equal(range.startOffset, offset);
      assert.equal(range.startContainer, f.article.querySelector('p').firstChild);
    } else {
      assertNoSearchRanges(f.registry);
      f.key('f', { metaKey: true });
      assert.equal(panel.querySelector('[aria-live]').textContent, '0/0');
    }
  });
}

for (const action of ['refocus', 'zero-result Enter']) {
  test(`preserves the original cancellation state through ${action}`, async t => {
    const f = await setup(t);
    const { panel, input } = await editPriorSearch(f);
    f.window.scrollY = 700;
    typeFind(f, input, action === 'refocus' ? 'new' : 'missing');
    if (action === 'refocus') f.key('f', { metaKey: true }, input);
    else f.key('Enter', {}, input);
    assert.equal(panel.hidden, false);
    f.key('Escape', {}, input);
    assert.equal(input.value, 'old');
    assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 4);
    assert.equal(f.window.scrollY, 180);
    assert.equal(f.calls.includes('close'), false);
  });
}

test('Escape cancels to visible prior marks, then clears marks, then closes the window', async t => {
  const f = await setup(t);
  const { panel, input } = await editPriorSearch(f);
  typeFind(f, input, 'new');
  f.key('Escape', {}, input);
  assert.equal(panel.hidden, true);
  assert.equal([...f.registry.get('mjp-search-current')][0].toString(), 'old');
  assert.equal(f.calls.includes('close'), false);
  f.key('Escape');
  assertNoSearchRanges(f.registry);
  assert.equal(f.calls.includes('close'), false);
  assert.equal(input.value, 'old');
  f.key('Escape');
  assert.equal(f.calls.filter(call => call === 'close').length, 1);
});

test('Escape cancels to hidden prior marks and the following Escape closes immediately', async t => {
  const f = await setup(t);
  const { input } = await editPriorSearch(f, false);
  typeFind(f, input, 'new');
  f.key('Escape', {}, input);
  assert.equal(input.value, 'old');
  assertNoSearchRanges(f.registry);
  assert.equal(f.calls.includes('close'), false);
  f.key('Escape');
  assert.equal(f.calls.filter(call => call === 'close').length, 1);
});

for (const [key, options] of [['q', {}], ['w', { metaKey: true }], ['W', { metaKey: true }]]) {
  for (const shown of [false, true]) {
    test(`${options.metaKey ? 'Cmd+' : ''}${key} closes directly with confirmed marks visible=${shown}`, async t => {
      const f = await setup(t);
      const { input } = await openFind(f);
      typeFind(f, input, 'one');
      f.key('Enter', {}, input);
      if (!shown) f.key('Escape');
      assert.equal(f.calls.includes('close'), false);
      f.key(key, options);
      assert.equal(f.calls.filter(call => call === 'close').length, 1);
    });
  }
}

for (const [scrollY, expectedOffset, expectedCount] of [[150, 4, '2/3'], [200, 4, '2/3'], [500, 0, '1/3']]) {
  test(`selects the first match at or after the opening origin ${scrollY}, wrapping if needed`, async t => {
    const f = await setup(t);
    f.window.scrollY = scrollY;
    matchTops(f, { 0: 100, 4: 200, 8: 400 });
    const { panel, input, count } = await openFind(f);
    typeFind(f, input, 'one');
    assert.equal(count.textContent, expectedCount);
    assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, expectedOffset);
    assert.equal(panel.hidden, false);
  });
}

for (const obstacle of ['status', 'search panel']) {
  test(`selects a match after the origin's ${obstacle} occlusion`, async t => {
    const f = await setup(t);
    f.window.scrollY = 150;
    matchTops(f, { 0: 100, 4: 160, 8: 400 });
    const { panel, input, count } = await openFind(f);
    const overlay = obstacle === 'status' ? f.status : panel;
    overlay.hidden = false;
    overlay.getBoundingClientRect = () => ({ top: 0, bottom: 50, left: 0, right: 800, width: 800, height: 50 });
    typeFind(f, input, 'one');
    assert.equal(count.textContent, '3/3');
    assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 8);
  });
}

test('keeps incremental search anchored to its opening position after scrolling and refocusing', async t => {
  const f = await setup(t);
  f.window.scrollY = 150;
  matchTops(f, { 0: 100, 4: 200, 8: 400 });
  const { input, count } = await openFind(f);
  typeFind(f, input, 'o');
  assert.equal(count.textContent, '2/3');
  f.window.scrollY = 350;
  f.key('f', { metaKey: true }, input);
  typeFind(f, input, 'one');
  assert.equal(count.textContent, '2/3');
  assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 4);
});

test('reselects an existing query from the new origin before unedited Enter confirmation', async t => {
  const f = await setup(t);
  matchTops(f, { 0: 100, 4: 200, 8: 400 });
  const { panel, input, count } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  assert.equal(panel.hidden, true);
  f.window.scrollY = 350;
  f.key('f', { metaKey: true });
  assert.equal(count.textContent, '3/3');
  assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 8);
  f.key('Enter', {}, input);
  assert.equal(panel.hidden, true);
  assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 8);
  assert.equal(f.window.document.activeElement, f.article);
});

for (const shiftKey of [false, true]) {
  test(`confirms the current match with ${shiftKey ? 'Shift+' : ''}Enter without advancing`, async t => {
    const f = await setup(t);
    const { panel, input } = await openFind(f);
    typeFind(f, input, 'one');
    f.key('Enter', { shiftKey }, input);
    assert.equal(panel.hidden, true);
    assert.equal(f.registry.get('mjp-search').size, 3);
    assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 0);
    assert.equal(f.window.document.activeElement, f.article);
    assert.equal(f.key('j').defaultPrevented, true);
    assert.equal(f.key('n').defaultPrevented, true);
    assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 4);
  });
}

test('releases the opening intent after confirmation so two Escapes clear marks and close the window', async t => {
  const f = await setup(t);
  const { input } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  f.key('Escape');
  assertNoSearchRanges(f.registry);
  assert.equal(f.calls.includes('close'), false);
  f.key('Escape');
  assert.equal(f.calls.filter(call => call === 'close').length, 1);
});

test('closes an empty query and releases the opening intent for the following Escape', async t => {
  const f = await setup(t);
  const { panel, input } = await openFind(f);
  f.key('Enter', {}, input);
  assert.equal(panel.hidden, true);
  assertNoSearchRanges(f.registry);
  assert.equal(f.window.document.activeElement, f.article);
  f.key('Escape');
  assert.equal(f.calls.filter(call => call === 'close').length, 1);
});

test('keeps a nonempty zero-result query open until Escape without closing the window', async t => {
  const f = await setup(t);
  const { panel, input, count } = await openFind(f);
  typeFind(f, input, 'missing');
  f.key('Enter', {}, input);
  assert.equal(panel.hidden, false);
  assert.equal(count.textContent, '0/0');
  assert.equal(f.window.document.activeElement, input);
  f.key('Escape', {}, input);
  assert.equal(panel.hidden, true);
  assert.equal(f.calls.includes('close'), false);
});

test('shares one module load and initialization across repeated search shortcuts', async t => {
  const loading = Promise.withResolvers();
  const f = await setup(t, false, () => loading.promise);
  const createSearch = t.mock.fn(searchModule.createSearch);
  f.key('f', { metaKey: true });
  f.key('/');
  f.key('f', { metaKey: true });
  await settle();
  assert.equal(f.calls.filter(call => call === 'search').length, 1);
  assert.equal(createSearch.mock.callCount(), 0);
  assert.equal(f.window.document.querySelector('[role="search"]'), null);
  loading.resolve({ ...searchModule, createSearch });
  await settle();
  assert.equal(createSearch.mock.callCount(), 1);
  assert.equal(f.window.document.querySelectorAll('[role="search"]').length, 1);
  assert.equal(f.window.document.activeElement.type, 'search');
});

for (const reopen of [false, true]) {
  test(`applies the latest ${reopen ? 'open' : 'close'} intent when module loading finishes after Escape`, async t => {
    const loading = Promise.withResolvers();
    const f = await setup(t, false, () => loading.promise);
    f.key('f', { metaKey: true });
    assert.equal(f.key('Escape').defaultPrevented, true);
    if (reopen) f.key('f', { metaKey: true });
    loading.resolve(searchModule);
    await settle();
    const panel = f.window.document.querySelector('[role="search"]');
    assert.equal(panel === null || panel.hidden, !reopen);
    assert.equal(f.calls.filter(call => call === 'search').length, 1);
    assert.equal(f.calls.includes('close'), false);
    assert.equal(f.by.mock.callCount(), 0);
  });
}

test('never initializes search when its module finishes loading after page exit', async t => {
  const loading = Promise.withResolvers();
  const f = await setup(t, false, () => loading.promise);
  const createSearch = t.mock.fn(searchModule.createSearch);
  f.key('/');
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  loading.resolve({ ...searchModule, createSearch });
  await settle();
  f.key('f', { metaKey: true });
  await settle();
  assert.equal(createSearch.mock.callCount(), 0);
  assert.equal(f.window.document.querySelector('[role="search"]'), null);
  assert.equal(f.registry.size, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.calls.filter(call => call === 'search').length, 1);
});

for (const synchronous of [false, true]) {
  test(`reports ${synchronous ? 'synchronous' : 'asynchronous'} module loading failures and permits a retry`, async t => {
    let attempts = 0;
    const f = await setup(t, false, () => {
      if (++attempts > 1) return Promise.resolve(searchModule);
      if (synchronous) throw new Error('Search unavailable');
      return Promise.reject(new Error('Search unavailable'));
    });
    f.key('/');
    await settle();
    assert.equal(f.status.hidden, false);
    assert.match(f.status.textContent, /Cannot open search:.*Search unavailable/);
    assert.equal(f.window.document.querySelector('[role="search"]'), null);
    f.key('/');
    await settle();
    assert.equal(f.calls.filter(call => call === 'search').length, 2);
    assert.equal(f.window.document.querySelector('[role="search"]').hidden, false);
  });
}

test('ignores module loading failures delivered after page exit', async t => {
  const loading = Promise.withResolvers();
  const f = await setup(t, false, () => loading.promise);
  const previous = { hidden: f.status.hidden, text: f.status.textContent };
  f.key('/');
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  loading.reject(new Error('Search unavailable'));
  await settle();
  assert.equal(f.status.hidden, previous.hidden);
  assert.equal(f.status.textContent, previous.text);
  assert.equal(f.window.document.querySelector('[role="search"]'), null);
  assert.equal(f.registry.size, 0);
});

test('coalesces input into one search of the latest query per frame', async t => {
  const f = await setup(t);
  const { input, count } = await openFind(f, 'old old new new new');
  const createRange = t.mock.method(f.window.document, 'createRange');
  const set = t.mock.method(f.registry, 'set');
  const clears = [...f.registry.values()].map(highlight => t.mock.method(highlight, 'clear'));
  f.setMatchRect({ top: 900, bottom: 920, left: 100, right: 140, width: 40, height: 20 });
  queueFind(f, input, 'old');
  queueFind(f, input, 'ne');
  queueFind(f, input, 'new');
  assert.equal(f.frames.size, 1);
  assert.equal(createRange.mock.callCount(), 0);
  f.frame();
  assert.equal(count.textContent, '1/3');
  assert.deepEqual([...f.registry.get('mjp-search')].map(range => range.toString()), ['new', 'new', 'new']);
  assert.equal(createRange.mock.callCount(), 3);
  assert.equal(set.mock.callCount(), 0);
  for (const clear of clears) assert.equal(clear.mock.callCount(), 1);
  assert.equal(f.by.mock.callCount(), 1);
  assert.equal(f.frames.size, 0);
  f.frame();
  assert.equal(createRange.mock.callCount(), 3);
  assert.equal(f.by.mock.callCount(), 1);
  for (const clear of clears) assert.equal(clear.mock.callCount(), 1);
});

for (const shiftKey of [false, true]) {
  test(`flushes a queued search before ${shiftKey ? 'Shift+' : ''}Enter and confirms its origin match`, async t => {
    const f = await setup(t);
    const { panel, input } = await openFind(f, 'old old new new new');
    typeFind(f, input, 'old');
    const set = t.mock.method(f.registry, 'set');
    const clears = [...f.registry.values()].map(highlight => t.mock.method(highlight, 'clear'));
    f.setMatchRect({ top: 900, bottom: 920, left: 100, right: 140, width: 40, height: 20 });
    queueFind(f, input, 'new');
    f.key('Enter', { shiftKey }, input);
    assert.equal(panel.hidden, true);
    assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 8);
    assert.equal(f.registry.get('mjp-search').size, 3);
    assert.equal(f.window.document.activeElement, f.article);
    assert.equal(f.frames.size, 1);
    assert.equal(f.by.mock.callCount(), 1);
    assert.equal(set.mock.callCount(), 0);
    for (const clear of clears) assert.equal(clear.mock.callCount(), 1);
    f.frame();
    assert.equal(f.by.mock.callCount(), 1);
    assert.equal(set.mock.callCount(), 0);
    for (const clear of clears) assert.equal(clear.mock.callCount(), 1);
    assert.equal(f.window.document.querySelector('.search-count').textContent, '[1/3]');
  });
}

test('reopens with the confirmed query after Escape discards a queued edit without search scrolling', async t => {
  const f = await setup(t);
  const { panel, input, count } = await openFind(f, 'old old new new new');
  typeFind(f, input, 'old');
  f.key('Enter', {}, input);
  f.key('f', { metaKey: true });
  queueFind(f, input, 'new');
  f.key('Escape', {}, input);
  f.setMatchRect({ top: 900, bottom: 920, left: 100, right: 140, width: 40, height: 20 });
  f.key('f', { metaKey: true });
  assert.equal(panel.hidden, false);
  assert.equal(count.textContent, '1/2');
  assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 0);
  assert.equal(input.value, 'old');
  assert.equal(f.by.mock.callCount(), 0);
  assert.equal(f.frames.size, 0);
  f.frame();
  assert.equal(f.by.mock.callCount(), 0);
});

for (const fallback of [false, true]) {
  const display = fallback ? 'Selection' : 'CSS highlights';
  test(`cancels queued input effects on Escape with ${display}`, async t => {
    const f = await setup(t);
    if (fallback) f.window.CSS.highlights = undefined;
    const { panel, input } = await openFind(f, 'old old new new new');
    typeFind(f, input, 'old');
    f.setMatchRect({ top: 900, bottom: 920, left: 100, right: 140, width: 40, height: 20 });
    const set = t.mock.method(f.registry, 'set');
    queueFind(f, input, 'new');
    f.key('Escape', {}, input);
    assert.equal(f.frames.size, 0);
    f.frame();
    assert.equal(panel.hidden, true);
    assert.equal(input.value, '');
    assert.equal(f.by.mock.callCount(), 0);
    assert.equal(set.mock.callCount(), 0);
    assertNoSearchRanges(f.registry);
    assert.equal(f.window.getSelection().toString(), '');
  });

  for (const key of ['n', 'N']) {
    test(`uses the restored query for ${key} after canceling an edit with ${display}`, async t => {
      const f = await setup(t);
      if (fallback) f.window.CSS.highlights = undefined;
      const { panel, input } = await openFind(f, 'old old new new new');
      typeFind(f, input, 'old');
      f.key('Enter', {}, input);
      f.key('f', { metaKey: true });
      queueFind(f, input, 'new');
      f.key('Escape', {}, input);
      f.key(key);
      const range = fallback ? f.window.getSelection().getRangeAt(0) : [...f.registry.get('mjp-search-current')][0];
      assert.equal(range.toString(), 'old');
      assert.equal(range.startOffset, 4);
      assert.equal(panel.hidden, true);
      assert.equal(f.by.mock.callCount(), 0);
      f.frame();
      assert.equal(f.by.mock.callCount(), 0);
    });

    test(`keeps the restored query across hidden replacement before ${key} with ${display}`, async t => {
      const f = await setup(t);
      if (fallback) f.window.CSS.highlights = undefined;
      const { panel, input } = await openFind(f, 'old old new new new');
      typeFind(f, input, 'old');
      f.key('Enter', {}, input);
      f.key('f', { metaKey: true });
      queueFind(f, input, 'new');
      f.key('Escape', {}, input);
      f.key('Escape');
      f.setSnapshot(snapshot('new and old and old', 2));
      await f.changed();
      assertNoSearchRanges(f.registry);
      f.key(key);
      const range = fallback ? f.window.getSelection().getRangeAt(0) : [...f.registry.get('mjp-search-current')][0];
      assert.equal(range.toString(), 'old');
      assert.equal(range.startOffset, 16);
      assert.equal(range.startContainer, f.article.querySelector('p').firstChild);
      assert.equal(panel.hidden, true);
    });
  }

  test(`restores the confirmed query when an empty edit is canceled with ${display}`, async t => {
    const f = await setup(t);
    if (fallback) f.window.CSS.highlights = undefined;
    const { panel, input } = await openFind(f, 'old old new new new');
    typeFind(f, input, 'old');
    f.key('Enter', {}, input);
    f.key('f', { metaKey: true });
    queueFind(f, input, '');
    f.key('Escape', {}, input);
    f.key('n');
    f.frame();
    assert.equal(panel.hidden, true);
    const range = fallback ? f.window.getSelection().getRangeAt(0) : [...f.registry.get('mjp-search-current')][0];
    assert.equal(range.toString(), 'old');
    assert.equal(range.startOffset, 4);
    assert.equal(f.by.mock.callCount(), 0);
  });
}

test('absorbs a queued query into one replacement search without requesting scroll', async t => {
  const f = await setup(t);
  const { input, count } = await openFind(f, 'old old new new new');
  typeFind(f, input, 'old');
  const set = t.mock.method(f.registry, 'set');
  const clears = [...f.registry.values()].map(highlight => t.mock.method(highlight, 'clear'));
  const createRange = t.mock.method(f.window.document, 'createRange');
  queueFind(f, input, 'new');
  f.setMatchRect({ top: 900, bottom: 920, left: 100, right: 140, width: 40, height: 20 });
  f.setSnapshot(snapshot('new and old and new', 2));
  await f.changed();
  assert.equal(count.textContent, '1/2');
  assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 0);
  assert.equal(set.mock.callCount(), 0);
  for (const clear of clears) assert.equal(clear.mock.callCount(), 1);
  assert.equal(createRange.mock.callCount(), 2);
  assert.equal(f.by.mock.callCount(), 0);
  assert.equal(f.frames.size, 0);
  f.frame();
  assert.equal(set.mock.callCount(), 0);
  for (const clear of clears) assert.equal(clear.mock.callCount(), 1);
  assert.equal(createRange.mock.callCount(), 2);
  assert.equal(f.by.mock.callCount(), 0);
});

test('cancels queued search work and removes highlights on page exit', async t => {
  const f = await setup(t);
  const { input } = await openFind(f, 'old old new new new');
  typeFind(f, input, 'old');
  queueFind(f, input, 'new');
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  const set = t.mock.method(f.registry, 'set');
  f.frame();
  queueFind(f, input, 'old');
  f.key('n');
  assert.equal(f.frames.size, 0);
  assert.equal(set.mock.callCount(), 0);
  assert.equal(f.registry.size, 0);
  assert.equal(f.window.document.querySelector('[role="search"]'), null);
  assert.equal(f.by.mock.callCount(), 0);
});

function selectArticleText(f, start, end) {
  const node = f.article.querySelector('p').firstChild;
  const range = f.window.document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = f.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.getRangeAt(0);
}

for (const missing of ['CSS', 'highlights', 'Highlight']) {
  test(`fallback keeps selection while typing and selects the confirmed match without ${missing}`, async t => {
    const f = await setup(t);
    if (missing === 'highlights') f.window.CSS.highlights = undefined;
    else f.window[missing] = undefined;
    const { panel, input, count } = await openFind(f, 'keep one one one');
    const selection = f.window.getSelection();
    const userRange = selectArticleText(f, 0, 4);
    const addRange = t.mock.method(selection, 'addRange');
    const removeRanges = t.mock.method(selection, 'removeAllRanges');
    typeFind(f, input, 'one');
    assert.equal(count.textContent, '1/3');
    assert.equal(selection.getRangeAt(0), userRange);
    assert.equal(selection.toString(), 'keep');
    assert.equal(addRange.mock.callCount(), 0);
    assert.equal(removeRanges.mock.callCount(), 0);
    assert.equal(f.window.document.activeElement, input);
    assert.equal(f.registry.size, 0);

    assert.equal(f.key('c', { metaKey: true }, input).defaultPrevented, false);
    assert.equal(f.key('Enter', {}, input).defaultPrevented, true);
    assert.equal(panel.hidden, true);
    assert.equal(selection.toString(), 'one');
    assert.equal(selection.getRangeAt(0).startOffset, 5);
    assert.equal(f.window.document.activeElement, f.article);
    f.key('Escape');
    assert.equal(selection.rangeCount, 0);
    for (const [key, expectedOffset] of [['n', 9], ['N', 5]]) {
      assert.equal(f.key(key).defaultPrevented, true);
      assert.equal(selection.toString(), 'one');
      assert.equal(selection.getRangeAt(0).startOffset, expectedOffset);
      assert.equal(panel.hidden, true);
      assert.equal(f.window.document.activeElement, f.article);
    }
    assert.equal(f.key('c', { metaKey: true }).defaultPrevented, false);
    f.key('f', { metaKey: true });
    f.key('Escape', {}, input);
    f.key('Escape');
    assert.equal(f.calls.includes('close'), false);
    assert.equal(selection.rangeCount, 0);
    assert.equal(f.registry.size, 0);
  });
}

test('fallback preserves an existing user selection when search closes without navigation', async t => {
  const f = await setup(t);
  f.window.CSS.highlights = undefined;
  const { input } = await openFind(f, 'keep one one one');
  const range = selectArticleText(f, 0, 4);
  typeFind(f, input, 'one');
  f.key('Escape', {}, input);
  assert.equal(f.window.getSelection().getRangeAt(0), range);
  assert.equal(f.window.getSelection().toString(), 'keep');
});

for (const change of ['different range', 'same endpoints in a new range', 'changed endpoints in the same range']) {
  test(`fallback preserves the user's ${change} when search highlights are cleared`, async t => {
    const f = await setup(t);
    f.window.CSS.highlights = undefined;
    const { input } = await openFind(f, 'keep one one one');
    typeFind(f, input, 'one');
    f.key('Enter', {}, input);
    const selection = f.window.getSelection();
    assert.equal(selection.toString(), 'one');
    const original = selection.getRangeAt(0);
    let userRange;
    if (change === 'changed endpoints in the same range') {
      original.setStart(original.startContainer, 0);
      original.setEnd(original.endContainer, 4);
      userRange = original;
    } else {
      userRange = selectArticleText(f, change === 'different range' ? 0 : 5, change === 'different range' ? 4 : 8);
      assert.notEqual(userRange, original);
    }
    const text = selection.toString();
    f.key('Escape');
    assert.equal(selection.getRangeAt(0), userRange);
    assert.equal(selection.toString(), text);
  });
}

test('fallback keeps the confirmed match selected with focus in the document', async t => {
  const f = await setup(t);
  f.window.CSS.highlights = undefined;
  const { panel, input } = await openFind(f);
  typeFind(f, input, 'one');
  input.setSelectionRange(1, 1);
  const selection = f.window.getSelection();
  const addRange = selection.addRange;
  t.mock.method(selection, 'addRange', range => {
    addRange.call(selection, range);
    f.article.focus({ preventScroll: true });
  });
  const focus = t.mock.method(f.article, 'focus');
  f.key('Enter', {}, input);
  assert.equal(panel.hidden, true);
  assert.equal(selection.toString(), 'one');
  assert.equal(f.window.document.activeElement, f.article);
  assert.deepEqual(focus.mock.calls[0].arguments, [{ preventScroll: true }]);
  assert.equal(selection.getRangeAt(0).startOffset, 0);
  assert.equal(f.by.mock.callCount(), 0);
});

test('fallback keeps cached matches intact when the user adjusts the selected range in place', async t => {
  const f = await setup(t);
  f.window.CSS.highlights = undefined;
  const { input } = await openFind(f, 'keep one one one');
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  const selection = f.window.getSelection();
  const range = selection.getRangeAt(0);
  range.setStart(range.startContainer, 0);
  range.setEnd(range.endContainer, 4);
  f.key('Escape');
  assert.equal(selection.toString(), 'keep');
  f.key('n');
  assert.equal(selection.getRangeAt(0).startOffset, 9);
  f.key('N');
  assert.equal(selection.toString(), 'one');
  assert.equal(selection.getRangeAt(0).startOffset, 5);
});

test('fallback leaves the previous selection while typing and declining a zero-result confirmation', async t => {
  const f = await setup(t);
  f.window.CSS.highlights = undefined;
  const { panel, input, count } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  const selection = f.window.getSelection();
  assert.equal(selection.toString(), 'one');
  const previous = selection.getRangeAt(0);
  f.key('f', { metaKey: true });
  typeFind(f, input, 'missing');
  assert.equal(count.textContent, '0/0');
  assert.equal(selection.getRangeAt(0), previous);
  f.key('Enter', {}, input);
  assert.equal(panel.hidden, false);
  assert.equal(selection.getRangeAt(0), previous);
});

test('fallback leaves a user selection intact when a zero-result query is not confirmed', async t => {
  const f = await setup(t);
  f.window.CSS.highlights = undefined;
  const { input } = await openFind(f, 'keep one one one');
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  assert.equal(f.window.getSelection().toString(), 'one');
  f.key('f', { metaKey: true });
  typeFind(f, input, 'missing');
  const userRange = selectArticleText(f, 0, 4);
  f.key('Enter', {}, input);
  assert.equal(f.window.getSelection().getRangeAt(0), userRange);
  assert.equal(f.window.getSelection().toString(), 'keep');
});

test('fallback preserves backward user selection through opening and closing search', async t => {
  const f = await setup(t);
  f.window.CSS.highlights = undefined;
  const { input } = await openFind(f, 'keep one one one');
  const node = f.article.querySelector('p').firstChild;
  const selection = f.window.getSelection();
  selection.setBaseAndExtent(node, 4, node, 0);
  f.key('Escape', {}, input);
  f.key('f', { metaKey: true });
  assert.equal(selection.toString(), 'keep');
  assert.equal(selection.anchorNode, node);
  assert.equal(selection.anchorOffset, 4);
  assert.equal(selection.focusNode, node);
  assert.equal(selection.focusOffset, 0);
  assert.equal(f.window.document.activeElement, input);
});

for (const userSelected of [false, true]) {
  test(`fallback ${userSelected ? 'preserves user selection' : 'removes its own selection'} on page exit`, async t => {
    const f = await setup(t);
    f.window.CSS.highlights = undefined;
    const { input } = await openFind(f, 'keep one one one');
    typeFind(f, input, 'one');
    f.key('Enter', {}, input);
    const selection = f.window.getSelection();
    assert.equal(selection.toString(), 'one');
    const userRange = userSelected ? selectArticleText(f, 0, 4) : null;
    f.window.dispatchEvent(new f.window.Event('pagehide'));
    if (userSelected) {
      assert.equal(selection.getRangeAt(0), userRange);
      assert.equal(selection.toString(), 'keep');
    } else assert.equal(selection.rangeCount, 0);
    assert.equal(f.window.document.querySelector('[role="search"]'), null);
  });
}

test('CSS highlights leave user selection untouched through confirmation and clearing', async t => {
  const f = await setup(t);
  const { input } = await openFind(f, 'keep one one one');
  const range = selectArticleText(f, 0, 4);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 5);
  f.key('Escape');
  assert.equal(f.window.getSelection().getRangeAt(0), range);
  assert.equal(f.window.getSelection().toString(), 'keep');
});

test('starts the preview without initializing search', async t => {
  const f = await setup(t);
  assert.equal(f.calls.includes('search'), false);
  assert.equal(f.window.document.querySelector('[role="search"]'), null);
});

for (const key of ['/', 'f']) {
  test(`opens a transient search panel with ${key === 'f' ? 'Cmd+F' : key} without scrolling`, async t => {
    const f = await setup(t);
    const { panel, input, count } = await openFind(f, 'One one', key);
    assert.equal(panel.hidden, false);
    assert.equal(input.type, 'search');
    assert.ok(input.getAttribute('aria-label'));
    assert.equal(f.window.document.activeElement, input);
    assert.equal(count.textContent, '0/0');
    assert.equal(f.by.mock.callCount(), 0);
    assert.equal(f.to.mock.callCount(), 0);
    typeFind(f, input, 'ＯＮＥ');
    assert.equal(count.textContent, '1/2');
    input.setSelectionRange(1, 1);
    f.key('f', { metaKey: true }, input);
    assert.equal(input.selectionStart, 0);
    assert.equal(input.selectionEnd, 3);
    assert.equal(f.window.document.querySelectorAll('[role="search"]').length, 1);
  });
}

test('updates results on input and keeps zero-result queries editable until an empty query is closed', async t => {
  const f = await setup(t);
  const { panel, input, count } = await openFind(f, 'One one ONE');
  typeFind(f, input, 'one');
  assert.equal(count.textContent, '1/3');
  assert.deepEqual([...f.registry.get('mjp-search')].map(range => range.toString()), ['One', 'one', 'ONE']);
  typeFind(f, input, 'missing');
  assert.equal(count.textContent, '0/0');
  f.key('Enter', {}, input);
  assert.equal(count.textContent, '0/0');
  assert.equal(panel.hidden, false);
  assert.equal(f.window.document.activeElement, input);
  assertNoSearchRanges(f.registry);
  typeFind(f, input, 'one');
  assert.equal(count.textContent, '1/3');
  typeFind(f, input, '');
  assert.equal(count.textContent, '0/0');
  assertNoSearchRanges(f.registry);
  f.key('Enter', {}, input);
  assert.equal(panel.hidden, true);
});

test('leaves Enter and Shift+Enter available outside the search input without moving the match', async t => {
  const f = await setup(t);
  const { input, count } = await openFind(f, '```js\nconst one = "one";\n```\n\n[one](https://example.com)');
  typeFind(f, input, 'one');
  const current = f.registry.get('mjp-search-current');
  assert.equal(count.textContent, '1/3');
  f.setMatchRect({ top: 900, bottom: 920, left: 100, right: 140, width: 40, height: 20 });
  for (const target of [f.article.querySelector('button'), f.article.querySelector('a'), f.article]) {
    target.focus();
    for (const options of [{}, { shiftKey: true }]) {
      assert.equal(f.key('Enter', options, target).defaultPrevented, false);
      assert.equal(count.textContent, '1/3');
      assert.equal(f.registry.get('mjp-search-current'), current);
      assert.equal(f.window.document.activeElement, target);
      assert.equal(f.by.mock.callCount(), 0);
    }
  }
});

test('keeps reading and search shortcuts available for typing inside the search input', async t => {
  const f = await setup(t);
  const { input } = await openFind(f);
  for (const key of ['j', 'k', 'q', '/', 'n', 'N', 'g', 'G']) {
    assert.equal(f.key(key, {}, input).defaultPrevented, false);
  }
  assert.equal(f.calls.includes('close'), false);
  assert.equal(f.by.mock.callCount(), 0);
  assert.equal(f.to.mock.callCount(), 0);
});

test('leaves Enter and Escape to IME composition while search is open', async t => {
  const f = await setup(t);
  const { panel, input, count } = await openFind(f);
  typeFind(f, input, 'one');
  for (const key of ['Enter', 'Escape']) {
    assert.equal(f.key(key, { isComposing: true }, input).defaultPrevented, false);
    assert.equal(count.textContent, '1/3');
    assert.equal(panel.hidden, false);
    assert.equal(f.window.document.activeElement, input);
    assert.equal(f.calls.includes('close'), false);
  }
});

test('cancels search on Escape and restores the opening scroll before returning focus', async t => {
  const f = await setup(t);
  const { panel, input } = await openFind(f);
  typeFind(f, input, 'one');
  f.by.mock.resetCalls();
  const focus = t.mock.method(f.article, 'focus');
  assert.equal(f.key('Escape', {}, input).defaultPrevented, true);
  assert.equal(panel.hidden, true);
  assert.equal(input.value, '');
  assertNoSearchRanges(f.registry);
  assert.equal(f.calls.includes('close'), false);
  assert.deepEqual(focus.mock.calls[0].arguments, [{ preventScroll: true }]);
  assert.equal(f.window.document.activeElement, f.article);
  assert.equal(f.by.mock.callCount(), 0);
  assert.deepEqual(f.to.mock.calls.map(call => call.arguments), [[0, 0]]);
  assert.equal(f.key('j').defaultPrevented, true);
  assert.equal(f.by.mock.callCount(), 1);
  assert.equal(f.key('Escape').defaultPrevented, true);
  assert.equal(f.calls.filter(call => call === 'close').length, 1);
});

test('resumes n and N from the confirmed match and reselects on reopening', async t => {
  const f = await setup(t);
  const { panel, input } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  f.key('Escape');
  for (const [key, offset] of [['n', 4], ['n', 8], ['N', 4]]) {
    assert.equal(f.key(key).defaultPrevented, true);
    const [current] = f.registry.get('mjp-search-current');
    assert.equal(current.startOffset, offset);
    assert.equal(panel.hidden, true);
    assert.equal(f.window.document.activeElement, f.article);
  }
  f.key('f', { metaKey: true });
  assert.equal(panel.hidden, false);
  assert.equal(input.value, 'one');
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, 3);
  assert.equal(panel.querySelector('[aria-live]').textContent, '1/3');
});

test('n and N do nothing without a search query and never initialize search', async t => {
  const f = await setup(t);
  f.key('n');
  f.key('N');
  assert.equal(f.calls.includes('search'), false);
  const { panel, input } = await openFind(f);
  f.key('Escape', {}, input);
  f.key('n');
  f.key('N');
  assert.equal(panel.hidden, true);
  assertNoSearchRanges(f.registry);
  assert.equal(f.by.mock.callCount(), 0);
});

test('Cmd+W still closes the window while search is open', async t => {
  const f = await setup(t);
  const { input } = await openFind(f);
  assert.equal(f.key('w', { metaKey: true }, input).defaultPrevented, true);
  assert.equal(f.calls.filter(call => call === 'close').length, 1);
});

for (const [key, options] of [['Escape', {}], ['w', { metaKey: true }], ['W', { metaKey: true }]]) {
  for (const state of key === 'Escape' ? ['uninitialized', 'closed'] : ['uninitialized', 'closed', 'open']) {
    test(`closes the window with handled ${options.metaKey ? 'Cmd+' : ''}${key} when search is ${state}`, async t => {
      const f = await setup(t);
      let target = f.article;
      if (state !== 'uninitialized') {
        const { input } = await openFind(f);
        if (state === 'closed') f.key('Escape', {}, input);
        else target = input;
      }
      target.addEventListener('keydown', event => event.preventDefault(), { once: true });
      assert.equal(f.key(key, options, target).defaultPrevented, true);
      assert.equal(f.calls.filter(call => call === 'close').length, 1);
    });
  }
}

test('can open search from a copy button and returns focus to the article on Escape', async t => {
  const f = await setup(t);
  f.setSnapshot(snapshot('```js\none\n```', 1));
  await f.changed();
  const button = f.article.querySelector('button');
  button.focus();
  f.key('f', { metaKey: true }, button);
  await new Promise(resolve => setImmediate(resolve));
  const input = f.window.document.querySelector('input[type="search"]');
  assert.ok(input);
  f.key('Escape', {}, input);
  assert.equal(f.window.document.activeElement, f.article);
  assert.equal(f.key('j').defaultPrevented, true);
});

for (const [count, thirdPosition] of [[999, '3/999'], [1000, '3/1000'], [1001, '3/1000+']]) {
  test(`shows the 1000-match limit accurately and cycles within stored matches at ${count} matches`, async t => {
    const f = await setup(t);
    const { panel, input, count: display } = await openFind(f, 'a'.repeat(count));
    typeFind(f, input, 'a');
    const total = Math.min(count, 1000);
    const suffix = count > total ? '+' : '';
    assert.equal(display.textContent, `1/${total}${suffix}`);
    assert.equal(f.registry.get('mjp-search').size, total);
    f.key('Enter', { shiftKey: true }, input);
    assert.equal(panel.hidden, true);
    f.key('N');
    assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, total - 1);
    f.key('n');
    assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 0);
    f.key('n');
    f.key('n');
    assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 2);
    f.window.scrollY = 40;
    f.setMatchRect(range => {
      const top = range.startOffset * 20 - f.window.scrollY;
      return { top, bottom: top + 20, left: 100, right: 140, width: 40, height: 20 };
    });
    f.key('f', { metaKey: true });
    assert.equal(display.textContent, thirdPosition);
  });
}

test('refreshes shown results after replacement, retaining an in-range index without search scrolling', async t => {
  const f = await setup(t);
  const { panel, input } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  f.key('n');
  f.setMatchRect({ top: 900, bottom: 920, left: 100, right: 140, width: 40, height: 20 });
  f.by.mock.resetCalls();
  f.setSnapshot(snapshot('one two one', 2));
  await f.changed();
  assert.equal(panel.hidden, true);
  assert.equal(f.registry.get('mjp-search').size, 2);
  assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 8);
  assert.equal([...f.registry.get('mjp-search-current')][0].startContainer, f.article.querySelector('p').firstChild);
  assert.equal(f.by.mock.callCount(), 0);
  f.setSnapshot(snapshot('one', 3));
  await f.changed();
  assert.equal(f.registry.get('mjp-search').size, 1);
  assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 0);
  assert.equal(f.by.mock.callCount(), 0);
});

test('rebuilds hidden results on navigation after replacement without reopening the panel', async t => {
  const f = await setup(t);
  const { panel, input } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  f.key('Escape');
  f.setSnapshot(snapshot('one and one', 2));
  await f.changed();
  assertNoSearchRanges(f.registry);
  f.key('n');
  assert.equal(panel.hidden, true);
  assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 8);
  f.setSnapshot(snapshot('one plus one plus one', 3));
  await f.changed();
  assert.equal(panel.hidden, true);
  assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 9);
});

test('keeps search ranges on status-only updates and ignores older document revisions', async t => {
  const f = await setup(t);
  const { panel, input } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  f.key('n');
  const all = f.registry.get('mjp-search');
  const current = f.registry.get('mjp-search-current');
  f.setSnapshot(snapshot('one one one', 2, 'Cannot read file'));
  await f.changed();
  assert.equal(f.status.textContent, 'Cannot read file');
  assert.equal(f.registry.get('mjp-search'), all);
  assert.equal(f.registry.get('mjp-search-current'), current);
  f.setSnapshot(snapshot('old', 1));
  await f.changed();
  assert.equal(f.registry.get('mjp-search'), all);
  assert.equal(f.registry.get('mjp-search-current'), current);
  assert.equal(panel.hidden, true);
  assert.equal([...current][0].startOffset, 4);
});

test('searches rendered text across Markdown and plain-text replacements', async t => {
  const f = await setup(t);
  const { input, count } = await openFind(f, '**one**');
  typeFind(f, input, '**');
  assert.equal(count.textContent, '0/0');
  f.setSnapshot(snapshot('**one**'.padEnd(128 * 1024 + 1, ' '), 2));
  await f.changed();
  assert.equal(count.textContent, '1/2');
  f.setSnapshot(snapshot('**one**', 3));
  await f.changed();
  assert.equal(count.textContent, '0/0');
});

test('closes an emptied queued query synchronously on Enter and clears stale marks', async t => {
  const f = await setup(t);
  const { panel, input } = await openFind(f);
  typeFind(f, input, 'one');
  input.value = '';
  input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  f.key('Enter', {}, input);
  assert.equal(panel.hidden, true);
  assertNoSearchRanges(f.registry);
  assert.equal(f.frames.size, 0);
});

test('recovers the first result after a replacement changes zero matches to some matches', async t => {
  const f = await setup(t);
  const { input, count } = await openFind(f, 'other');
  typeFind(f, input, 'one');
  assert.equal(count.textContent, '0/0');
  f.setSnapshot(snapshot('one one', 2));
  await f.changed();
  assert.equal(count.textContent, '1/2');
});

for (const [top, expectedScroll] of [[100, 0], [-20, -410], [900, 510]]) {
  test(`scrolls only when the current match is outside the viewport at y=${top}`, async t => {
    const f = await setup(t);
    const { input } = await openFind(f);
    Object.defineProperty(f.window, 'innerHeight', { value: 800 });
    f.setMatchRect({ top, bottom: top + 20, left: 100, right: 140, width: 40, height: 20 });
    typeFind(f, input, 'one');
    assert.deepEqual(f.by.mock.calls.map(call => call.arguments), expectedScroll ? [[0, expectedScroll]] : []);
    assert.equal(f.to.mock.callCount(), 0);
    f.key('Enter', {}, input);
    assert.equal(f.by.mock.callCount(), expectedScroll ? 2 : 0);
    f.key('Escape');
    f.key('n');
    assert.equal(f.by.mock.callCount(), expectedScroll ? 3 : 0);
  });
}

for (const obstacle of ['status', 'search panel']) {
  test(`reveals a match obscured by the ${obstacle}`, async t => {
    const f = await setup(t);
    const { input, panel } = await openFind(f);
    Object.defineProperty(f.window, 'innerHeight', { value: 800 });
    const overlay = obstacle === 'status' ? f.status : panel;
    overlay.hidden = false;
    overlay.getBoundingClientRect = () => ({ top: 0, bottom: 60, left: 0, right: 800, width: 800, height: 60 });
    f.setMatchRect({ top: 20, bottom: 40, left: 100, right: 140, width: 40, height: 20 });
    typeFind(f, input, 'one');
    assert.deepEqual(f.by.mock.calls.map(call => call.arguments), [[0, -400]]);
  });
}

test('does not scroll a visible match beside the search panel or beneath a hidden banner', async t => {
  const f = await setup(t);
  const { input, panel } = await openFind(f);
  panel.getBoundingClientRect = () => ({ top: 12, bottom: 60, left: 600, right: 800, width: 200, height: 48 });
  f.status.hidden = true;
  f.status.getBoundingClientRect = () => ({ top: 0, bottom: 60, left: 0, right: 800, width: 800, height: 60 });
  f.setMatchRect({ top: 20, bottom: 40, left: 100, right: 140, width: 40, height: 20 });
  typeFind(f, input, 'one');
  assert.equal(f.by.mock.callCount(), 0);
});

for (const [kind, text, selector] of [
  ['code block', '```\none\n```', 'pre'],
  ['table', '|one|\n|---|\n|value|', 'table'],
]) {
  for (const [contentLeft, initialScroll, expectedScroll] of [[180, 0, 100], [120, 100, 40]]) {
    test(`reveals a horizontally clipped match inside a ${kind} from scrollLeft=${initialScroll}`, async t => {
      const f = await setup(t);
      const { input } = await openFind(f, text);
      const scroller = f.article.querySelector(selector);
      scroller.style.overflowX = 'auto';
      scroller.getBoundingClientRect = () => ({ top: 80, bottom: 140, left: 50, right: 150, width: 100, height: 60 });
      Object.defineProperty(scroller, 'clientWidth', { value: 100 });
      scroller.scrollLeft = initialScroll;
      f.setMatchRect(() => {
        const left = contentLeft - scroller.scrollLeft;
        return { top: 100, bottom: 120, left, right: left + 40, width: 40, height: 20 };
      });
      typeFind(f, input, 'one');
      assert.equal(scroller.scrollLeft, expectedScroll);
      assert.equal(f.by.mock.callCount(), 0);
      f.key('Enter', {}, input);
      assert.equal(scroller.scrollLeft, expectedScroll);
    });
  }
}

for (const outcome of ['success', 'failure']) {
  test(`keeps the latest display when an older read finishes with ${outcome}`, async t => {
    const f = await setup(t, true);
    const newest = f.changed();
    f.pending[1].resolve(snapshot('# Current', 1));
    await newest;
    if (outcome === 'success') f.pending[0].resolve(snapshot('# Old'));
    else f.pending[0].reject(new Error('Old read failed'));
    await f.boot;
    assert.equal(f.article.querySelector('h1').textContent, 'Current');
    assert.equal(f.status.hidden, true);
    assert.equal(f.status.textContent, '');
  });
}

test('keeps the latest read error when an older success arrives and clears it on recovery', async t => {
  const f = await setup(t, true);
  const latest = f.changed();
  f.pending[1].reject(new Error('Current read failed'));
  await latest;
  f.pending[0].resolve(snapshot('# Old'));
  await f.boot;
  assert.equal(f.article.textContent, '');
  assert.match(f.status.textContent, /Current read failed/);
  const recovery = f.changed();
  f.pending[2].resolve(snapshot('# Restored', 2));
  await recovery;
  assert.equal(f.article.querySelector('h1').textContent, 'Restored');
  assert.equal(f.status.hidden, true);
});

for (const [key, options] of [['Escape', {}], ['w', { metaKey: true }], ['W', { metaKey: true }], ['q', {}]]) {
  test(`requests closing with ${options.metaKey ? 'Cmd+' : ''}${key}`, async t => {
    const f = await setup(t);
    assert.equal(f.key(key, options).defaultPrevented, true);
    assert.equal(f.calls.filter(call => call === 'close').length, 1);
  });
}

for (const [key, options, distance] of [
  ['j', {}, 30], ['k', {}, -30], ['d', { ctrlKey: true }, 400], ['u', { ctrlKey: true }, -400],
]) {
  test(`scrolls by the expected distance with ${options.ctrlKey ? 'Ctrl+' : ''}${key}`, async t => {
    const f = await setup(t);
    f.article.style.lineHeight = '30px';
    Object.defineProperty(f.window, 'innerHeight', { value: 800 });
    assert.equal(f.key(key, options).defaultPrevented, true);
    assert.deepEqual(f.by.mock.calls.map(call => call.arguments), [[0, distance]]);
  });
}

test('scrolls to the end with G and to the beginning with two timely g presses', async t => {
  const f = await setup(t);
  Object.defineProperty(f.window.document.documentElement, 'scrollHeight', { value: 2500 });
  let now = 100;
  t.mock.method(f.window.performance, 'now', () => now);
  assert.equal(f.key('G').defaultPrevented, true);
  assert.equal(f.key('g').defaultPrevented, false);
  now += 999;
  assert.equal(f.key('g').defaultPrevented, true);
  assert.deepEqual(f.to.mock.calls.map(call => call.arguments), [[0, 2500], [0, 0]]);
});

for (const interruption of ['timeout', 'repeat', 'other key', 'modifier', 'input', 'handled key']) {
  test(`does not complete gg after ${interruption}`, async t => {
    const f = await setup(t);
    let now = 100;
    t.mock.method(f.window.performance, 'now', () => now);
    f.key('g');
    if (interruption === 'timeout') now += 1000;
    if (interruption === 'repeat') f.key('g', { repeat: true });
    if (interruption === 'other key') f.key('x');
    if (interruption === 'modifier') f.key('g', { metaKey: true });
    if (interruption === 'handled key') {
      f.article.addEventListener('keydown', event => event.preventDefault(), { once: true });
      f.key('/');
    }
    if (interruption === 'input') {
      const input = f.window.document.createElement('input');
      f.article.append(input);
      f.key('g', {}, input);
    }
    assert.equal(f.key('g').defaultPrevented, false);
    assert.equal(f.to.mock.callCount(), 0);
  });
}

for (const markup of ['<input>', '<textarea></textarea>', '<button></button>', '<select></select>',
  '<div contenteditable><span></span></div>', '<div role="textbox"><span></span></div>']) {
  test(`leaves reading keys available inside ${markup}`, async t => {
    const f = await setup(t);
    f.article.innerHTML = markup;
    const target = f.article.querySelector('span') ?? f.article.firstElementChild;
    for (const key of ['q', 'j', 'k', 'g', 'G', 'd', 'u']) {
      assert.equal(f.key(key, { ctrlKey: ['d', 'u'].includes(key) }, target).defaultPrevented, false);
    }
    assert.equal(f.by.mock.callCount(), 0);
    assert.equal(f.to.mock.callCount(), 0);
    assert.equal(f.calls.includes('close'), false);
    assert.equal(f.key('Escape', {}, target).defaultPrevented, true);
    assert.equal(f.calls.includes('close'), true);
  });
}

for (const options of [{ isComposing: true }, { metaKey: true }, { altKey: true }, { ctrlKey: true }, { ctrlKey: true, shiftKey: true }]) {
  test(`leaves modified reading keys available: ${JSON.stringify(options)}`, async t => {
    const f = await setup(t);
    assert.equal(f.key('q', options).defaultPrevented, false);
    assert.equal(f.key('j', options).defaultPrevented, false);
    assert.equal(f.by.mock.callCount(), 0);
    assert.equal(f.calls.includes('close'), false);
  });
}

test('respects a key event already handled by another listener', async t => {
  const f = await setup(t);
  f.article.addEventListener('keydown', event => event.preventDefault());
  f.key('q');
  f.key('j');
  assert.equal(f.calls.includes('close'), false);
  assert.equal(f.by.mock.callCount(), 0);
});

for (const options of [{}, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
  test(`opens nested link content in the default app with ${JSON.stringify(options)}`, async t => {
    const f = await setup(t);
    f.setSnapshot(snapshot('[**link**](https://example.com/path)', 1));
    await f.changed();
    const event = new f.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options });
    f.article.querySelector('strong').dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(f.calls.filter(Array.isArray), [['open', 'https://example.com/path']]);
  });
}

for (const href of ['http://example.com', 'mailto:reader@example.com', './other.md', '#section',
  'javascript:example()', 'data:text/plain,example', 'file:///tmp/example.md', 'ftp://example.com', '']) {
  test(`applies the external link policy to ${href || 'an empty link'}`, async t => {
    const f = await setup(t);
    const anchor = f.window.document.createElement('a');
    anchor.setAttribute('href', href);
    f.article.append(anchor);
    const event = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    const expected = /^(http:|mailto:)/.test(href) ? [['open', new URL(href).href]] : [];
    assert.deepEqual(f.calls.filter(Array.isArray), expected);
  });
}

test('leaves ordinary nonlink clicks available', async t => {
  const f = await setup(t);
  const event = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
  f.article.querySelector('h1').dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(f.calls.filter(Array.isArray), []);
});

test('connects code copying to the bridge and leaves button keys available', async t => {
  const f = await setup(t);
  f.setSnapshot(snapshot('```js\nconst answer = 42;\n```', 1));
  await f.changed();
  const button = f.article.querySelector('button');
  button.focus();
  for (const key of ['Tab', 'Enter', ' ', 'j', 'k', 'q']) {
    assert.equal(f.key(key, {}, button).defaultPrevented, false);
  }
  assert.equal(f.calls.includes('close'), false);
  assert.equal(f.by.mock.callCount(), 0);
  button.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.filter(Array.isArray), [['copy', 'const answer = 42;\n']]);
  assert.equal(f.article.querySelector('[role="status"]').textContent, 'Copied');
  assert.equal(f.window.document.activeElement, button);
  assert.equal(f.key('Escape', {}, button).defaultPrevented, true);
  assert.equal(f.calls.includes('close'), true);
});
