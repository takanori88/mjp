import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

globalThis.window = new JSDOM().window;
const { createDocumentRenderer, MAX_MARKDOWN_BYTES } = await import('../src/render.ts');
const settle = () => new Promise(resolve => setImmediate(resolve));
const fence = (source, info = 'mermaid') => `\`\`\`${info}\n${source}\n\`\`\`\n`;
const svg = label => `<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>`;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(t, draw = async source => svg(source.trim()), load) {
  const { window } = new JSDOM('<article></article><aside></aside>');
  t.after(() => window.close());
  window.scrollTo = () => {};
  let dark = false;
  window.matchMedia = query => ({ matches: query === '(prefers-color-scheme: dark)' && dark });
  const article = window.document.querySelector('article');
  const status = window.document.querySelector('aside');
  const calls = [];
  let loads = 0, changes = 0, revision = 0;
  const renderer = async (...args) => { calls.push(args); return draw(...args); };
  const render = createDocumentRenderer(article, status, undefined, undefined, async () => {},
    () => { loads++; return load ? load(renderer) : Promise.resolve(renderer); }, () => { changes++; });
  return { window, article, status, calls, get loads() { return loads; }, get changes() { return changes; },
    renderSnapshot: render,
    setDark: value => { dark = value; },
    render: (text, error = null) => render({ text, revision: revision++, error, warning: null }) };
}

test('shows Mermaid source as literal text before drawing without code actions or highlighting', async t => {
  const pending = deferred();
  const f = setup(t, () => pending.promise);
  f.render(fence('<b>label</b> & <img src=x>'));
  const placeholder = f.article.querySelector('[data-mjp-diagram="0"]');
  assert.ok(placeholder);
  assert.equal(placeholder.querySelector('pre > code').textContent, '<b>label</b> & <img src=x>\n');
  assert.equal(placeholder.querySelector('b, img, button, [data-mjp-fence], .hljs'), null);
  await settle();
  assert.deepEqual(f.calls, [['<b>label</b> & <img src=x>\n', false]]);
});

for (const [info, recognized] of [['mermaid title', true], [' mermaid\t title', true], ['Mermaid', false], ['mmd', false], ['mermaid-extra', false]]) {
  test(`recognizes the exact first info word in ${JSON.stringify(info)}`, async t => {
    const f = setup(t);
    f.render(fence('A', info));
    await settle();
    assert.equal(f.article.querySelectorAll('[data-mjp-diagram]').length, Number(recognized));
    assert.equal(f.calls.length, Number(recognized));
    assert.equal(f.article.querySelectorAll('button').length, Number(!recognized));
  });
}

for (const text of [fence('mermaid', ''), fence('const a = 1', 'js'), '    mermaid\n', fence('A').padEnd(MAX_MARKDOWN_BYTES + 1, ' ')]) {
  test(`does not load diagrams for ordinary or plain-text content (${text.length} characters)`, async t => {
    const f = setup(t);
    f.render(text);
    await settle();
    assert.equal(f.loads, 0);
    assert.equal(f.calls.length, 0);
  });
}

test('draws sequentially in document order and reuses the loaded renderer', async t => {
  const first = deferred();
  const f = setup(t, source => source.trim() === 'A' ? first.promise : Promise.resolve(svg('B')));
  f.render(fence('A') + fence('B'));
  await settle();
  assert.deepEqual(f.calls.map(call => call[0]), ['A\n']);
  assert.equal(f.article.querySelectorAll('svg').length, 0);
  first.resolve(svg('A'));
  await settle();
  assert.deepEqual(f.calls.map(call => call[0]), ['A\n', 'B\n']);
  assert.deepEqual([...f.article.querySelectorAll('svg')].map(node => node.textContent), ['A', 'B']);
  assert.equal(f.loads, 1);
  assert.equal(f.changes, 2);
  f.render(fence('C'));
  await settle();
  assert.equal(f.loads, 1);
});

