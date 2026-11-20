#!/usr/bin/env node
// Syntax-check every shipped JavaScript module, not just the entry points.
// `--list` prints the file list (used by tests) and performs no check.
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function moduleFiles() {
  const entries = await readdir(path.join(root, 'src'), { withFileTypes: true });
  const src = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join('src', entry.name))
    .sort();
  const scripts = (await readdir(path.join(root, 'scripts'), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => path.join('scripts', entry.name))
    .sort();
  return ['index.js', 'client.js', ...src, ...scripts];
}

const files = (await moduleFiles()).map((entry) => entry.split(path.sep).join('/'));

if (process.argv.includes('--list')) {
  process.stdout.write(`${JSON.stringify(files, null, 2)}\n`);
  process.exit(0);
}

const failures = [];
for (const relative of files) {
  try {
    await run(process.execPath, ['--check', path.join(root, relative)], { cwd: root });
  } catch (error) {
    failures.push({ file: relative, message: String(error.stderr || error.message).trim() });
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure.file}\n${failure.message}\n`);
  process.stderr.write(`syntax check failed for ${failures.length} of ${files.length} files\n`);
  process.exit(1);
}

process.stdout.write(`syntax ok: ${files.length} files\n`);
