import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Everything the plugin package or its own tooling actually needs at the top level.
// Anything else is an accident (a log, an editor backup, a shell redirect target),
// and stale junk at the root is not harmless: a file whose name is also a Windows
// device name makes directory traversal tools skip the whole tree.
const allowed = new Set([
  '.dsh',
  '.dsh-meow',
  '.git',
  '.gitignore',
  'assets',
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'client.js',
  'cordis.patch.yml',
  'design',
  'docs',
  'icon.svg',
  'index.js',
  'locale',
  'node_modules',
  'package.json',
  'scripts',
  'skills',
  'src',
  'tests',
]);

const deviceNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

test('the repository root holds only expected entries', () => {
  const entries = readdirSync(root).sort();
  const unexpected = entries.filter((entry) => !allowed.has(entry));
  assert.deepEqual(unexpected, [], `Unexpected top-level entries: ${unexpected.join(', ')}`);
});

test('no top-level entry uses a Windows device name', () => {
  const offenders = readdirSync(root).filter((entry) => deviceNames.test(entry));
  assert.deepEqual(offenders, [], `Device-name entries break directory traversal: ${offenders.join(', ')}`);
});

test('the plugin entry points exist and are files', () => {
  for (const [file, minimum] of [['index.js', 1000], ['client.js', 100000], ['package.json', 200]]) {
    const target = join(root, file);
    assert.equal(statSync(target).isFile(), true, `${file} must be a file`);
    assert.ok(statSync(target).size >= minimum, `${file} looks truncated (${statSync(target).size} bytes)`);
  }
});