test('keeps the current diagram when only status changes or an older revision arrives', async t => {
  const f = setup(t);
  const text = fence('A');
  f.render(text);
  await settle();
  const diagram = f.article.querySelector('svg');
  assert.ok(diagram);
  assert.equal(f.render(text, 'Cannot read file'), false);
  await settle();
  assert.equal(f.article.querySelector('svg'), diagram);
  assert.equal(f.status.textContent, 'Cannot read file');
  assert.equal(f.renderSnapshot({ text: fence('obsolete'), revision: 0, error: null, warning: null }), false);
  assert.equal(f.article.querySelector('svg'), diagram);
  assert.equal(f.calls.length, 1);
});

test('keeps labels and styles while removing unsupported diagram elements and attributes', async t => {
  const f = setup(t, async () => '<svg xmlns="http://www.w3.org/2000/svg" onload="example()">' +
    '<style>#diagram {fill:red}</style><g style="fill:blue" onclick="example()">' +
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><span style="color:red">Label</span>' +
    '<img src=x onerror="example()"><iframe>frame</iframe><object>object</object><embed><form><input><button>button</button></form></div></foreignObject>' +
    '<a href="https://example.com"><text>Link text</text></a><image href="x"/><script>example()</script></g></svg>');
  f.render(fence('A'));
  await settle();
  const result = f.article.querySelector('[data-mjp-diagram] > svg');
  assert.ok(result);
  assert.equal(result.querySelector('style').textContent, '#diagram {fill:red}');
  assert.equal(result.querySelector('g').getAttribute('style'), 'fill:blue');
  assert.equal(result.querySelector('foreignObject div span').textContent, 'Label');
  assert.equal(result.querySelector('span').getAttribute('style'), 'color:red');
  assert.match(result.textContent, /Link text/);
  assert.equal(result.querySelector('script, img, iframe, a, image, object, embed, form, input, button'), null);
  for (const node of [result, ...result.querySelectorAll('*')]) {
    assert.equal([...node.attributes].some(attribute => /^on/i.test(attribute.name)), false);
  }
});

test('keeps failed source and a literal first-line error while continuing subsequent diagrams', async t => {
  const f = setup(t, async source => {
    if (source.trim() === 'A') throw new Error('<b title="x">literal label</b>\nsecond line');
    return svg('B');
  });
  f.render(fence('A') + fence('B'));
  await settle();
  const note = f.article.querySelector('.diagram-note');
  assert.ok(note);
  assert.equal(note.getAttribute('role'), 'note');
  assert.equal(note.textContent, 'Cannot render this Mermaid diagram: <b title="x">literal label</b>');
  assert.equal(note.children.length, 0);
  assert.equal(f.article.querySelector('pre > code').textContent, 'A\n');
  assert.equal(f.article.querySelector('svg text').textContent, 'B');
  assert.equal(f.changes, 2);
});

for (const output of ['', '<div>not SVG</div>', '<svg></svg><svg></svg>', '<svg></svg>extra', '<div><svg></svg></div>']) {
  test(`retains source when the result is not one root SVG: ${JSON.stringify(output)}`, async t => {
    const f = setup(t, async () => output);
    f.render(fence('A'));
    await settle();
    assert.ok(f.article.querySelector('.diagram-note'));
    assert.equal(f.article.querySelector('pre > code').textContent, 'A\n');
    assert.equal(f.article.querySelector('svg'), null);
  });
}

for (const size of [50000, 50001]) {
  test(`applies the source limit before loading at ${size} UTF-16 units`, async t => {
    const f = setup(t);
    const source = 'x'.repeat(size - 1);
    f.render(fence(source));
    await settle();
    assert.equal(f.calls.length, size === 50000 ? 1 : 0);
    if (size > 50000) {
      assert.equal(f.loads, 0);
      assert.equal(f.article.querySelector('pre > code').textContent, source + '\n');
      assert.equal(f.article.querySelector('.diagram-note').textContent, 'This Mermaid diagram is too large to render.');
    } else assert.ok(f.article.querySelector('svg'));
    assert.equal(f.changes, 1);
  });
}

