import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const local = path.join(root, '.toolchain');
const env = { ...process.env };
if (existsSync(path.join(local, 'cargo/bin/cargo'))) {
  env.CARGO_HOME = path.join(local, 'cargo'); env.RUSTUP_HOME = path.join(local, 'rustup');
  env.PATH = path.join(local, 'cargo/bin') + path.delimiter + env.PATH;
}
const args = process.argv.slice(2);
const child = args[0] === 'test'
  ? spawn('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml'], { cwd: root, env, stdio: 'inherit' })
  : spawn(path.join(root, 'node_modules/.bin/tauri'), args, { cwd: root, env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exit(1); });
child.on('exit', code => {
  if (code === 0 && args[0] === 'build' && process.platform === 'darwin') {
    const source = path.join(root, 'src-tauri/target/release/bundle/macos/SourceScore.app');
    if (existsSync(source)) {
      const signing = spawnSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', source], { stdio: 'inherit' });
      if (signing.status !== 0) process.exit(signing.status ?? 1);
      const destination = path.join(root, 'releases/SourceScore.app');
      mkdirSync(path.dirname(destination), { recursive: true }); rmSync(destination, { recursive: true, force: true });
      const copy = spawnSync('/usr/bin/ditto', [source, destination], { stdio: 'inherit' });
      process.exit(copy.status ?? 1);
    }
  }
  process.exit(code ?? 1);
});
