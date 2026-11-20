import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function block(begin, end) {
  const start = source.indexOf(begin);
  assert.ok(start >= 0, `missing ${begin}`);
  const stop = source.indexOf(end, start);
  assert.ok(stop > start, `missing ${end}`);
  return source.slice(start + begin.length, stop);
}

function extract(name, indent = '          ', async = false) {
  const marker = `${indent}${async ? 'async ' : ''}function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf(`\n${indent}}`, start);
  assert.ok(end > start, `unterminated ${name}`);
  return source.slice(start, end + indent.length + 2);
}

const abandonmentDirty = Function(`return (${extract('abandonmentDirty', '')})`)();
const key = (changeId, kind, runId, revision) => JSON.stringify([changeId, kind, runId, revision]);

test('an abandonment draft counts only for the change it was typed on', () => {
  assert.equal(abandonmentDirty({}, 'a'), false);
  assert.equal(abandonmentDirty({ [key('a', 'verification', 'r1', 3)]: { key: key('a', 'verification', 'r1', 3), reason: 'flaky' } }, 'a'), true);
  assert.equal(abandonmentDirty({ [key('a', 'verification', 'r1', 3)]: { key: key('a', 'verification', 'r1', 3), reason: 'flaky' } }, 'b'), false);
  assert.equal(abandonmentDirty({ [key('a', 'verification', 'r1', 3)]: { key: key('a', 'verification', 'r1', 3), reason: 'flaky' } }, null), false);
});

test('a ticked confirmation is an unsaved edit even without a reason', () => {
  const form = { key: key('a', 'dispatch', 'r2', 1), confirmed: true };
  assert.equal(abandonmentDirty({ [form.key]: form }, 'a'), true);
});

test('an empty or malformed draft does not block anything', () => {
  assert.equal(abandonmentDirty(null, 'a'), false);
  assert.equal(abandonmentDirty(undefined, 'a'), false);
  // Any typed content counts, exactly like the stop draft: a single space is still a human edit.
  assert.equal(abandonmentDirty({ k: { key: key('a', 'verification', 'r1', 3), reason: '   ' } }, 'a'), true);
  assert.equal(abandonmentDirty({ k: { key: key('a', 'verification', 'r1', 3), reason: '', confirmed: false } }, 'a'), false);
  assert.equal(abandonmentDirty({ k: { key: 'not json', reason: 'flaky' } }, 'a'), false);
  assert.equal(abandonmentDirty({ k: { key: JSON.stringify('a'), reason: 'flaky' } }, 'a'), false);
});

const start = source.indexOf('          const runtimeDirty =');
assert.ok(start > 0, 'runtimeDirty not found');
const end = source.indexOf('          const edit =', start);
assert.ok(end > start, 'runtimeDirty end not found');
const runtimeExpression = source.slice(start, end).trim().replace(/^const runtimeDirty =\s*/, '').replace(/;$/, '');
const runtimeDirty = (patch = {}) => Function(
  'transitionDirty', 'evidenceDirty', 'delivery', 'resolution', 'dispatchResolution',
  'cancelRunningDirty', 'cancelRunning', 'abandonmentDirty', 'abandonment', 'change',
  `return (${runtimeExpression});`)(
  false, false, {}, {}, {}, () => false, {}, abandonmentDirty, patch.abandonment || {}, patch.change || { id: 'a' });

test('the abandonment draft joins the shared unsaved-input protection', () => {
  const form = { key: key('a', 'verification', 'r1', 3), reason: 'flaky', confirmed: true };
  assert.equal(runtimeDirty({ abandonment: { [form.key]: form }, change: { id: 'a' } }), true);
  assert.equal(runtimeDirty({ abandonment: { [form.key]: form }, change: { id: 'b' } }), false);
  assert.equal(runtimeDirty({}), false, 'nothing typed, nothing dirty');
});

test('the draft is cached, restored and copied like the stop draft', () => {
  const cache = source.slice(source.indexOf('draftCache.set(props.sessionId'), source.indexOf('}, [change, draft, dirty, taskEdit, reference, transition, evidence, resolution, dispatchResolution, cancelRunning, abandonment, delivery]);'));
  assert.match(cache, /^\s+abandonment,$/m);
  assert.match(cache, /^\s+delivery,$/m);
  assert.match(source, /\}, \[change, draft, dirty, taskEdit, reference, transition, evidence, resolution, dispatchResolution, cancelRunning, abandonment, delivery\]\);/);
  assert.match(source, /if \(cached\.abandonment\) setAbandonment\(cached\.abandonment\);/);
});

test('the copy payload carries the abandonment draft so it can be reproduced', () => {
  const copy = source.slice(source.lastIndexOf('button("copyDraft", () =>'), source.length);
  assert.match(copy.slice(0, 400), /\{ draft, taskEdit, reference, transition, evidence, resolution, dispatchResolution, abandonment, delivery \}/);
});

test('the plan draft and the run drafts are each cleared by their own rule', () => {
  const ls = source.slice(source.indexOf('          const loadChange = '), source.indexOf('          async function command('));
  assert.match(ls, /if \(abandonedKey\) setAbandonment\(\(previous\) => Object\.fromEntries\(Object\.entries\(previous\)\.filter\(\(\[key\]\) => key !== abandonedKey\)\)\);/);
  assert.match(ls, /else if \(!preserveRuntime\) setAbandonment\(\{\}\);/);
});
