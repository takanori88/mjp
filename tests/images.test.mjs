import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

globalThis.window = new JSDOM().window;
const { createDocumentRenderer, MAX_MARKDOWN_BYTES } = await import('../src/render.ts');
const { startPreview } = await import('../src/preview.ts');
const { MAX_IMAGES, MAX_IMAGE_BYTES } = await import('../src/images.ts');
const png = () => Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10).buffer;
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup(t, read = async () => png()) {
  const { window } = new JSDOM('<article></article><aside></aside>');
  t.after(() => window.close());
  window.scrollTo = () => {};
  const blobs = [];
  const revoked = [];
  window.URL.createObjectURL = blob => { blobs.push(blob); return `blob:fixture-${blobs.length}`; };
  window.URL.revokeObjectURL = url => revoked.push(url);
  const article = window.document.querySelector('article');
  const status = window.document.querySelector('aside');
  const requests = [];
  const render = createDocumentRenderer(article, status, undefined, source => {
    requests.push(source);
    return read(source);
  });
  return { window, article, status, blobs, revoked, requests,
    render: (text, revision = 0) => render({ text, revision, error: null, warning: null }) };
}

test('renders Markdown images through local reads with alt text and titles', async t => {
  const f = setup(t);
  f.render('![A **picture**](images/preview%201.png "Preview title")');
  assert.equal(f.article.querySelector('img'), null);
  assert.equal(f.article.textContent.trim(), 'A picture');
  await settle();
  const image = f.article.querySelector('img');
  assert.equal(image.getAttribute('src'), 'blob:fixture-1');
  assert.equal(image.alt, 'A picture');
  assert.equal(image.title, 'Preview title');
  assert.equal(f.blobs[0].type, 'image/png');
  assert.deepEqual(f.requests, ['images/preview%201.png']);
});

test('keeps remote images and raw HTML inert without requesting their sources', async t => {
  const f = setup(t);
  f.render([
    '![Remote](https://example.invalid/image.png)',
    '![Remote](//example.invalid/image.png)',
    '![Absolute](/etc/image.png)',
    '![Inline](data:image/png;base64,AAAA)',
    '<img src="images/preview.png" onerror="example()">',
  ].join('\n\n'));
  await settle();
  assert.deepEqual(f.requests, []);
  assert.equal(f.article.querySelector('img'), null);
  assert.match(f.article.textContent, /Remote/);
  assert.match(f.article.textContent, /<img src=/);
});

test('retains readable alt text when reading or decoding fails', async t => {
  const f = setup(t, async source => {
    if (source === 'missing.png') throw new Error('Cannot open local image');
    return png();
  });
  f.render('![Missing](missing.png) ![Broken](broken.png)');
  await settle();
  assert.match(f.article.textContent, /Missing/);
  f.article.querySelector('img').dispatchEvent(new f.window.Event('error'));
  assert.equal(f.article.querySelector('img'), null);
  assert.match(f.article.textContent, /Broken/);
  assert.equal(f.status.hidden, true);
});

test('revokes shared image URLs on replacement and ignores pending old reads', async t => {
  let finish;
  const f = setup(t, source => source === 'old.png'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(png()));
  f.render('![One](image.png) ![Two](image.png)');
  await settle();
  assert.equal(f.blobs.length, 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.article.querySelectorAll('img').length, 2);
  f.render('![Old](old.png)', 1);
  assert.deepEqual(f.revoked, ['blob:fixture-1']);
  f.render('![Current](current.png)', 2);
  finish(png());
  await settle();
  assert.equal(f.blobs.length, 2);
  assert.equal(f.article.querySelector('img').alt, 'Current');
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  assert.deepEqual(f.revoked, ['blob:fixture-1', 'blob:fixture-2']);
});

test('leaves oversized and non-raster image responses as text', async t => {
  const f = setup(t, async source => source === 'large.png'
    ? new ArrayBuffer(MAX_IMAGE_BYTES + 1) : new TextEncoder().encode('<svg></svg>').buffer);
  f.render('![Large](large.png) ![Vector](vector.svg)');
  await settle();
  assert.equal(f.blobs.length, 0);
  assert.equal(f.article.querySelector('img'), null);
  assert.equal(f.article.textContent.trim(), 'Large Vector');
});

test('bounds image count and cumulative bytes per rendered document', async t => {
  const small = setup(t);
  small.render(Array.from({ length: MAX_IMAGES + 1 }, (_, index) => `![Image](image-${index}.png)`).join(' '));
  await settle();
  assert.equal(small.requests.length, MAX_IMAGES);
  assert.equal(small.article.querySelectorAll('img').length, MAX_IMAGES);
  const large = setup(t, async () => {
    const bytes = new Uint8Array(MAX_IMAGE_BYTES);
    bytes.set(new Uint8Array(png()));
    return bytes.buffer;
  });
  large.render(Array.from({ length: 6 }, (_, index) => `![Image](image-${index}.png)`).join(' '));
  await settle();
  assert.equal(large.blobs.length, 3);
  assert.equal(large.requests.length, 4);
});

test('uses raster MIME types for JPEG, GIF, and WebP responses', async t => {
  const samples = new Map([
    ['photo.jpg', [255, 216, 255]],
    ['animation.gif', [71, 73, 70, 56, 57, 97]],
    ['picture.webp', [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
  ]);
  const f = setup(t, async source => Uint8Array.from(samples.get(source)).buffer);
  f.render([...samples.keys()].map(source => `![Image](${source})`).join(' '));
  await settle();
  assert.deepEqual(f.blobs.map(blob => blob.type), ['image/jpeg', 'image/gif', 'image/webp']);
});

test('releases images when switching to plain text and does not load plain-text image syntax', async t => {
  const f = setup(t);
  f.render('![Picture](preview.png)');
  await settle();
  const source = '![Picture](preview.png)'.padEnd(MAX_MARKDOWN_BYTES + 1, ' ');
  f.render(source, 1);
  await settle();
  assert.deepEqual(f.revoked, ['blob:fixture-1']);
  assert.deepEqual(f.requests, ['preview.png']);
  assert.equal(f.article.querySelector('pre').textContent, source);
  assert.equal(f.article.querySelector('img'), null);
});

test('connects preview image reads and refreshes them after Markdown changes', async t => {
  const f = setup(t);
  let text = '![First](first.png)';
  let revision = 0;
  let changed;
  const requests = [];
  await startPreview(f.article, f.status, {
    getDocument: async () => ({ text, revision, error: null, warning: null }),
    getImage: async reference => { requests.push(reference); return png(); },
    subscribe: async callback => { changed = callback; },
    close: async () => {},
    openExternal: async () => {},
  });
  await settle();
  assert.equal(f.article.querySelector('img').alt, 'First');
  text = '![Second](second.png)';
  revision++;
  await changed();
  await settle();
  assert.equal(f.article.querySelector('img').alt, 'Second');
  assert.deepEqual(requests, ['first.png', 'second.png']);
  assert.deepEqual(f.revoked, ['blob:fixture-1']);
});
