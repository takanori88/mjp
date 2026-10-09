import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { installInputGuards } from '../src/input.ts';

function setup() {
  const { window } = new JSDOM('<article><a href="https://example.com"><span>link</span></a><button>button</button></article><div id="margin"></div>');
  globalThis.Element = window.Element;
  const article = window.document.querySelector('article');
  installInputGuards(article, window);
  return { window, article };
}

test('cancels middle clicks on nested link content', () => {
  const { window, article } = setup();
  const event = new window.MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
  article.querySelector('span').dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  window.close();
});

test('leaves auxiliary input on nonlinks available', () => {
  const { window, article } = setup();
  const event = new window.MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
  article.querySelector('button').dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  window.close();
});

for (const target of ['article', '#margin']) {
  for (const type of ['dragover', 'drop']) {
    test(`cancels ${type} on ${target}`, () => {
      const { window } = setup();
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      window.document.querySelector(target).dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
      window.close();
    });
  }
}
