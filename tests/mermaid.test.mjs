import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

globalThis.window = new JSDOM().window;
globalThis.document = window.document;
const adapter = await import('../src/mermaid.ts');

for (const dark of [false, true]) {
  test(`initializes the diagram API for ${dark ? 'dark' : 'light'} and returns SVG from a measurable temporary container`, async t => {
    const { window } = new JSDOM();
    t.after(() => window.close());
    const calls = [];
    const containers = [];
    const renderer = adapter.createMermaidRenderer({
      initialize(config) { calls.push(['initialize', config]); },
      async render(id, source, container) {
        assert.equal(container.parentElement, window.document.body);
        assert.notEqual(container.style.display, 'none');
        assert.equal(container.style.position, 'absolute');
        assert.equal(container.style.visibility, 'hidden');
        containers.push(container);
        calls.push(['render', id, source]);
        return { svg: '<svg></svg>' };
      },
    }, window.document);
    assert.equal(await renderer('A', dark), '<svg></svg>');
    assert.equal(await renderer('B', dark), '<svg></svg>');
    assert.deepEqual(calls[0], ['initialize', {
      startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', suppressErrorRendering: true,
    }]);
    assert.deepEqual(calls.map(call => call[0]), ['initialize', 'render', 'initialize', 'render']);
    assert.equal(calls[1][2], 'A');
    assert.equal(calls[3][2], 'B');
    assert.notEqual(calls[1][1], calls[3][1]);
    assert.ok(containers.every(container => !container.isConnected));
    assert.equal(window.document.body.children.length, 0);
  });
}

for (const stage of ['initialize', 'render']) {
  test(`removes the temporary container when ${stage} fails and allows a later retry`, async t => {
    const { window } = new JSDOM();
    t.after(() => window.close());
    let fail = true;
    const error = new Error('Unavailable');
    const renderer = adapter.createMermaidRenderer({
      initialize() { if (stage === 'initialize' && fail) throw error; },
      async render(id, source, container) {
        container.innerHTML = '<svg><text>Temporary content</text></svg>';
        if (stage === 'render' && fail) throw error;
        return { svg: '<svg></svg>' };
      },
    }, window.document);
    await assert.rejects(renderer('A', false), error);
    assert.equal(window.document.body.children.length, 0);
    fail = false;
    assert.equal(await renderer('B', false), '<svg></svg>');
    assert.equal(window.document.body.children.length, 0);
  });
}
