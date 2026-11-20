import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const client = readFileSync(join(root, 'client.js'), 'utf8');

test('the export card reports files an earlier export left behind', () => {
  assert.ok(client.includes('const stale = Array.isArray(data?.stale) ? data.stale : [];'));
  assert.ok(client.includes('t("exportStale")'));
  assert.ok(client.includes('t("exportManifest")'));
  // The listing must still be shown even when nothing is stale.
  assert.ok(client.includes('const listing = data.files'));
});

test('both export notices are translated', () => {
  for (const key of ['exportStale', 'exportManifest']) {
    const match = client.match(new RegExp(`^ {6}${key}: \\[([^\\]]+)\\],$`, 'm'));
    assert.ok(match, `${key} must be defined with six-space indentation`);
    const parts = match[1].split(',').map((part) => part.trim().replace(/^"|"$/g, ''));
    assert.equal(parts.length, 2);
    for (const part of parts) assert.ok(part.length > 0);
  }
});
