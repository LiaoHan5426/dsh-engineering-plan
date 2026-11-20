import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function slice(start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing anchor: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing end anchor: ${end}`);
  return source.slice(from, to + end.length);
}

test('request ids live outside the component so a remount reuses them', () => {
  assert.match(source, /const requestMaps = new Map\(\);/);
  assert.match(source, /function requestMapFor\(sessionId, kind\)/);
  assert.match(source, /React\.useRef\(requestMapFor\(props\.sessionId, "dispatch"\)\)/);
  // The per-session maps must be dropped with the plugin, not leaked for the life of the app.
  const cleanup = slice('ctx.effect(() => () => {', 'requestMaps.clear();');
  assert.ok(cleanup.includes('draftCache.clear();'));
});

test('a cached payload is keyed by change, plan version, revision and task', () => {
  const fn = slice('function cachedDispatchRequest(', 'return cache.get(key);');
  assert.match(fn, /JSON\.stringify\(\[change\.id, change\.planVersion, change\.revision, taskId\]\)/);
  assert.match(fn, /if \(!cache\.has\(key\)\) cache\.set\(key, \{/);
  assert.match(fn, /requestId: makeId\(\)/);
});

test('the request id is minted once per cache entry, not per click', () => {
  const fn = slice('function nativeDispatchRequest(', '}');
  assert.match(fn, /cachedDispatchRequest\(dispatchRequests\.current, change, taskId, \(\) => crypto\.randomUUID\(\)\)/);
  assert.doesNotMatch(fn, /requestId: crypto\.randomUUID\(\)/);
});

test('the request maps are no longer created per component instance', () => {
  assert.equal(source.includes('dispatchRequests = React.useRef(new Map())'), false);
  assert.equal(source.includes('gitRequests = React.useRef(new Map())'), false);
  // The one remaining per-component Map is task-detail expansion state, not a request id.
  const perComponent = source.split('React.useRef(new Map())').length - 1;
  assert.equal(perComponent, 1);
  assert.ok(source.includes('const taskDetails = React.useRef(new Map());'));
});
