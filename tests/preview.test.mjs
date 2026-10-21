import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

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
  });
  await new Promise(resolve => setImmediate(resolve));
  if (!deferred) await boot;
  to.mock.resetCalls();
  const key = (key, options = {}, target = article) => {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
  };
  return { window, article, status, calls, pending, boot, by, to, key,
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

for (const interruption of ['timeout', 'repeat', 'other key', 'modifier', 'input']) {
  test(`does not complete gg after ${interruption}`, async t => {
    const f = await setup(t);
    let now = 100;
    t.mock.method(f.window.performance, 'now', () => now);
    f.key('g');
    if (interruption === 'timeout') now += 1000;
    if (interruption === 'repeat') f.key('g', { repeat: true });
    if (interruption === 'other key') f.key('x');
    if (interruption === 'modifier') f.key('g', { metaKey: true });
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
