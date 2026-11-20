import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

test('the context output warns before the JSON when documents were truncated', () => {
  assert.match(source, /documentsTruncated/);
  assert.match(source, /t\("contextTruncated"\)/);
  const handler = source.slice(
    source.indexOf('action: "context"'),
    source.indexOf('action: "export"'),
  );
  assert.ok(handler.length > 0, 'context handler must exist');
  assert.ok(
    handler.indexOf('contextTruncated') < handler.indexOf('JSON.stringify'),
    'the warning must be prepended to the JSON body',
  );
  assert.match(handler, /truncated\.join\(", "\)/);
});

test('the truncation hint exists in Chinese and English', () => {
  assert.match(source, /contextTruncated: \[/);
  const start = source.indexOf('contextTruncated: [');
  const block = source.slice(start, source.indexOf('],', start));
  assert.match(block, /被截断/);
  assert.match(block, /truncated in the context/);
});
