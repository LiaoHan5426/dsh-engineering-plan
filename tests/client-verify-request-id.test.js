import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'client.js'), 'utf8');

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} must exist`);
  let depth = 0;
  let i = source.indexOf('{', start);
  const from = i;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

const change = { id: 'c1', planVersion: 2, revision: 7 };
const make = () => 'id-' + Math.random().toString(16).slice(2);

test('the same task and command reuse one verification request id', () => {
  const { cachedVerifyRequest } = new Function(`${extract('cachedVerifyRequest')}; return { cachedVerifyRequest };`)();
  const cache = new Map();
  const first = cachedVerifyRequest(cache, change, 'T1', 0, make);
  const again = cachedVerifyRequest(cache, change, 'T1', 0, make);
  assert.equal(first.requestId, again.requestId);
  assert.equal(first.expectedRevision, 7);
  assert.equal(first.planVersion, 2);
  assert.equal(first.commandIndex, 0);
});

test('a different command is a different attempt', () => {
  const { cachedVerifyRequest } = new Function(`${extract('cachedVerifyRequest')}; return { cachedVerifyRequest };`)();
  const cache = new Map();
  const zero = cachedVerifyRequest(cache, change, 'T1', 0, make);
  const one = cachedVerifyRequest(cache, change, 'T1', 1, make);
  assert.notEqual(zero.requestId, one.requestId);
});

test('a new plan version or revision starts a new attempt', () => {
  const { cachedVerifyRequest } = new Function(`${extract('cachedVerifyRequest')}; return { cachedVerifyRequest };`)();
  const cache = new Map();
  const base = cachedVerifyRequest(cache, change, 'T1', 0, make);
  const nextRevision = cachedVerifyRequest(cache, { ...change, revision: 8 }, 'T1', 0, make);
  const nextVersion = cachedVerifyRequest(cache, { ...change, planVersion: 3 }, 'T1', 0, make);
  assert.notEqual(base.requestId, nextRevision.requestId);
  assert.notEqual(base.requestId, nextVersion.requestId);
});

test('the verification payload no longer mints an id per click', () => {
  assert.ok(source.includes('const attempt = cachedVerifyRequest(verifyRequests.current, change, taskId, commandIndex'));
  assert.ok(source.includes('requestId: attempt.requestId'));
  const from = source.indexOf('const payload = {', source.indexOf('const attempt = cachedVerifyRequest'));
  const payload = source.slice(from, source.indexOf('insertChatText(t("executePrompt"', from));
  assert.ok(payload.includes('requestId: attempt.requestId'));
  assert.equal(payload.includes('crypto.randomUUID()'), false);
});

test('the request cache is plugin scoped for both kinds', () => {
  assert.ok(source.includes('React.useRef(requestMapFor(props.sessionId, "dispatch"))'));
  assert.ok(source.includes('React.useRef(requestMapFor(props.sessionId, "verify"))'));
});
