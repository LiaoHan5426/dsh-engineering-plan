import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const anchor = source.indexOf('.ep-layout');
const start = source.lastIndexOf('`', anchor);
const end = source.indexOf('`', anchor);
const css = source.slice(start + 1, end);

test('the workbench stylesheet is found and non-trivial', () => {
  assert.ok(anchor > 0, '.ep-layout rule must exist');
  assert.ok(css.length > 2000, `stylesheet looks too small: ${css.length}`);
});

test('no hardcoded colours, so light and dark themes both come from DSH tokens', () => {
  const hex = [...new Set([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]))];
  const rgb = [...new Set([...css.matchAll(/rgba?\([^)]*\)/g)].map((m) => m[0]))];
  const named = [...new Set(
    [...css.matchAll(/:\s*(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple)\b/g)]
      .map((m) => m[1]),
  )];
  assert.deepEqual({ hex, rgb, named }, { hex: [], rgb: [], named: [] });
});

test('the stylesheet uses DSH alias tokens for surfaces and text', () => {
  const vars = new Set([...css.matchAll(/var\(--dsw-[a-z0-9-]+\)/g)].map((m) => m[0]));
  for (const required of [
    'var(--dsw-alias-bg-base)',
    'var(--dsw-alias-bg-layer-1)',
    'var(--dsw-alias-label-primary)',
    'var(--dsw-alias-border-l1)',
    'var(--dsw-alias-brand-primary)',
  ]) {
    assert.ok(vars.has(required), `missing ${required}`);
  }
});
