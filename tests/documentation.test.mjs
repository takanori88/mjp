import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const documents = [
  'README.md', 'docs/ja/README.md',
  'docs/en/PLAN.md', 'docs/ja/PLAN.md',
  'docs/en/PROJECT.md', 'docs/ja/PROJECT.md',
];

for (const file of documents) {
  test(`${file} keeps its local document links reachable`, () => {
    const text = readFileSync(file, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
    const links = [...text.matchAll(/(?<!!)\[[^\]\n]+\]\(([^)\s]+)\)/g)];
    assert.ok(links.length > 0);
    for (const [, target] of links) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const path = decodeURIComponent(target.split('#')[0]);
      assert.ok(existsSync(resolve(dirname(file), path)), `${file}: ${target}`);
    }
  });
}

const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
for (const file of ['README.md', 'docs/ja/README.md']) {
  test(`${file} documents the configured Finder bundle and file extensions`, () => {
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes(`src-tauri/target/release/bundle/macos/${config.productName}.app`));
    assert.ok(text.includes(`/Applications/${config.productName}.app`));
    for (const association of config.bundle.fileAssociations) {
      for (const extension of association.ext) {
        assert.ok(text.includes(`\`.${extension}\``), `${file}: .${extension}`);
      }
    }
  });
}
