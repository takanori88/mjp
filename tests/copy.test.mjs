import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

globalThis.window = new JSDOM().window;
const { createDocumentRenderer, MAX_MARKDOWN_BYTES } = await import('../src/render.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(t, writeText = async () => {}) {
  const { window } = new JSDOM('<article></article><aside></aside>');
  t.after(() => window.close());
  window.scrollTo = () => {};
  const article = window.document.querySelector('article');
  const status = window.document.querySelector('aside');
  const render = createDocumentRenderer(article, status, undefined, undefined, writeText);
  let revision = 0;
  return { window, article, status,
    render: (text, error = null) => render({ text, error, warning: null, revision: revision++ }),
  };
}

test('offers copying for fences with any language while keeping other code unchanged', t => {
  const f = setup(t);
  f.render([
    '```js', 'const answer = 42;', '```', '',
    '~~~', 'plain', '~~~', '',
    '```unknown-language', 'unknown', '```', '',
    '```', '```', '',
    '> ```python', '> print("nested")', '> ```', '',
    '    indented', '', '`inline`', '',
    '<button data-mjp-fence>author text</button>',
  ].join('\n'));
  assert.equal(f.article.querySelectorAll('button').length, 5);
  assert.ok(f.article.querySelector('code.language-js.hljs span.hljs-keyword'));
  assert.ok(f.article.querySelector('blockquote .code-block'));
  assert.equal(f.article.querySelector('code.language-unknown-language').children.length, 0);
  assert.equal(f.article.querySelector('article > pre code').textContent, 'indented\n');
  assert.equal(f.article.querySelector('p code').textContent, 'inline');
  assert.equal(f.article.querySelector('pre button, code button'), null);
  const buttons = [...f.article.querySelectorAll('button')];
  assert.deepEqual(buttons.map(button => button.getAttribute('aria-label')),
    [1, 2, 3, 4, 5].map(index => `Copy code block ${index}`));
  for (const button of buttons) {
    assert.equal(button.type, 'button');
    assert.equal(button.tabIndex, 0);
    assert.equal(button.textContent, '');
    assert.equal(button.querySelector('svg').getAttribute('aria-hidden'), 'true');
    const tooltip = f.window.document.getElementById(button.getAttribute('aria-describedby'));
    assert.equal(tooltip.getAttribute('role'), 'tooltip');
    assert.equal(tooltip.textContent, 'Copy code to clipboard');
  }
});

test('copies only the selected code text including whitespace and highlighted characters', async t => {
  const copied = [];
  const f = setup(t, async text => { copied.push(text); });
  const first = '\tconst 日本語 = "<>&";  \n\n';
  const second = '  second block\n';
  f.render('```js\n' + first + '```\n\n~~~unknown\n' + second + '~~~\n\n```\n```');
  assert.deepEqual(copied, []);
  const buttons = f.article.querySelectorAll('button');
  for (const index of [1, 0, 2]) {
    buttons[index].click();
    await tick();
  }
  assert.deepEqual(copied, [second, first, '']);
  assert.deepEqual([...f.article.querySelectorAll('[role="status"]')].map(node => node.textContent),
    ['Copied', 'Copied', 'Copied']);
  assert.equal(f.status.hidden, true);
});

test('reports copy failures separately from file errors and supports retry without losing focus', async t => {
  let attempts = 0;
  const f = setup(t, () => {
    if (++attempts === 1) throw new Error('Clipboard unavailable');
    if (attempts === 2) return Promise.reject(new Error('Permission denied'));
    return Promise.resolve();
  });
  f.render('```\nexample\n```', 'Cannot read file');
  const button = f.article.querySelector('button');
  const feedback = f.article.querySelector('[role="status"]');
  assert.equal(feedback.getAttribute('aria-live'), 'polite');
  assert.equal(feedback.getAttribute('aria-atomic'), 'true');
  button.focus();
  for (const expected of ['Copy failed. Try again.', 'Copy failed. Try again.', 'Copied']) {
    button.click();
    await tick();
    assert.equal(feedback.textContent, expected);
    assert.equal(f.article.querySelector('[role="tooltip"]').textContent, expected);
    assert.equal(button.dataset.state, expected === 'Copied' ? 'success' : 'error');
    assert.equal(button.hasAttribute('aria-disabled'), false);
    assert.equal(f.window.document.activeElement, button);
    assert.equal(f.status.textContent, 'Cannot read file');
  }
});

test('shows a checkmark for two seconds and restarts the timer after another copy', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = setup(t);
  f.render('```\nexample\n```');
  const button = f.article.querySelector('button');
  const icon = button.querySelector('path');
  const copyPath = icon.getAttribute('d');
  button.focus();
  button.click();
  await tick();
  assert.equal(button.dataset.state, 'success');
  assert.notEqual(icon.getAttribute('d'), copyPath);
  t.mock.timers.tick(1500);
  button.click();
  await tick();
  t.mock.timers.tick(1999);
  assert.equal(button.dataset.state, 'success');
  t.mock.timers.tick(1);
  assert.equal(button.dataset.state, 'idle');
  assert.equal(icon.getAttribute('d'), copyPath);
  assert.equal(f.article.querySelector('[role="tooltip"]').textContent, 'Copy code to clipboard');
  assert.equal(f.article.querySelector('[role="status"]').textContent, '');
  assert.equal(f.window.document.activeElement, button);
});

