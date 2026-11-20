import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply, createOperations } from '../index.js';

const ROOT = new URL('..', import.meta.url);
const source = async name => readFile(new URL(name, ROOT), 'utf8');

async function command(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'engineering-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = {
    workingDirectory: { ensure: async agent => path.join(root, agent.id) },
    sandboxPolicy: { resolve: ({ session }) => ({ workspaceRoot: path.join(root, session.id) }) },
    skills: { register: () => () => {} },
    tools: { register: () => () => {} },
    effect: fn => fn(),
  };
  let definition;
  ctx.commands = { register(def) { definition = def; return () => {}; } };
  apply(ctx);
  const agent = { id: 'session', session: { id: 'session' } };
  return async rawInput => definition.handler({ agent, signal: new AbortController().signal, rawInput });
}

test('Host guards carry a code instead of collapsing into ENGINEERING_ERROR', async t => {
  const run = await command(t);

  // An array is not an operation: this refusal comes from index.js, not from core.
  const arrays = await run('[]');
  assert.equal(arrays.kind, 'error');
  assert.equal(arrays.text, 'ENGINEERING_INVALID_INPUT', 'the code must survive on its own, without a duplicated prefix');

  const unknown = await run('{"action":"nope"}');
  assert.equal(unknown.kind, 'error');
  assert.equal(unknown.text, 'ENGINEERING_UNKNOWN_ACTION');

  const missingField = await run('{"action":"acceptDelivery"}');
  assert.equal(missingField.kind, 'error');
  assert.match(missingField.text, /^INVALID_ID: /, 'core refusals keep their own code and detail');
  assert.equal(missingField.text.includes('ENGINEERING_ERROR'), false);
});

test('The human-only guard is a code, not a message', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'engineering-guard-human-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = {
    workingDirectory: { ensure: async agent => path.join(root, agent.id) },
    sandboxPolicy: { resolve: ({ session }) => ({ workspaceRoot: path.join(root, session.id) }) },
  };
  const execute = createOperations(ctx);
  const agent = { id: 'session', session: { id: 'session' } };
  const { change } = await execute({ action: 'create', title: 'Guard', goal: 'Human only' }, agent, 'agent');
  await assert.rejects(
    execute({ action: 'approve', changeId: change.id, expectedRevision: change.revision }, agent, 'agent'),
    error => error.code === 'ENGINEERING_HUMAN_APPROVAL_REQUIRED' && error.message === 'ENGINEERING_HUMAN_APPROVAL_REQUIRED',
    'the refusal must carry its own code so the workbench can translate it',
  );
});

test('Core refusals keep their own code and detail', async t => {
  const run = await command(t);
  const created = JSON.parse((await run('{"action":"create","title":"Guard","goal":"Guard refusal"}')).text).change;
  const conflict = await run(JSON.stringify({ action: 'save', changeId: created.id, expectedRevision: 99, patch: { title: 'Changed' } }));
  assert.equal(conflict.kind, 'error');
  assert.match(conflict.text, /^REVISION_CONFLICT: /, 'core already carries a code; the wrapper must not rewrite it');
});

test('Every guard code has a bilingual sentence, and every mapped key exists', async t => {
  const host = await source('index.js');
  const guards = [...host.matchAll(/fail\('(ENGINEERING_[A-Z_]+)'\)/g)].map(m => m[1]);
  assert.ok(guards.length >= 20, `expected the Host guards to be visible to this gate, found ${guards.length}`);

  const client = await source('client.js');
  const block = client.slice(client.indexOf('/* BEGIN ERROR MESSAGE SUMMARY */'), client.indexOf('/* END ERROR MESSAGE SUMMARY */'));
  assert.ok(block.length > 500, 'the error summary block must be locatable');

  for (const code of new Set(guards)) {
    assert.ok(block.includes(`${code}: "`), `${code} is thrown by the Host but has no locale mapping`);
  }

  const keys = [...block.matchAll(/^\s{2}[A-Z_]+: "(\w+)",$/gm)].map(m => m[1]);
  assert.ok(keys.length >= 20, `expected mapped keys, found ${keys.length}`);
  for (const key of new Set(keys)) {
    const entry = new RegExp(`\\n      ${key}: \\["([^"]+)", "([^"]+)"\\],`);
    const match = client.match(entry);
    assert.ok(match, `${key} is mapped but missing from the words dictionary`);
    assert.ok(match[1].length > 0 && match[2].length > 0, `${key} needs both languages`);
    assert.notEqual(match[1], match[2], `${key} must not reuse the English text for Chinese`);
  }
});

test('A guard code renders as a sentence in the workbench', async t => {
  const client = await source('client.js');
  const block = client.slice(client.indexOf('/* BEGIN ERROR MESSAGE SUMMARY */'), client.indexOf('/* END ERROR MESSAGE SUMMARY */'));
  const words = new Map();
  for (const line of client.split('\n')) {
    const match = line.match(/^      (\w+): \["([^"]*)", "([^"]*)"\],$/);
    if (match) words.set(match[1], match[2]);
  }
  const factory = new Function('words', 't', `${block.replace(/^\/\*.*$/gm, '')}\nreturn { errorDisplay, errorMessageKey };`);
  const translate = key => words.get(key) ?? `missing:${key}`;
  const { errorDisplay, errorMessageKey } = factory(words, translate);

  assert.equal(errorMessageKey('ENGINEERING_RUN_FOREIGN_HOST'), 'errRunForeignHost');
  const rendered = errorDisplay('ENGINEERING_RUN_FOREIGN_HOST');
  assert.match(rendered, /另一个宿主实例/, 'the foreign-host refusal must read as a sentence, not as a code');
  assert.equal(rendered.includes('ENGINEERING_'), false);

  // A code nobody mapped still passes through rather than inventing a translation.
  assert.equal(errorDisplay('SOMETHING_NEW: detail'), 'SOMETHING_NEW: detail');
});
