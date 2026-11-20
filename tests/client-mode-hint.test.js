import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function localeEntry(key) {
  const pattern = new RegExp(`\\n\\s{6}${key}: \\[(.*?)\\],\\n`, 's');
  const match = source.match(pattern);
  assert.ok(match, `locale key ${key} is missing`);
  return JSON.parse(`[${match[1]}]`);
}

test('the planning mode hint exists in both languages', () => {
  for (const key of ['modeLiteHint', 'modeStandardHint']) {
    const entry = localeEntry(key);
    assert.equal(entry.length, 2, `${key} must have exactly two strings`);
    for (const text of entry) assert.ok(text.trim().length > 0, `${key} must not be empty`);
    assert.notEqual(entry[0], entry[1], `${key} must differ between Chinese and English`);
  }
});

test('the hint is chosen by the plan mode and rendered under the stats row', () => {
  assert.match(source, /t\(change\.mode === "lite" \? "modeLiteHint" : "modeStandardHint"\)/);
  const stats = source.indexOf('t(change.mode)), t("mode")');
  assert.ok(stats > 0, 'the mode stats cell must still exist');
  const after = source.slice(stats, stats + 400);
  assert.match(after, /modeLiteHint/);
});

test('the hint explains the stale behaviour that lite mode can produce', () => {
  const [zh, en] = localeEntry('modeLiteHint');
  assert.match(zh, /stale/);
  assert.match(en, /stale/);
  const [zhStd] = localeEntry('modeStandardHint');
  assert.match(zhStd, /八篇|全部/);
});
