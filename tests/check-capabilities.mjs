import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const perf = process.argv.includes('--perf');
const read = name => JSON.parse(readFileSync(`src-tauri/gen/schemas/${name}.json`, 'utf8'));
const manifests = read('acl-manifests');
const capabilities = read('capabilities');
const schema = read('desktop-schema');
const permissions = manifests['__app-acl__'].permissions;
for (const command of ['get-document', 'get-image', 'close-preview', 'open-external']) {
  assert.ok(permissions[`allow-${command}`]);
  assert.ok(capabilities['main-capability'].permissions.includes(`allow-${command}`));
}
assert.equal(Boolean(permissions['allow-perf-mark']), perf);
assert.equal(Boolean(permissions['deny-perf-mark']), perf);
assert.equal(Boolean(capabilities['perf-capability']), perf);
assert.equal(JSON.stringify(schema).includes('allow-perf-mark'), perf);
if (perf) assert.deepEqual(capabilities['perf-capability'].permissions, ['allow-perf-mark']);
for (const capability of Object.values(capabilities)) {
  assert.deepEqual(capability.windows, ['preview-*']);
  assert.ok(capability.permissions.every(permission => !permission.startsWith('opener:')));
}
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
assert.equal(config.app.security.capabilities, undefined);
console.log(`Generated ${perf ? 'perf' : 'normal'} capabilities match the selected commands.`);
