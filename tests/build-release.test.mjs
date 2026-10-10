import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { releaseEnvironment } from '../scripts/build-release.mjs';

test('keeps source locations useful without embedding build-machine paths', () => {
  const home = mkdtempSync(join(tmpdir(), 'mjp build paths '));
  try {
    const project = join(home, 'project');
    const cargoHome = join(home, 'cargo cache');
    mkdirSync(join(project, 'src'), { recursive: true });
    mkdirSync(cargoHome);
    writeFileSync(join(project, 'Cargo.toml'), '[package]\nname = "path-fixture"\nversion = "0.0.0"\nedition = "2021"\n');
    writeFileSync(join(cargoHome, 'source.rs'), 'pub fn origin() -> &\'static str { file!() }\n');
    writeFileSync(join(project, 'src/main.rs'), `
#[cfg(not(kept_existing_flag))]
compile_error!("existing compiler flags were not preserved");
mod dependency { include!(concat!(env!("CARGO_HOME"), "/source.rs")); }
fn main() { println!("{}\\n{}", file!(), dependency::origin()); }
`);
    const original = {
      ...process.env,
      CARGO_HOME: relative(project, cargoHome),
      CARGO_TARGET_DIR: join(project, 'target'),
      CARGO_ENCODED_RUSTFLAGS: '--cfg\x1fkept_existing_flag',
    };
    const env = releaseEnvironment(original, project, home);
    assert.equal(original.CARGO_ENCODED_RUSTFLAGS, '--cfg\x1fkept_existing_flag');
    const binary = join(project, 'target/release', process.platform === 'win32' ? 'path-fixture.exe' : 'path-fixture');
    const baseline = spawnSync('cargo', ['build', '--release', '--offline'], {
      cwd: project, env: { ...original, CARGO_HOME: cargoHome }, encoding: 'utf8',
    });
    assert.equal(baseline.status, 0, baseline.stderr);
    assert.equal(readFileSync(binary).includes(Buffer.from(home)), true);
    const build = spawnSync('cargo', ['build', '--release', '--offline'], { cwd: project, env, encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    assert.equal(readFileSync(binary).includes(Buffer.from(home)), false);
    const run = spawnSync(binary, [], { env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /src\/main\.rs/);
    assert.match(run.stdout, /\/build\/cargo\/source\.rs/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
