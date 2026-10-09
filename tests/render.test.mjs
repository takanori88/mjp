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
  const render = createDocumentRenderer(article, status, stage => stages.push(stage));
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

test('returns to formatted output when the document becomes smaller', () => {
  const { article, status, render } = setup();
  render(snapshot('x'.repeat(MAX_MARKDOWN_BYTES + 1)));
  render(snapshot('# Title', 1));
  assert.equal(article.querySelector('h1').textContent, 'Title');
  assert.equal(status.hidden, true);
});
