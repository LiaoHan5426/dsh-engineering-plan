import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const start = source.indexOf('const words = {');
const end = source.indexOf('\n      };', start);
const wordsBlock = source.slice(start, end);

test('every translation key carries a non-empty Chinese and English string', () => {
  const entries = [...wordsBlock.matchAll(/^ {6}(\w+): \[([\s\S]*?)\],$/gm)];
  assert.ok(entries.length > 200, `expected many keys, saw ${entries.length}`);
  const bad = [];
  for (const [, key, body] of entries) {
    const parts = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
    if (parts.length !== 2) bad.push(`${key}: ${parts.length} strings`);
    else if (parts.some((p) => p.trim() === '')) bad.push(`${key}: empty string`);
  }
  assert.deepEqual(bad, []);
});

test('every t("key") used in the client resolves to a defined key', () => {
  const defined = new Set(
    [...wordsBlock.matchAll(/^ {6}(\w+): \[/gm)].map((m) => m[1]),
  );
  const used = new Set(
    [...source.matchAll(/\bt\(\s*"([a-zA-Z][\w]*)"\s*[,)]/g)].map((m) => m[1]),
  );
  const missing = [...used].filter((key) => !defined.has(key)).sort();
  assert.deepEqual(missing, []);
});

test('keys passed to t() through variables exist for every rendered enumeration', () => {
  const defined = new Set(
    [...wordsBlock.matchAll(/^ {6}(\w+): \[/gm)].map((m) => m[1]),
  );
  const enumerated = [
    // task states
    'pending', 'running', 'verifying', 'blocked', 'failed', 'completed', 'cancelled',
    // plan modes
    'lite', 'standard',
    // planning sections
    'requirements', 'analysis', 'architecture', 'interfaces', 'tasks', 'acceptance',
    // workbench tabs
    'overview', 'plan', 'resources',
    // mermaid sources
    'sequence',
  ];
  const missing = enumerated.filter((key) => !defined.has(key));
  assert.deepEqual(missing, []);
});
