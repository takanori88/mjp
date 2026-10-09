import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import MarkdownIt from 'markdown-it';
import { samples } from './highlight-samples.mjs';

const { window } = new JSDOM();
globalThis.window = window;
const { highlightCode, highlighter } = await import('../src/highlight.ts');
const document = window.document;

test('keeps highlighted output limited to text and styled spans', () => {
  const code = document.createElement('code');
  code.textContent = 'example';
  highlightCode(code, 'js', () =>
    '<span class="hljs-title function_ unrelated" onclick="example()" data-x="1" aria-label="x">example</span>' +
    '<img src=x onerror="example()"><script>example()</script><a href="javascript:example()">link</a>',
  );
  assert.equal(code.querySelector('img, script, a'), null);
  const span = code.querySelector('span');
  assert.equal(span.className, 'hljs-title function_');
  for (const node of code.querySelectorAll('*')) {
    assert.equal(node.tagName, 'SPAN');
    assert.deepEqual([...node.attributes].map(a => a.name), ['class']);
  }
});

for (const [language, source] of Object.entries(samples)) {
  test(`preserves ${language} highlight structure and text`, () => {
    const expected = document.createElement('code');
    expected.innerHTML = highlighter.highlight(source, { language }).value;
    assert.ok(expected.querySelector('span'));
    const actual = document.createElement('code');
    actual.textContent = source;
    highlightCode(actual, language);
    assert.equal(actual.innerHTML, expected.innerHTML);
    assert.equal(actual.textContent, source);
  });
}

test('preserves markup-like text inside a highlighted JavaScript fence', () => {
  const source = 'const text = `</code></pre><img src=x onerror=1>\"><svg onload=1>`;';
  const article = document.createElement('article');
  article.innerHTML = new MarkdownIt({ html: false }).render('```js\n' + source + '\n```');
  const code = article.querySelector('code');
  highlightCode(code, 'js');
  assert.ok(code.querySelector('span'));
  assert.equal(code.textContent, source + '\n');
  for (const node of code.querySelectorAll('*')) {
    assert.equal(node.tagName, 'SPAN');
    assert.deepEqual([...node.attributes].map(a => a.name), ['class']);
  }
});

test('leaves unregistered fence languages as plain text', () => {
  const article = document.createElement('article');
  article.innerHTML = new MarkdownIt({ html: false }).render('```js"onmouseover=alert(1) x\nexample\n```');
  const code = article.querySelector('code');
  const language = [...code.classList].find(name => name.startsWith('language-')).slice(9);
  assert.equal(highlighter.getLanguage(language), undefined);
  assert.equal(code.children.length, 0);
  assert.equal(code.textContent, 'example\n');
});
