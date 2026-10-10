import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseEnvironment(env, projectRoot, home = homedir()) {
  const buildEnv = { ...env };
  for (const key of ['CARGO_HOME', 'RUSTUP_HOME']) {
    if (buildEnv[key]) buildEnv[key] = resolve(projectRoot, buildEnv[key]);
  }
  const paths = new Map();
  for (const [source, destination] of [
    [home, '/build/home'],
    [buildEnv.CARGO_HOME || join(home, '.cargo'), '/build/cargo'],
    [buildEnv.RUSTUP_HOME || join(home, '.rustup'), '/build/rustup'],
    [projectRoot, '/build/mjp'],
  ]) {
    const absolute = resolve(projectRoot, source);
    paths.set(absolute, destination);
    try {
      paths.set(realpathSync(absolute), destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const flags = env.CARGO_ENCODED_RUSTFLAGS !== undefined
    ? env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').filter(Boolean)
    : (env.RUSTFLAGS || '').split(/\s+/).filter(Boolean);
  // Rust uses the last matching prefix; keep specific paths after their parents.
  for (const [source, destination] of [...paths].sort(([a], [b]) => a.length - b.length)) {
    flags.push(`--remap-path-prefix=${source}=${destination}`);
  }

  // Cargo's encoded form keeps paths with spaces in a single compiler argument.
  return { ...buildEnv, CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f') };
}

if (import.meta.main) {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js');
  const result = spawnSync(process.execPath, [cli, 'build', ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: releaseEnvironment(process.env, projectRoot),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  process.exit(result.status ?? 1);
}
