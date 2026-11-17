import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const tauriDirectory = 'src-tauri';
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const config = readJson(join(tauriDirectory, 'tauri.conf.json'));

test('keeps the approved CSP directives and sources', () => {
  const csp = config.app.security.csp;
  assert.equal(typeof csp, 'string');
  const directives = new Map();
  for (const directive of csp.split(';').map(value => value.trim()).filter(Boolean)) {
    const [name, ...sources] = directive.split(/\s+/);
    const key = name.toLowerCase();
    assert.equal(directives.has(key), false, `duplicate CSP directive: ${key}`);
    directives.set(key, sources.sort());
  }
  assert.deepEqual(directives, new Map([
    ['default-src', ["'self'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['connect-src', ['http://ipc.localhost', 'ipc:']],
    ['img-src', ['blob:']],
    ['object-src', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['base-uri', ["'none'"]],
  ]));
});

test('keeps application configuration keys explicit', () => {
  assert.deepEqual(Object.keys(config.app).sort(), ['security', 'windows']);
  assert.deepEqual(Object.keys(config.app.security).sort(), ['csp']);
});

test('keeps Tauri configuration in the reviewed base file', () => {
  const otherConfigs = readdirSync(tauriDirectory).filter(name =>
    name !== 'tauri.conf.json'
    && /^(?:tauri\..+\.conf\.json5?|tauri\.conf\.json5|tauri(?:\..+)?\.toml)$/i.test(name));
  assert.deepEqual(otherConfigs, []);
});

function capabilityFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = prefix + entry.name;
    return entry.isDirectory()
      ? capabilityFiles(join(directory, entry.name), `${path}/`)
      : [path];
  });
}

const capabilityDirectory = join(tauriDirectory, 'capabilities');

test('keeps the capability source file set explicit', () => {
  assert.deepEqual(capabilityFiles(capabilityDirectory).sort(), ['default.json', 'perf/marks.json']);
});

test('keeps each capability limited to the approved window and permissions', () => {
  const expectedCapabilities = [
    ['default.json', 'main-capability', [
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'allow-get-document',
      'allow-get-image',
      'allow-close-preview',
      'allow-open-external',
    ]],
    ['perf/marks.json', 'perf-capability', ['allow-perf-mark']],
  ];
  for (const [file, identifier, permissions] of expectedCapabilities) {
    const capability = readJson(join(capabilityDirectory, file));
    assert.deepEqual(Object.keys(capability).sort(), ['$schema', 'identifier', 'permissions', 'windows'], file);
    assert.equal(capability.identifier, identifier, file);
    assert.deepEqual(capability.windows, ['preview-*'], file);
    assert.ok(Array.isArray(capability.permissions), file);
    assert.deepEqual(new Set(capability.permissions), new Set(permissions), file);
  }
});
