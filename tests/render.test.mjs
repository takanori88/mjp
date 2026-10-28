import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<article></article><aside></aside>', { pretendToBeVisual: true });
globalThis.window = dom.window;
dom.window.scrollTo = () => {};
const { createDocumentRenderer, MAX_MARKDOWN_BYTES } = await import('../src/render.ts');

function setup() {
  const article = dom.window.document.createElement('article');
  const status = dom.window.document.createElement('aside');
  const stages = [];
  const render = createDocumentRenderer(article, status, stage => stages.push(stage), undefined, async () => {});
  return { article, status, stages, render };
}

const snapshot = (text, revision = 0, error = null, warning = null) => ({ text, revision, error, warning });
const patterns = {
  fences: '```js\nconst value = 1;\n```\n\n',
  quotes: '> '.repeat(64) + '- item\n\n',
  links: '[example](https://example.invalid/) '.repeat(16) + '\n\n',
};

for (const [kind, pattern] of Object.entries(patterns)) {
  for (const size of [MAX_MARKDOWN_BYTES, MAX_MARKDOWN_BYTES + 1]) {
    test(`uses the selected display mode for ${kind} at ${size} bytes`, () => {
      const { article, status, stages, render } = setup();
      const text = pattern.repeat(2).padEnd(size, ' ');
      render(snapshot(text));
      if (size <= MAX_MARKDOWN_BYTES) {
        assert.ok(stages.includes('markdown_parsed'));
        assert.equal(status.hidden, true);
      } else {
        assert.equal(stages.includes('markdown_parsed'), false);
        assert.equal(article.children.length, 1);
        assert.equal(article.firstElementChild.tagName, 'PRE');
        assert.equal(article.firstElementChild.children.length, 0);
        assert.equal(article.textContent, text);
        assert.match(status.textContent, /plain text/i);
      }
    });
  }
}

test('counts UTF-8 bytes when selecting the display mode', () => {
  const { article, stages, render } = setup();
  const text = 'あ'.repeat(Math.floor(MAX_MARKDOWN_BYTES / 3) + 1);
  assert.ok(text.length < MAX_MARKDOWN_BYTES);
  render(snapshot(text));
  assert.equal(stages.includes('markdown_parsed'), false);
  assert.equal(article.textContent, text);
});

test('keeps the complete source inert in plain-text mode', () => {
  const { article, render } = setup();
  const text = '<script>example()</script><img src=x onerror=example()>'.padEnd(MAX_MARKDOWN_BYTES + 1, 'x');
  render(snapshot(text));
  assert.equal(article.textContent, text);
  assert.equal(article.querySelector('script, img'), null);
});

for (const text of ['# Example', 'x'.repeat(MAX_MARKDOWN_BYTES + 1)]) {
  test(`updates status without replacing unchanged ${text.length > MAX_MARKDOWN_BYTES ? 'plain' : 'formatted'} content`, () => {
    const { article, status, render } = setup();
    render(snapshot(text));
    const content = article.firstChild;
    render(snapshot(text, 1, 'Cannot read file'));
    assert.equal(status.textContent, 'Cannot read file');
    assert.equal(article.firstChild, content);
    render(snapshot(text, 2, null, 'Live reload unavailable'));
    assert.equal(status.textContent, 'Live reload unavailable');
    assert.equal(article.firstChild, content);
    render(snapshot(text, 3));
    assert.equal(status.hidden, text.length <= MAX_MARKDOWN_BYTES);
    assert.equal(article.firstChild, content);
    render(snapshot('stale', 2, 'stale error'));
    assert.equal(article.firstChild, content);
    assert.doesNotMatch(status.textContent, /stale/);
  });
}

test('notes only code blocks that contain text direction controls', () => {
  const { article, render } = setup();
  render(snapshot(
    '```sh\necho ⁧a⁩\n```\n\n' +
    '    indented ‮b\n\n' +
    '```sh\necho mark ‏\n```\n\n' +
    'prose ⁧c⁩\n',
  ));
  const blocks = [...article.querySelectorAll('pre > code')]
    .map(code => code.closest('.code-block') ?? code.parentElement);
  assert.deepEqual(blocks.map(block => block.previousElementSibling?.getAttribute('role') ?? null), ['note', 'note', null]);
  assert.equal(article.querySelectorAll('[role="note"]').length, 2);
});

test('returns to formatted output when the document becomes smaller', () => {
  const { article, status, render } = setup();
  render(snapshot('x'.repeat(MAX_MARKDOWN_BYTES + 1)));
  render(snapshot('# Title', 1));
  assert.equal(article.querySelector('h1').textContent, 'Title');
  assert.equal(status.hidden, true);
});

test('renders the supported Markdown structures as readable document elements', () => {
  const { article, render } = setup();
  render(snapshot([
    '# Title', '', '**bold** and *italic* and ~~removed~~ and `inline`', '',
    '> quotation', '', '- first', '- second', '', '1. ordered', '',
    '- [x] done', '- [ ] pending', '', '| Name | Value |', '| --- | --- |', '| item | 42 |', '',
    '---', '', '```unknown-language', '<example>& text', '```', '',
    '![image description](https://example.com/image.png)', '',
    '<script>example()</script>',
  ].join('\n')));
  for (const [selector, text] of Object.entries({
    h1: 'Title', strong: 'bold', em: 'italic', s: 'removed', 'p code': 'inline',
    'blockquote p': 'quotation', 'ol li': 'ordered', 'tbody td': 'item',
  })) assert.equal(article.querySelector(selector).textContent, text);
  assert.ok(article.querySelector('hr'));
  assert.deepEqual([...article.querySelectorAll('input[type="checkbox"]')].map(input => [input.checked, input.disabled]),
    [[true, true], [false, true]]);
  assert.equal(article.querySelector('pre code').textContent, '<example>& text\n');
  assert.equal(article.querySelector('pre code').children.length, 0);
  assert.match(article.textContent, /image description/);
  assert.match(article.textContent, /<script>example\(\)<\/script>/);
  assert.equal(article.querySelector('img, script'), null);
});

test('shows normalized link destinations while preserving author titles', () => {
  const { article, render } = setup();
  render(snapshot('[plain](https://example.com) [titled](https://example.com/path "Details")'));
  assert.deepEqual([...article.querySelectorAll('a')].map(anchor => anchor.title),
    ['https://example.com/', 'https://example.com/path\nDetails']);
});