for (const change of ['document replacement', 'page exit']) {
  test(`cancels the icon reset on ${change}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = setup(t);
    const clear = t.mock.method(f.window, 'clearTimeout');
    f.render('```\nold\n```');
    const oldButton = f.article.querySelector('button');
    oldButton.click();
    await tick();
    if (change === 'document replacement') f.render('```\nnew\n```');
    else f.window.dispatchEvent(new f.window.Event('pagehide'));
    assert.equal(clear.mock.callCount(), 1);
    t.mock.timers.tick(2000);
    assert.equal(oldButton.dataset.state, 'success');
    if (change === 'document replacement') {
      assert.equal(f.article.querySelector('button').dataset.state, 'idle');
      assert.equal(f.article.querySelector('[role="status"]').textContent, '');
    }
  });
}

test('starts copying during the click and ignores repeated activation while pending', async t => {
  let resolve;
  const copied = [];
  const f = setup(t, text => {
    copied.push(text);
    return new Promise(done => { resolve = done; });
  });
  f.render('```\nexample\n```');
  const button = f.article.querySelector('button');
  button.click();
  assert.deepEqual(copied, ['example\n']);
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  assert.equal(f.article.querySelector('[role="status"]').textContent, 'Copying…');
  button.click();
  assert.equal(copied.length, 1);
  resolve();
  await tick();
  assert.equal(button.hasAttribute('aria-disabled'), false);
  button.click();
  assert.equal(copied.length, 2);
  resolve();
  await tick();
});

for (const outcome of ['success', 'failure']) {
  test(`ignores an old copy ${outcome} after replacing the document`, async t => {
    let resolve, reject;
    const copied = [];
    const f = setup(t, text => {
      copied.push(text);
      return new Promise((done, fail) => { resolve = done; reject = fail; });
    });
    f.render('```\nold\n```');
    const oldButton = f.article.querySelector('button');
    const oldFeedback = f.article.querySelector('[role="status"]');
    oldButton.click();
    f.render('```\nnew\n```');
    if (outcome === 'success') resolve();
    else reject(new Error('Old request failed'));
    await tick();
    assert.equal(oldFeedback.textContent, 'Copying…');
    assert.equal(f.article.querySelector('[role="status"]').textContent, '');
    oldButton.click();
    assert.deepEqual(copied, ['old\n']);
    f.article.querySelector('button').click();
    assert.deepEqual(copied, ['old\n', 'new\n']);
    resolve();
    await tick();
  });
}

test('retains controls on status-only updates and removes them in plain-text mode', async t => {
  const copied = [];
  const f = setup(t, async text => { copied.push(text); });
  const markdown = '```\nexample\n```';
  f.render(markdown);
  const button = f.article.querySelector('button');
  f.render(markdown, 'Cannot read file');
  assert.equal(f.article.querySelector('button'), button);
  button.click();
  await tick();
  f.render(markdown.padEnd(MAX_MARKDOWN_BYTES + 1, ' '));
  assert.equal(f.article.querySelector('button'), null);
  button.click();
  assert.deepEqual(copied, ['example\n']);
  f.render(markdown);
  assert.equal(f.article.querySelectorAll('button').length, 1);
});

test('stops updating copy feedback when the page exits', async t => {
  let resolve;
  const f = setup(t, () => new Promise(done => { resolve = done; }));
  f.render('```\nexample\n```');
  f.article.querySelector('button').click();
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  resolve();
  await tick();
  assert.equal(f.article.querySelector('[role="status"]').textContent, 'Copying…');
});

test('copies only characters the preview displays and says when others were left out', async t => {
  const copied = [];
  const f = setup(t, async text => { copied.push(text); });
  const shown = '\tconst 日本語 = "👨\u200D👩\u200D👧 می\u200Cخواهم ❤\uFE0F 葛\u{E0100} \u200F\u2067עברית\u2069" [201~;\n';
  const hidden = '\u001B\u0007\u007F\u0085\u00AD\u034F\u200B\u2060\u2062\uFEFF\u3164\u{E0041}\u{E007F}';
  const spread = [...hidden];
  const withHidden = shown.slice(0, 7) + spread.slice(0, 6).join('') + shown.slice(7, -1) + spread.slice(6).join('') + '\n';
  f.render('```js\n' + withHidden + '```\n\n```js\n' + shown + '```');
  const [first, second] = f.article.querySelectorAll('button');
  first.click();
  await tick();
  assert.equal(f.article.querySelector('[role="status"]').textContent, 'Copied without hidden characters');
  second.click();
  await tick();
  assert.deepEqual(copied, [shown, shown]);
  assert.equal(f.article.querySelectorAll('[role="status"]')[1].textContent, 'Copied');
});