for (const count of [20, 21]) {
  test(`draws only the first 20 Mermaid occurrences in a ${count}-diagram document`, async t => {
    const f = setup(t);
    f.render(Array.from({ length: count }, (_, i) => fence(`A${i}`)).join('\n'));
    await settle();
    assert.equal(f.calls.length, 20);
    assert.equal(f.article.querySelectorAll('svg').length, 20);
    if (count === 21) {
      assert.equal(f.article.querySelector('.diagram-note').textContent, 'Only the first 20 Mermaid diagrams are rendered.');
      assert.equal(f.article.querySelector('pre > code').textContent, 'A20\n');
    }
    assert.equal(f.changes, count);
  });
}

test('skips intermediate document generations while a previous drawing is pending', async t => {
  const old = deferred();
  const f = setup(t, source => source.trim() === 'old' ? old.promise : Promise.resolve(svg(source.trim())));
  f.render(fence('old') + fence('old remainder'));
  await settle();
  assert.equal(f.calls.length, 1);
  f.render(fence('intermediate'));
  f.render(fence('latest') + fence('latest remainder'));
  await settle();
  assert.equal(f.calls.length, 1);
  old.resolve(svg('obsolete'));
  await settle();
  assert.deepEqual(f.calls.map(call => call[0].trim()), ['old', 'latest', 'latest remainder']);
  assert.doesNotMatch(f.article.textContent, /obsolete|intermediate/);
  assert.equal(f.changes, 2);
});

for (const action of ['reload', 'pagehide']) {
  test(`does not begin obsolete drawing after module loading finishes following ${action}`, async t => {
    const module = deferred();
    const f = setup(t, undefined, () => module.promise);
    f.render(fence('old'));
    await settle();
    assert.equal(f.loads, 1);
    if (action === 'reload') f.render(fence('latest'));
    else f.window.dispatchEvent(new f.window.Event('pagehide'));
    module.resolve(async source => { f.calls.push([source]); return svg(source.trim()); });
    await settle();
    assert.deepEqual(f.calls.map(call => call[0].trim()), action === 'reload' ? ['latest'] : []);
    assert.equal(f.changes, action === 'reload' ? 1 : 0);
  });
}

for (const rejected of [false, true]) {
  test(`ignores pending drawing ${rejected ? 'failure' : 'success'} and remaining diagrams after page exit`, async t => {
    const pending = deferred();
    const f = setup(t, () => pending.promise);
    f.render(fence('old') + fence('remaining'));
    await settle();
    assert.equal(f.calls.length, 1);
    const content = f.article.innerHTML;
    f.window.dispatchEvent(new f.window.Event('pagehide'));
    if (rejected) pending.reject(new Error('obsolete'));
    else pending.resolve(svg('obsolete'));
    await settle();
    assert.equal(f.article.innerHTML, content);
    assert.equal(f.calls.length, 1);
    assert.equal(f.changes, 0);
  });
}

test('retries failed renderer loading for later diagrams and subsequent documents', async t => {
  let available = false;
  const f = setup(t, undefined, renderer => available ? Promise.resolve(renderer) : Promise.reject(new Error('Module unavailable')));
  f.render(fence('A') + fence('B'));
  await settle();
  assert.equal(f.loads, 2);
  assert.equal(f.article.querySelectorAll('.diagram-note').length, 2);
  assert.equal(f.calls.length, 0);
  assert.equal(f.changes, 2);
  available = true;
  f.render(fence('C'));
  await settle();
  assert.equal(f.loads, 3);
  assert.equal(f.article.querySelector('svg text').textContent, 'C');
});

test('samples the effective dark preference when drawing each diagram', async t => {
  const f = setup(t);
  f.setDark(true);
  f.render(fence('dark'));
  await settle();
  assert.deepEqual(f.calls, [['dark\n', true]]);
  f.setDark(false);
  f.render(fence('light'));
  await settle();
  assert.deepEqual(f.calls[1], ['light\n', false]);
});
