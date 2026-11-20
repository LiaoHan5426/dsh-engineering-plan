import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// A silent CRLF conversion is not cosmetic here: several client tests match source text with
// bare "\n" anchors, and the embedded Mermaid payload is compared byte for byte. A text editor
// or script that rewrites the file with CRLF therefore breaks the suite in ways that look
// unrelated to the edit. This guard makes that failure obvious and local.

const root = new URL('../', import.meta.url);

function sources() {
  const dir = (name) => readdirSync(new URL(name, root)).filter((file) => /\.(js|mjs)$/.test(file)).sort();
  return [
    'index.js',
    'client.js',
    ...dir('src').map((file) => `src/${file}`),
    ...dir('scripts').map((file) => `scripts/${file}`),
    ...dir('tests').map((file) => `tests/${file}`),
  ];
}

test('every JavaScript source is stored with LF line endings', () => {
  const offenders = sources().filter((file) => readFileSync(new URL(file, root), 'utf8').includes('\r'));
  assert.deepEqual(offenders, [], `CRLF found in: ${offenders.join(', ')}`);
});

test('the guard covers the entry points, Host modules and the test suite itself', () => {
  const list = sources();
  assert.ok(list.includes('client.js'));
  assert.ok(list.includes('src/core.js'));
  assert.ok(list.includes('tests/client-gate.test.js'));
  assert.ok(list.length >= 20, `expected a broad sweep, saw ${list.length} files`);
});
