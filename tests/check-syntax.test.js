import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function listChecked() {
  const { stdout } = await run(process.execPath, ['scripts/check-syntax.mjs', '--list'], { cwd: root });
  return JSON.parse(stdout);
}

test('syntax check covers every shipped module', async () => {
  const listed = new Set(await listChecked());
  const src = await readdir(path.join(root, 'src'), { withFileTypes: true });
  const expected = src.filter((entry) => entry.isFile() && entry.name.endsWith('.js')).map((entry) => `src/${entry.name}`);
  assert.ok(expected.length >= 10, 'src should contain the shipped host modules');
  for (const file of expected) assert.ok(listed.has(file), `${file} must be syntax-checked`);
  for (const entry of ['index.js', 'client.js']) assert.ok(listed.has(entry), `${entry} must be syntax-checked`);
});

test('syntax check passes for the current tree', async () => {
  const { stdout } = await run(process.execPath, ['scripts/check-syntax.mjs'], { cwd: root });
  assert.match(stdout, /^syntax ok: \d+ files/m);
});
