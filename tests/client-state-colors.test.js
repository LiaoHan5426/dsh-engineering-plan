import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function styleBlock() {
  const blocks = [...source.matchAll(/`([^`]*)`/g)].map((match) => match[1]);
  const candidates = blocks.filter((block) => block.includes('.ep-badge{'));
  assert.equal(candidates.length, 1, 'exactly one style block defines .ep-badge');
  return candidates[0];
}

const css = styleBlock();

test('state tokens are never used as text colour', () => {
  const offenders = [...css.matchAll(/(?<!border-)color:\s*var\(--dsw-alias-state-[a-z-]+\)/g)].map((m) => m[0]);
  assert.deepEqual(offenders, [], 'warning/success/error tokens fail contrast on the light surface');
});

test('warning, success and error classes keep primary label colour', () => {
  assert.match(css, /\.ep-error,\.ep-success,\.ep-warn\{color:var\(--dsw-alias-label-primary\)\}/);
});

test('state classes still communicate state through border and tint', () => {
  for (const state of ['error', 'success', 'warn']) {
    assert.ok(
      css.includes(`.ep-${state}{border-color:var(--dsw-alias-state-${state}-primary)`),
      `.ep-${state} must carry a state border`,
    );
  }
  assert.ok(
    css.includes('color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)'),
    'warning tint must derive from the theme token',
  );
});

test('state classes do not hardcode colours', () => {
  const block = css.slice(css.indexOf('.ep-error,.ep-success'));
  const window = block.slice(0, 600);
  assert.doesNotMatch(window, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(window, /rgba?\(/);
});
