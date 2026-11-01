import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as searchModule from '../src/search.ts';

globalThis.window = new JSDOM().window;
const { startPreview } = await import('../src/preview.ts');
const snapshot = (text, revision = 0, error = null) => ({ text, revision, error, warning: null });

async function setup(t, deferred = false) {
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
  window.Range.prototype.getBoundingClientRect = () => typeof matchRect === 'function' ? matchRect() : matchRect;
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
    loadSearch: async () => { calls.push('search'); return searchModule; },
  });
  await new Promise(resolve => setImmediate(resolve));
  if (!deferred) await boot;
  to.mock.resetCalls();
  const key = (key, options = {}, target = article) => {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
  };
  return { window, article, status, calls, pending, boot, by, to, key, registry, frames,
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

function typeFind(f, input, value) {
  input.value = value;
  input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  f.frame();
}

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
  test(`fallback keeps selection while typing and selects only navigated matches without ${missing}`, async t => {
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

    for (const [options, expectedOffset, expectedCount] of [[{}, 9, '2/3'], [{ shiftKey: true }, 5, '1/3']]) {
      assert.equal(f.key('Enter', options, input).defaultPrevented, true);
      assert.equal(count.textContent, expectedCount);
      assert.equal(selection.toString(), 'one');
      assert.equal(selection.getRangeAt(0).startOffset, expectedOffset);
      assert.equal(f.window.document.activeElement, input);
    }
    assert.equal(f.key('c', { metaKey: true }, input).defaultPrevented, false);
    f.key('Escape', {}, input);
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
  test(`fallback preserves the user's ${change} when search closes`, async t => {
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
      userRange = selectArticleText(f, change === 'different range' ? 0 : 9, change === 'different range' ? 4 : 12);
      assert.notEqual(userRange, original);
    }
    const text = selection.toString();
    f.key('Escape', {}, input);
    assert.equal(selection.getRangeAt(0), userRange);
    assert.equal(selection.toString(), text);
  });
}

test('fallback restores the search input focus if selecting a match moves focus to the document', async t => {
  const f = await setup(t);
  f.window.CSS.highlights = undefined;
  const { input, count } = await openFind(f);
  typeFind(f, input, 'one');
  input.setSelectionRange(1, 1);
  const selection = f.window.getSelection();
  const addRange = selection.addRange;
  t.mock.method(selection, 'addRange', range => {
    addRange.call(selection, range);
    f.article.focus({ preventScroll: true });
  });
  const focus = t.mock.method(input, 'focus');
  f.key('Enter', {}, input);
  assert.equal(count.textContent, '2/3');
  assert.equal(selection.toString(), 'one');
  assert.equal(f.window.document.activeElement, input);
  assert.deepEqual(focus.mock.calls[0].arguments, [{ preventScroll: true }]);
  assert.equal(input.selectionStart, 1);
  assert.equal(input.selectionEnd, 1);
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
  f.key('Escape', {}, input);
  assert.equal(selection.toString(), 'keep');
  f.key('n');
  assert.equal(selection.getRangeAt(0).startOffset, 13);
  f.key('N');
  assert.equal(selection.toString(), 'one');
  assert.equal(selection.getRangeAt(0).startOffset, 9);
});

test('fallback leaves the previous selection while typing and clears its own selection on a zero-result move', async t => {
  const f = await setup(t);
  f.window.CSS.highlights = undefined;
  const { input, count } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  const selection = f.window.getSelection();
  assert.equal(selection.toString(), 'one');
  const previous = selection.getRangeAt(0);
  typeFind(f, input, 'missing');
  assert.equal(count.textContent, '0/0');
  assert.equal(selection.getRangeAt(0), previous);
  f.key('Enter', {}, input);
  assert.equal(selection.rangeCount, 0);
});

test('fallback leaves a user selection intact on a zero-result move', async t => {
  const f = await setup(t);
  f.window.CSS.highlights = undefined;
  const { input } = await openFind(f, 'keep one one one');
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  assert.equal(f.window.getSelection().toString(), 'one');
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

test('CSS highlights leave user selection untouched through navigation and closure', async t => {
  const f = await setup(t);
  const { input } = await openFind(f, 'keep one one one');
  const range = selectArticleText(f, 0, 4);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  assert.equal([...f.registry.get('mjp-search-current')][0].startOffset, 9);
  f.key('Escape', {}, input);
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

test('updates results on input and cycles with Enter and Shift+Enter', async t => {
  const f = await setup(t);
  const { input, count } = await openFind(f, 'One one ONE');
  typeFind(f, input, 'one');
  assert.equal(count.textContent, '1/3');
  assert.deepEqual([...f.registry.get('mjp-search')].map(range => range.toString()), ['One', 'one', 'ONE']);
  for (const [options, expected] of [[{}, '2/3'], [{}, '3/3'], [{}, '1/3'], [{ shiftKey: true }, '3/3']]) {
    assert.equal(f.key('Enter', options, input).defaultPrevented, true);
    assert.equal(count.textContent, expected);
    assert.equal(f.window.document.activeElement, input);
  }
  typeFind(f, input, 'missing');
  assert.equal(count.textContent, '0/0');
  f.key('Enter', {}, input);
  assert.equal(count.textContent, '0/0');
  assert.equal(f.registry.has('mjp-search-current'), false);
  typeFind(f, input, 'one');
  assert.equal(count.textContent, '1/3');
  typeFind(f, input, '');
  assert.equal(count.textContent, '0/0');
  assert.equal(f.registry.has('mjp-search'), false);
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

test('closes only search on Escape and returns focus without moving the document', async t => {
  const f = await setup(t);
  const { panel, input } = await openFind(f);
  typeFind(f, input, 'one');
  f.by.mock.resetCalls();
  const focus = t.mock.method(f.article, 'focus');
  assert.equal(f.key('Escape', {}, input).defaultPrevented, true);
  assert.equal(panel.hidden, true);
  assert.equal(f.registry.has('mjp-search'), false);
  assert.equal(f.registry.has('mjp-search-current'), false);
  assert.equal(f.calls.includes('close'), false);
  assert.deepEqual(focus.mock.calls[0].arguments, [{ preventScroll: true }]);
  assert.equal(f.window.document.activeElement, f.article);
  assert.equal(f.by.mock.callCount(), 0);
  assert.equal(f.to.mock.callCount(), 0);
  assert.equal(f.key('j').defaultPrevented, true);
  assert.equal(f.by.mock.callCount(), 1);
  assert.equal(f.key('Escape').defaultPrevented, true);
  assert.equal(f.calls.filter(call => call === 'close').length, 1);
});

test('resumes n and N from the last match while keeping the search panel hidden', async t => {
  const f = await setup(t);
  const { panel, input } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  f.key('Escape', {}, input);
  for (const [key, offset] of [['n', 8], ['n', 0], ['N', 8]]) {
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
  assert.equal(panel.querySelector('[aria-live]').textContent, '3/3');
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
  assert.equal(f.registry.size, 0);
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

for (const count of [searchModule.MAX_MATCHES - 1, searchModule.MAX_MATCHES, searchModule.MAX_MATCHES + 1]) {
  test(`shows the provisional limit accurately and cycles within stored matches at ${count} matches`, async t => {
    const f = await setup(t);
    const { input, count: display } = await openFind(f, 'a'.repeat(count));
    typeFind(f, input, 'a');
    const total = Math.min(count, searchModule.MAX_MATCHES);
    const suffix = count > total ? '+' : '';
    assert.equal(display.textContent, `1/${total}${suffix}`);
    assert.equal(f.registry.get('mjp-search').size, total);
    f.key('Enter', { shiftKey: true }, input);
    assert.equal(display.textContent, `${total}/${total}${suffix}`);
    f.key('Enter', {}, input);
    assert.equal(display.textContent, `1/${total}${suffix}`);
  });
}

test('refreshes shown results after replacement, retaining an in-range index without search scrolling', async t => {
  const f = await setup(t);
  const { input, count } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
  f.setMatchRect({ top: 900, bottom: 920, left: 100, right: 140, width: 40, height: 20 });
  f.by.mock.resetCalls();
  f.setSnapshot(snapshot('one two one', 2));
  await f.changed();
  assert.equal(count.textContent, '2/2');
  assert.equal([...f.registry.get('mjp-search-current')][0].startContainer, f.article.querySelector('p').firstChild);
  assert.equal(f.by.mock.callCount(), 0);
  f.setSnapshot(snapshot('one', 3));
  await f.changed();
  assert.equal(count.textContent, '1/1');
  assert.equal(f.by.mock.callCount(), 0);
});

test('rebuilds hidden results on navigation after replacement without reopening the panel', async t => {
  const f = await setup(t);
  const { panel, input } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Escape', {}, input);
  f.setSnapshot(snapshot('one and one', 2));
  await f.changed();
  assert.equal(f.registry.size, 0);
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
  const { input, count } = await openFind(f);
  typeFind(f, input, 'one');
  f.key('Enter', {}, input);
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
  assert.equal(count.textContent, '2/3');
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

test('clears stale results synchronously on Enter after the query is emptied', async t => {
  const f = await setup(t);
  const { input, count } = await openFind(f);
  typeFind(f, input, 'one');
  input.value = '';
  input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  f.key('Enter', {}, input);
  assert.equal(count.textContent, '0/0');
  assert.equal(f.registry.size, 0);
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
    f.key('Escape', {}, input);
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
