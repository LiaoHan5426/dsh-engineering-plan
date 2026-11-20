import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EngineeringStore } from '../src/core.js';
import { GitObservationStore } from '../src/git-observation-store.js';

const ACTOR = { kind: 'user', id: 'scope-test' };

async function workspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'engineering-scope-'));
}

async function change(store, id) {
  return (await store.execute({ action: 'create', changeId: id, title: 'Scope audit', goal: 'Prove read-only scope auditing', mode: 'lite' }, ACTOR)).change;
}

/** Persist an observation through its own store so the audit reads canonical facts. */
async function observation(root, changeId, record) {
  const store = new GitObservationStore(root);
  const id = record.id ?? '11111111-1111-4111-8111-111111111111';
  const facts = {
    schemaVersion: 1, id, changeId, planVersion: 1, sourceRevision: 1,
    actor: { kind: 'agent', id: 'agent-1' },
    capturedAt: '2026-11-20T00:00:00.000Z', finishedAt: record.finishedAt ?? '2026-11-20T00:00:01.000Z',
    workspaceRoot: root, repositoryRoot: root.split(path.sep).join('/'),
    collectorVersion: 'git-observation-v1', status: 'ok', head: 'a'.repeat(40), headState: 'commit',
    dirty: true, scope: { tracked: 'git-diff', untracked: 'paths-only', ignored: 'excluded', excludedPaths: ['.dsh/engineering/**'] },
    stagedDiffSha256: 'b'.repeat(64), worktreeDiffSha256: 'c'.repeat(64),
    untrackedPathsSha256: createHash('sha256').update('').digest('hex'), untrackedCount: 0,
    changedPaths: record.changedPaths ?? null, untrackedPaths: record.untrackedPaths ?? null,
    limitations: [], error: null,
  };
  await store.create(changeId, facts, { requestId: `scope-${id}`, ownerSessionId: 'session-scope-test' });
  return id;
}

test('an audit attributes changed paths to the declaring task and lists the rest', async () => {
  const root = await workspace();
  const store = new EngineeringStore(root);
  const id = '22222222-2222-4222-8222-222222222222';
  const created = await change(store, id);
  await store.execute({
    action: 'save', changeId: id, expectedRevision: created.revision,
    patch: {
      tasks: [
        { id: 'CORE', title: 'Core', dependencies: [], expectedFiles: ['src/core.js'], acceptanceCriteria: ['ok'], verificationCommands: ['echo ok'] },
        { id: 'UI', title: 'Ui', dependencies: ['CORE'], expectedFiles: ['client.js'], acceptanceCriteria: ['ok'], verificationCommands: ['echo ok'] },
      ],
    },
  }, ACTOR);
  await observation(root, id, { changedPaths: ['src/core.js', 'docs/a.md', 'package.json'] });

  const result = await store.execute({ action: 'scopeAudit', changeId: id }, ACTOR);
  assert.equal(result.state, 'compared');
  assert.deepEqual(result.audit.undeclared, ['docs/a.md', 'package.json']);
  assert.deepEqual(result.audit.entries.map((entry) => [entry.path, entry.declaredBy]),
    [['docs/a.md', []], ['package.json', []], ['src/core.js', ['CORE']]]);
  assert.equal(result.audit.untouched.filter((item) => item.taskId === 'UI').length, 1);
});

test('the audit never writes: revision and state bytes are unchanged', async () => {
  const root = await workspace();
  const store = new EngineeringStore(root);
  const id = '33333333-3333-4333-8333-333333333333';
  await change(store, id);
  await observation(root, id, { changedPaths: ['a.js'] });
  const file = path.join(root, '.dsh', 'engineering', 'changes', id, 'state.json');
  const before = await fs.readFile(file, 'utf8');
  await store.execute({ action: 'scopeAudit', changeId: id }, ACTOR);
  assert.equal(await fs.readFile(file, 'utf8'), before);
});

test('missing or partial observations are reported explicitly instead of guessing', async () => {
  const root = await workspace();
  const store = new EngineeringStore(root);
  const id = '44444444-4444-4444-8444-444444444444';
  await change(store, id);

  const none = await store.execute({ action: 'scopeAudit', changeId: id }, ACTOR);
  assert.equal(none.state, 'no_observation');
  assert.equal(none.audit, null);

  // An older observation without retained path lists cannot be audited.
  const legacy = await observation(root, id, {});
  const partial = await store.execute({ action: 'scopeAudit', changeId: id, observationId: legacy }, ACTOR);
  assert.equal(partial.state, 'observation_incomplete');
  assert.equal(partial.audit, null);
});

test('the newest observation is audited unless one is named', async () => {
  const root = await workspace();
  const store = new EngineeringStore(root);
  const id = '55555555-5555-4555-8555-555555555555';
  await change(store, id);
  await observation(root, id, { id: '66666666-6666-4666-8666-666666666666', changedPaths: ['old.js'] });
  await observation(root, id, { id: '77777777-7777-4777-8777-777777777777', changedPaths: ['new.js'],
    finishedAt: '2026-11-20T01:00:00.000Z' });

  const newest = await store.execute({ action: 'scopeAudit', changeId: id }, ACTOR);
  assert.deepEqual(newest.audit.undeclared, ['new.js']);

  const named = await store.execute({ action: 'scopeAudit', changeId: id, observationId: '66666666-6666-4666-8666-666666666666' }, ACTOR);
  assert.deepEqual(named.audit.undeclared, ['old.js']);
});

test('unknown or foreign observations fail closed rather than audit the wrong change', async () => {
  const root = await workspace();
  const store = new EngineeringStore(root);
  const id = '88888888-8888-4888-8888-888888888888';
  await change(store, id);
  await observation(root, id, { changedPaths: ['a.js'] });
  const missing = await store.execute({ action: 'scopeAudit', changeId: id, observationId: '99999999-9999-4999-8999-999999999999' }, ACTOR);
  assert.equal(missing.state, 'no_observation');
  await assert.rejects(
    store.execute({ action: 'scopeAudit', changeId: id, expectedRevision: 1 }, ACTOR),
    (error) => /Invalid|scope audit/i.test(String(error.message)),
  );
});

test('the plan contract rejects a directory declaration before it can reach the audit', async t => {
  const root = await workspace();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  const created = await change(store, '22222222-2222-4222-8222-222222222222');
  // A trailing slash now declares a directory, and the audit attributes files under it.
  const saved = await store.execute({
    action: 'save', changeId: created.id, expectedRevision: created.revision,
    patch: { tasks: [{ id: 'DOCS', title: 'Docs', description: '', dependencies: [], expectedFiles: ['docs/'], acceptanceCriteria: ['x'], verificationCommands: ['echo x'] }] },
  }, ACTOR);
  assert.deepEqual(saved.change.tasks[0].expectedFiles, ['docs/']);
  await observation(root, created.id, { changedPaths: ['docs/a.md', 'docs/deep/b.md', 'src/z.js'] });
  const result = await store.execute({ action: 'scopeAudit', changeId: created.id }, ACTOR);
  assert.deepEqual(result.audit.undeclared, ['src/z.js']);
  assert.deepEqual(result.audit.untouched, []);
});
