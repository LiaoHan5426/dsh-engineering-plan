import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EngineeringStore } from '../src/core.js';
import { VerificationRunStore } from '../src/verification-store.js';

const user = { kind: 'user', id: 'reviewer' };
const task = (id, dependencies = [], expectedFiles = [`src/${id}.js`]) => ({ id, title: id, description: '', dependencies, expectedFiles, acceptanceCriteria: ['works', 'tested'], verificationCommands: ['echo never execute'] });
async function fixture(t, mode = 'lite') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-core-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new EngineeringStore(root);
  let state = (await store.execute({ action: 'create', title: 'Plan', goal: 'Deliver', mode })).change;
  return { root, store, get state() { return state; }, async do(action, fields = {}, actor) { const result = await store.execute({ action, changeId: state.id, expectedRevision: state.revision, ...fields }, actor); if (result.change) state = result.change; return result; } };
}
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code && e instanceof Error);
async function approve(f, tasks = [task('a')]) { await f.do('save', { patch: { tasks } }); await f.do('approve', {}, user); }
async function complete(f, id) {
  await f.do('transition', { taskId: id, status: 'running' });
  await f.do('transition', { taskId: id, status: 'verifying' });
  for (const criterion of ['works', 'tested']) await f.do('evidence', { taskId: id, criterion, outcome: 'passed', note: 'Reported by fixture', artifact: 'fixture.log' });
  await f.do('transition', { taskId: id, status: 'completed' });
}

test('create/list/get and revision requirements', async t => {
  const f = await fixture(t);
  assert.equal(f.state.revision, 1); assert.equal(f.state.planVersion, 1);
  assert.equal((await f.store.execute({ action: 'list' })).changes[0].id, f.state.id);
  assert.deepEqual((await f.store.execute({ action: 'get', changeId: f.state.id })).change, f.state);
  await rejects(f.store.execute({ action: 'save', changeId: f.state.id, patch: {} }), 'REVISION_REQUIRED');
  await rejects(f.do('save', { expectedRevision: 99, patch: {} }), 'REVISION_CONFLICT');
  await rejects(f.do('approve', {}, user), 'INCOMPLETE_PLAN');
});

test('workbench creation ID links an exact change and concurrent creation cannot replace it', async t => {
  const { store } = await fixture(t);
  const changeId = '0a85b645-c4da-4e36-ae1d-687a3f517e98';
  const request = { action: 'create', changeId, title: 'Linked plan', goal: 'Deliver' };
  const results = await Promise.allSettled([store.execute(request), store.execute(request)]);
  const created = results.find(result => result.status === 'fulfilled').value.change;
  assert.equal(created.id, changeId);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'CHANGE_EXISTS');
  assert.deepEqual((await store.execute({ action: 'get', changeId })).change, created);
  await rejects(store.execute({ ...request, changeId: '../other' }), 'INVALID_INPUT');
});

test('concurrent saves serialize across store instances', async t => {
  const f = await fixture(t);
  const input = { action: 'save', changeId: f.state.id, expectedRevision: f.state.revision, patch: { title: 'Winner' } };
  const results = await Promise.allSettled([f.store.execute(input), new EngineeringStore(f.root).execute(input)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
});

test('file locks serialize separate Node processes', async t => {
  const f = await fixture(t);
  const moduleURL = new URL('../src/core.js', import.meta.url).href;
  const input = { action: 'save', changeId: f.state.id, expectedRevision: f.state.revision, patch: { title: 'Child' } };
  const script = `import { EngineeringStore } from ${JSON.stringify(moduleURL)}; try { await new EngineeringStore(${JSON.stringify(f.root)}).execute(${JSON.stringify(input)}); console.log('ok'); } catch(e) { console.error(e.stack); console.log(e.code); }`;
  function run() { return new Promise((resolve, reject) => { const child = spawn(process.execPath, ['--input-type=module', '-e', script]); let output = '', stderr = ''; child.stdout.on('data', v => output += v); child.stderr.on('data', v => stderr += v); child.on('error', reject); child.on('close', code => { if (stderr && output.trim() !== 'REVISION_CONFLICT') t.diagnostic(stderr); code ? reject(new Error(`exit ${code}: ${stderr}`)) : resolve(output.trim()); }); }); }
  assert.deepEqual((await Promise.all([run(), run()])).sort(), ['REVISION_CONFLICT', 'ok']);
});

test('lock release between exclusive open and lstat retries acquisition before CAS', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const moduleURL = new URL('../src/core.js', import.meta.url).href;
  const input = { action: 'save', changeId: f.state.id, expectedRevision: f.state.revision, patch: { title: 'Holder' } };
  function start(role) {
    // Real filesystem operations in separate processes; IPC only fixes their ordering.
    const script = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      const role = ${JSON.stringify(role)};
      const pause = async () => {
        const resumed = new Promise(resolve => process.once('message', resolve));
        process.send(role);
        await resumed;
      };
      if (role === 'holder') {
        const rename = fs.rename;
        fs.rename = async (...args) => {
          if (String(args[1]).endsWith('state.json')) await pause();
          return rename(...args);
        };
      } else {
        const lstat = fs.lstat;
        let paused = false;
        fs.lstat = async (...args) => {
          if (!paused && String(args[0]).endsWith('.lock')) { paused = true; await pause(); }
          return lstat(...args);
        };
      }
      syncBuiltinESMExports();
      const { EngineeringStore } = await import(${JSON.stringify(moduleURL)});
      try {
        await new EngineeringStore(${JSON.stringify(f.root)}).execute(${JSON.stringify(input)});
        console.log(JSON.stringify({ code: 'ok' }));
      } catch (e) { console.log(JSON.stringify({ code: e.code, stack: e.stack })); }
      finally { process.disconnect(); }
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => stdout += value);
    child.stderr.on('data', value => stderr += value);
    const paused = new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('error', reject);
      child.once('close', () => reject(new Error(`Child exited before pause: ${stdout} ${stderr}`)));
    });
    const result = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => {
        try { assert.equal(code, 0, stderr); resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    });
    return { child, paused, result };
  }
  const holder = start('holder');
  assert.equal(await holder.paused, 'holder');
  const waiter = start('waiter');
  assert.equal(await waiter.paused, 'waiter');
  holder.child.send('resume');
  assert.equal((await holder.result).code, 'ok');
  // The real holder has renamed state.json, closed its handle and unlinked .lock.
  waiter.child.send('resume');
  const result = await waiter.result;
  assert.equal(result.code, 'REVISION_CONFLICT', result.stack);
  const change = (await f.store.execute({ action: 'get', changeId: f.state.id })).change;
  assert.equal(change.revision, f.state.revision + 1);
  assert.equal(change.title, 'Holder');
});

test('contended locks still reject hardlinks and directories without removing them', async t => {
  const f = await fixture(t);
  const lock = path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, '.lock');
  const original = path.join(f.root, 'lock-target');
  await fs.writeFile(original, 'untouched');
  await fs.link(original, lock);
  await rejects(f.do('save', { patch: { title: 'Blocked' } }), 'PATH_UNSAFE');
  assert.equal(await fs.readFile(original, 'utf8'), 'untouched');
  assert.equal((await fs.lstat(lock)).nlink, 2);
  await fs.unlink(lock);
  await fs.mkdir(lock);
  await rejects(f.do('save', { patch: { title: 'Blocked' } }), 'PATH_UNSAFE');
  assert.equal((await fs.lstat(lock)).isDirectory(), true);
  await fs.rmdir(lock);
  await f.do('save', { patch: { title: 'Valid' } });
  assert.equal(f.state.revision, 2);
});

test('validate DAG, unique ids, dependencies and criteria', async t => {
  const f = await fixture(t);
  await rejects(f.do('save', { patch: { tasks: [task('a', ['b']), task('b', ['a'])] } }), 'TASK_CYCLE');
  await rejects(f.do('save', { patch: { tasks: [task('a'), task('a')] } }), 'INVALID_TASKS');
  await rejects(f.do('save', { patch: { tasks: [task('a', ['missing'])] } }), 'INVALID_TASKS');
  await rejects(f.do('save', { patch: { tasks: [{ ...task('a'), acceptanceCriteria: ['x', 'x'] }] } }), 'INVALID_TASKS');
  await rejects(f.do('save', { patch: { documents: { unknown: 'x' } } }), 'INVALID_INPUT');
  await rejects(f.do('save', { patch: { title: 'x'.repeat(301) } }), 'INVALID_INPUT');
});

test('approval authority, dependency and evidence gates', async t => {
  const f = await fixture(t);
  await f.do('save', { patch: { tasks: [task('a'), task('b', ['a'])] } });
  await rejects(f.do('approve'), 'FORBIDDEN');
  await rejects(f.do('transition', { taskId: 'a', status: 'running' }), 'APPROVAL_REQUIRED');
  await f.do('approve', {}, user);
  await rejects(f.do('transition', { taskId: 'b', status: 'running' }), 'DEPENDENCY_BLOCKED');
  await rejects(f.do('evidence', { taskId: 'a', criterion: 'works', outcome: 'passed', note: 'Fixture observation' }), 'INVALID_STATE');
  await f.do('transition', { taskId: 'a', status: 'running' });
  await rejects(f.do('transition', { taskId: 'a', status: 'completed' }), 'INVALID_TRANSITION');
  await f.do('transition', { taskId: 'a', status: 'verifying' });
  await rejects(f.do('transition', { taskId: 'a', status: 'completed' }), 'EVIDENCE_REQUIRED');
  await f.do('evidence', { taskId: 'a', criterion: 'works', outcome: 'passed', note: 'Fixture observation' });
  await f.do('evidence', { taskId: 'a', criterion: 'tested', outcome: 'passed', note: 'Fixture observation' });
  await f.do('evidence', { taskId: 'a', criterion: 'tested', outcome: 'failed', note: 'Fixture failure observation' });
  await rejects(f.do('transition', { taskId: 'a', status: 'completed' }), 'EVIDENCE_REQUIRED');
  await f.do('evidence', { taskId: 'a', criterion: 'tested', outcome: 'passed', note: 'Fixture observation' });
  assert.deepEqual(f.state.tasks[0].evidence.at(-1).actor, { kind: 'agent', id: 'anonymous' });
  await f.do('transition', { taskId: 'a', status: 'completed' });
  await complete(f, 'b'); assert.equal(f.state.status, 'completed');
});

test('file exclusion holds through verification, blocked requires reason', async t => {
  const f = await fixture(t);
  await approve(f, [task('a', [], ['src/shared.js']), task('b', [], ['SRC/shared.js'])]);
  await f.do('transition', { taskId: 'a', status: 'running' });
  await f.do('transition', { taskId: 'a', status: 'verifying' });
  await rejects(f.do('transition', { taskId: 'b', status: 'running' }), 'FILE_CONFLICT');
  await rejects(f.do('transition', { taskId: 'a', status: 'blocked' }), 'INVALID_INPUT');
  await f.do('transition', { taskId: 'a', status: 'blocked', reason: 'Need input' });
  assert.equal(f.state.tasks[0].reason, 'Need input');
  await f.do('transition', { taskId: 'b', status: 'running' });
  await rejects(f.do('save', { patch: { goal: 'Changed' } }), 'PLAN_LOCKED');
});

test('approved plan edit invalidates version and approval; drafts retain version', async t => {
  const f = await fixture(t); await approve(f);
  await f.do('save', { patch: { goal: 'New goal' } });
  assert.equal(f.state.planVersion, 2); assert.equal(f.state.status, 'draft');
  assert.deepEqual(f.state.approvals, []); assert.deepEqual(f.state.evidence, []);
  assert.equal(f.state.tasks[0].status, 'pending'); assert.deepEqual(f.state.tasks[0].evidence, []);
  assert.equal(f.state.history[0].kind, 'plan-invalidated');
  assert.equal(f.state.history[0].snapshot.approvals[0].planVersion, 1);
  assert.equal(f.state.history[0].snapshot.goal, 'Deliver');
  await rejects(f.do('transition', { taskId: 'a', status: 'running' }), 'APPROVAL_REQUIRED');
  await f.do('save', { patch: { title: 'New title' } }); assert.equal(f.state.planVersion, 2);
  await f.do('approve', {}, user); assert.equal(f.state.approvals[0].planVersion, 2);
});

test('rerunning clears prior evidence', async t => {
  const f = await fixture(t); await approve(f);
  await f.do('transition', { taskId: 'a', status: 'running' });
  await f.do('transition', { taskId: 'a', status: 'verifying' });
  await f.do('evidence', { taskId: 'a', criterion: 'works', outcome: 'passed', note: 'Fixture observation' });
  await f.do('transition', { taskId: 'a', status: 'running' });
  assert.equal(f.state.tasks[0].evidence.length, 0); assert.equal(f.state.evidence.length, 0);
  assert.equal(f.state.history[0].kind, 'task-restarted'); assert.equal(f.state.history[0].evidence[0].outcome, 'passed');
});

test('path traversal and links are rejected', async t => {
  const f = await fixture(t);
  for (const changeId of ['../escape', '..', '/tmp/x', 'C:\\escape', 'a/b']) await rejects(f.store.execute({ action: 'get', changeId }), 'INVALID_ID');
  for (const expected of ['../x', '/x', 'C:\\x', 'a/../b', 'a\\..\\b', 'nul', 'a:stream']) await rejects(f.do('save', { patch: { tasks: [task('a', [], [expected])] } }), 'PATH_UNSAFE');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-link-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const linked = path.join(f.root, '.dsh', 'engineering', 'changes', 'linked');
  await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await rejects(f.store.execute({ action: 'get', changeId: 'linked' }), 'PATH_UNSAFE');
  const listed = await f.store.execute({ action: 'list' });
  assert.equal(listed.changes.length, 1);
  assert.equal(listed.warnings.find(w => w.changeId === 'linked').code, 'PATH_UNSAFE');
});

test('state and export hardlinks cannot overwrite unrelated files', async t => {
  const f = await fixture(t);
  const directory = path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id);
  const original = path.join(f.root, 'original.txt'); await fs.writeFile(original, 'untouched');
  await fs.link(original, path.join(directory, 'proposal.md'));
  await rejects(f.do('export'), 'PATH_UNSAFE');
  assert.equal(await fs.readFile(original, 'utf8'), 'untouched');
  await fs.unlink(path.join(directory, 'state.json')); await fs.link(original, path.join(directory, 'state.json'));
  await rejects(f.store.execute({ action: 'get', changeId: f.state.id }), 'PATH_UNSAFE');
});

test('restore context and rebuild standard exports solely from state', async t => {
  const f = await fixture(t, 'standard');
  await f.do('save', { patch: { documents: { proposal: '# Proposal\nSource of truth' }, references: [{ id: 'eap', title: 'EAP', source: 'EAP.md', kind: 'reference', note: 'Reference only' }], tasks: [task('a')] } });
  const restored = new EngineeringStore(f.root);
  const context = await restored.execute({ action: 'context', changeId: f.state.id });
  assert.equal(context.references[0].kind, 'reference'); assert.equal(context.tasks[0].status, 'pending');
  await rejects(restored.execute({ action: 'export', changeId: f.state.id }), 'REVISION_REQUIRED');
  let result = await f.do('export'); assert.equal(result.files.length, 14);
  assert.equal(result.change.revision, f.state.revision);
  const proposal = result.files.find(p => p.endsWith('proposal.md'));
  await fs.writeFile(proposal, 'derived corruption');
  result = await restored.execute({ action: 'export', changeId: f.state.id, expectedRevision: f.state.revision });
  assert.equal(await fs.readFile(proposal, 'utf8'), '# Proposal\nSource of truth');
  assert.deepEqual(JSON.parse(await fs.readFile(result.files.find(p => p.endsWith('tasks.json')), 'utf8')), f.state.tasks);
});

test('empty lite export writes only five required projections and preserves state', async t => {
  const f = await fixture(t);
  await f.do('save', { patch: { documents: { requirements: ' \n\t' }, diagrams: { architecture: ' \n\t' } } });
  const before = structuredClone(f.state);
  const directory = path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id);
  const stateBefore = await fs.readFile(path.join(directory, 'state.json'), 'utf8');
  const result = await f.do('export');
  assert.deepEqual(result.files.map(file => path.relative(directory, file)).sort(), ['acceptance.md', 'implementation.md', 'progress.md', 'proposal.md', 'tasks.json']);
  assert.deepEqual(await fs.readdir(directory).then(files => files.sort()), ['acceptance.md', 'implementation.md', 'manifest.json', 'progress.md', 'proposal.md', 'state.json', 'tasks.json']);
  assert.deepEqual(result.change, before);
  assert.equal(await fs.readFile(path.join(directory, 'state.json'), 'utf8'), stateBefore);
  assert.equal(await fs.readFile(path.join(directory, 'proposal.md'), 'utf8'), '');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'tasks.json'), 'utf8')), []);
});

test('lite export includes nonempty optional documents and diagrams without trimming content', async t => {
  const f = await fixture(t);
  const documents = Object.fromEntries(['requirements', 'architecture', 'impact-analysis', 'decisions', 'findings'].map(key => [key, `  ${key}\n`]));
  const diagrams = { architecture: '  flowchart LR\n A --> B\n', sequence: 'sequenceDiagram\n A->>B: Hi\n', 'data-flow': 'flowchart TD\n A --> B\n' };
  await f.do('save', { patch: { documents, diagrams } });
  const result = await f.do('export');
  assert.equal(result.files.length, 13);
  assert.equal(result.files.some(file => file.endsWith('task-dag.mmd')), false);
  for (const [key, value] of Object.entries(documents)) assert.equal(await fs.readFile(result.files.find(file => file.endsWith(`${key}.md`)), 'utf8'), value);
  for (const [key, value] of Object.entries(diagrams)) assert.equal(await fs.readFile(result.files.find(file => file.endsWith(`${key}.mmd`)), 'utf8'), value);
  await f.do('save', { patch: { tasks: [task('a')] } });
  assert.equal((await f.do('export')).files.length, 14);
});

test('lite export retains old optional projections and reports only current writes', async t => {
  const f = await fixture(t);
  await f.do('save', { patch: { documents: { findings: 'Original findings' }, diagrams: { sequence: 'sequenceDiagram' }, tasks: [task('a')] } });
  const previous = await f.do('export');
  const retained = previous.files.filter(file => /findings\.md$|sequence\.mmd$|task-dag\.mmd$/.test(file));
  assert.equal(retained.length, 3);
  const contents = await Promise.all(retained.map(file => fs.readFile(file, 'utf8')));
  await f.do('save', { patch: { documents: { findings: '' }, diagrams: { sequence: '' }, tasks: [] } });
  const result = await f.do('export');
  assert.equal(result.files.length, 5);
  assert.equal(retained.some(file => result.files.includes(file)), false);
  assert.deepEqual(await Promise.all(retained.map(file => fs.readFile(file, 'utf8'))), contents);
  assert.equal(result.change.documents.findings, '');
  assert.equal(result.change.diagrams.sequence, '');
});

test('empty standard export retains all fourteen projections', async t => {
  const f = await fixture(t, 'standard');
  const result = await f.do('export');
  const directory = path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id);
  assert.deepEqual(result.files.map(file => path.relative(directory, file).replaceAll(path.sep, '/')).sort(), [
    'acceptance.md', 'architecture.md', 'decisions.md', 'diagrams/architecture.mmd', 'diagrams/data-flow.mmd',
    'diagrams/sequence.mmd', 'diagrams/task-dag.mmd', 'findings.md', 'impact-analysis.md', 'implementation.md',
    'progress.md', 'proposal.md', 'requirements.md', 'tasks.json'
  ]);
  assert.equal(await fs.readFile(path.join(directory, 'diagrams', 'architecture.mmd'), 'utf8'), '');
});

test('diagram export maps ids and escapes labels', async t => {
  const f = await fixture(t);
  await f.do('save', { patch: { diagrams: { architecture: 'flowchart LR\n A --> B\n' }, tasks: [{ ...task('a'), title: 'A" <script> & `label`' }, task('b', ['a'])] } });
  const result = await f.do('export');
  assert.equal(await fs.readFile(result.files.find(p => p.endsWith('architecture.mmd')), 'utf8'), 'flowchart LR\n A --> B\n');
  const dag = await fs.readFile(result.files.find(p => p.endsWith('task-dag.mmd')), 'utf8');
  assert.match(dag, /task0 --> task1/); assert.match(dag, /&quot;/); assert.doesNotMatch(dag, /<script>/);
  assert.match(dag, /task0\["[^"]*<br\/>pending"\]/);
  await rejects(f.do('save', { patch: { diagrams: { bad: 'x' } } }), 'INVALID_INPUT');
});

test('started plans stay locked after task resets', async t => {
  const f = await fixture(t); await approve(f);
  await f.do('transition', { taskId: 'a', status: 'running' });
  await f.do('transition', { taskId: 'a', status: 'failed' });
  await f.do('transition', { taskId: 'a', status: 'pending' });
  assert.equal(f.state.status, 'running');
  await rejects(f.do('save', { patch: { title: 'Changed' } }), 'PLAN_LOCKED');
});

test('replan is human-only and preserves history after tasks stop', async t => {
  const f = await fixture(t); await approve(f);
  await rejects(f.do('replan'), 'FORBIDDEN');
  await rejects(f.store.execute({ action: 'replan', changeId: f.state.id }, user), 'REVISION_REQUIRED');
  await f.do('transition', { taskId: 'a', status: 'running' });
  await rejects(f.do('replan', {}, user), 'PLAN_LOCKED');
  await f.do('transition', { taskId: 'a', status: 'verifying' });
  await f.do('evidence', { taskId: 'a', criterion: 'works', outcome: 'passed', note: 'Fixture observation' });
  await rejects(f.do('replan', {}, user), 'PLAN_LOCKED');
  await f.do('transition', { taskId: 'a', status: 'blocked', reason: 'Plan needs revision' });
  const oldRevision = f.state.revision;
  await f.do('replan', {}, user);
  assert.equal(f.state.revision, oldRevision + 1); assert.equal(f.state.planVersion, 2);
  assert.equal(f.state.status, 'draft'); assert.equal(f.state.startedAt, undefined);
  assert.equal(f.state.approvals.length, 0); assert.equal(f.state.evidence.length, 0);
  assert.equal(f.state.tasks[0].status, 'pending'); assert.equal(f.state.tasks[0].evidence.length, 0);
  const archived = f.state.history.at(-1);
  assert.equal(archived.kind, 'replan'); assert.equal(archived.snapshot.evidence.length, 1);
  assert.equal(archived.snapshot.approvals[0].actor.kind, 'user');
  await f.do('save', { patch: { goal: 'Revised goal' } });
  await rejects(f.do('transition', { taskId: 'a', status: 'running' }), 'APPROVAL_REQUIRED');
  await f.do('approve', {}, user); await f.do('transition', { taskId: 'a', status: 'running' });
});

test('exports contain LF, reject NUL and normalize single backslash', async t => {
  const f = await fixture(t);
  await rejects(f.do('save', { patch: { title: `bad${String.fromCharCode(0)}title` } }), 'INVALID_INPUT');
  await f.do('save', { patch: { tasks: [task('a', [], [`src${String.fromCharCode(92)}single.js`])] } });
  assert.equal(f.state.tasks[0].expectedFiles[0], 'src/single.js');
  const result = await f.do('export');
  const dag = await fs.readFile(result.files.find(p => p.endsWith('task-dag.mmd')));
  assert.equal(dag.subarray(0, 13).toString(), `flowchart TD${String.fromCharCode(10)}`);
  assert.equal(dag.includes(Buffer.from([92, 110])), false);
  const progress = await fs.readFile(result.files.find(p => p.endsWith('progress.md')));
  assert.equal(progress.includes(Buffer.from([10, 10])), true);
});

test('list isolates corrupt incomplete oversized and mismatched entries', async t => {
  const f = await fixture(t);
  const changes = path.join(f.root, '.dsh', 'engineering', 'changes');
  for (const id of ['corrupt', 'incomplete', 'oversized', 'mismatch']) await fs.mkdir(path.join(changes, id));
  await fs.writeFile(path.join(changes, 'corrupt', 'state.json'), '{broken');
  await fs.writeFile(path.join(changes, 'oversized', 'state.json'), 'x'.repeat(2 * 1024 * 1024 + 1));
  await fs.writeFile(path.join(changes, 'mismatch', 'state.json'), JSON.stringify(f.state));
  const listed = await f.store.execute({ action: 'list' });
  assert.deepEqual(listed.changes.map(c => c.id), [f.state.id]);
  assert.deepEqual(listed.warnings.map(w => [w.changeId, w.code]), [
    ['corrupt', 'CORRUPT_STATE'], ['incomplete', 'NOT_FOUND'], ['mismatch', 'CORRUPT_STATE'], ['oversized', 'STATE_TOO_LARGE']
  ]);
  assert.ok(listed.warnings.every(w => typeof w.message === 'string' && w.message.length > 0));
  await rejects(f.store.execute({ action: 'get', changeId: 'corrupt' }), 'CORRUPT_STATE');
  await rejects(f.store.execute({ action: 'get', changeId: 'mismatch' }), 'CORRUPT_STATE');
});

test('evidence requires nonblank note or artifact for all outcomes', async t => {
  const f = await fixture(t); await approve(f);
  await f.do('transition', { taskId: 'a', status: 'running' });
  await f.do('transition', { taskId: 'a', status: 'verifying' });
  for (const outcome of ['passed', 'failed']) {
    await rejects(f.do('evidence', { taskId: 'a', criterion: 'works', outcome }), 'EVIDENCE_EMPTY');
    await rejects(f.do('evidence', { taskId: 'a', criterion: 'works', outcome, note: '  \t', artifact: '\n ' }), 'EVIDENCE_EMPTY');
  }
  assert.equal(f.state.evidence.length, 0);
  await f.do('evidence', { taskId: 'a', criterion: 'works', outcome: 'passed', artifact: 'results.log' });
  await f.do('evidence', { taskId: 'a', criterion: 'tested', outcome: 'passed', note: 'Observed successful assertion' });
  await f.do('transition', { taskId: 'a', status: 'completed' });
});

test('context is lossless JSON for pending and blocked tasks without writing state', async t => {
  const f = await fixture(t);
  await approve(f, [task('a'), task('b'), task('c')]);
  const file = path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'state.json');
  async function readContext() {
    const before = await fs.readFile(file, 'utf8');
    const context = await f.store.execute({ action: 'context', changeId: f.state.id });
    assert.deepEqual(context, JSON.parse(JSON.stringify(context)));
    assert.equal(await fs.readFile(file, 'utf8'), before);
    return context;
  }
  const pending = await readContext();
  assert.deepEqual(pending.tasks.map(task => task.reason), [null, null, null]);
  await f.do('transition', { taskId: 'a', status: 'blocked', reason: 'Waiting for review' });
  const blocked = await readContext();
  assert.equal(blocked.tasks[0].status, 'blocked');
  assert.deepEqual(blocked.tasks.map(task => task.reason), ['Waiting for review', null, null]);
});

test('planning defaults and legacy reads remain independent of Markdown', async t => {
  const f = await fixture(t);
  const defaults = structuredClone(f.state.planning);
  assert.deepEqual(Object.keys(defaults.sections), ['requirements', 'analysis', 'architecture', 'interfaces', 'tasks', 'acceptance']);
  assert.equal(defaults.reviewRequirements, '');
  assert.ok(Object.values(defaults.sections).every(s => s.status === 'pending' && s.note === ''));
  const file = path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'state.json');
  const legacy = structuredClone(f.state);
  delete legacy.planning;
  legacy.documents.requirements = '# Requirements ready\n- [x] All approved';
  await fs.writeFile(file, JSON.stringify(legacy));
  const restored = new EngineeringStore(f.root);
  assert.deepEqual((await restored.execute({ action: 'get', changeId: legacy.id })).change.planning, defaults);
  assert.deepEqual((await restored.execute({ action: 'context', changeId: legacy.id })).planning, defaults);
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(file, 'utf8')), 'planning'), false);
  await f.do('save', { patch: { title: 'Migrated' } });
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).planning, defaults);
});

test('planning validates nested fields atomically', async t => {
  const f = await fixture(t);
  const invalid = [null, [], 'ready', { extra: true }, { reviewRequirements: null }, { reviewRequirements: 'x'.repeat(20001) }, { sections: null }, { sections: [] }, { sections: { unknown: {} } }, { sections: { requirements: null } }, { sections: { analysis: { status: 'complete' } } }, { sections: { tasks: { status: true } } }, { sections: { architecture: { note: 12 } } }, { sections: { interfaces: { extra: true } } }, { sections: { acceptance: { note: String.fromCharCode(0) } } }];
  for (const planning of invalid) await rejects(f.do('save', { patch: { title: 'Must not persist', planning } }), 'INVALID_INPUT');
  assert.deepEqual((await f.store.execute({ action: 'get', changeId: f.state.id })).change, f.state);
  const file = path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'state.json');
  await fs.writeFile(file, JSON.stringify({ ...f.state, planning: { sections: { tasks: { status: 'bad' } } } }));
  await rejects(f.store.execute({ action: 'get', changeId: f.state.id }), 'CORRUPT_STATE');
});

test('planning persists, merges, exports and follows approval/version lifecycle', async t => {
  const f = await fixture(t);
  await f.do('save', { patch: { planning: { reviewRequirements: 'Review public API', sections: { requirements: { status: 'ready', note: 'Confirmed scope' } } }, tasks: [task('a')] } });
  assert.equal(f.state.planVersion, 1);
  await f.do('save', { patch: { planning: { sections: { requirements: { note: 'Updated scope' }, interfaces: { status: 'ready' } } } } });
  assert.deepEqual(f.state.planning.sections.requirements, { status: 'ready', note: 'Updated scope' });
  assert.equal(f.state.planning.reviewRequirements, 'Review public API');
  const restored = new EngineeringStore(f.root);
  assert.deepEqual((await restored.execute({ action: 'get', changeId: f.state.id })).change.planning, f.state.planning);
  assert.deepEqual((await restored.execute({ action: 'context', changeId: f.state.id })).planning, f.state.planning);
  const exported = await f.do('export');
  const progress = await fs.readFile(exported.files.find(p => p.endsWith('progress.md')), 'utf8');
  assert.match(progress, /Planning readiness \(self-reported\)/);
  assert.match(progress, /Review public API/);
  assert.match(progress, /requirements: ready/);
  assert.match(progress, /analysis: pending/);
  assert.match(progress, /Updated scope/);
  const prior = structuredClone(f.state.planning);
  await f.do('approve', {}, user); // Pending sections deliberately do not gate approval.
  await f.do('save', { patch: { planning: { sections: { analysis: { status: 'ready', note: 'Source inspected' } } } } });
  assert.equal(f.state.planVersion, 2);
  assert.equal(f.state.status, 'draft');
  assert.deepEqual(f.state.approvals, []);
  assert.deepEqual(f.state.history.at(-1).snapshot.planning, prior);
  await f.do('approve', {}, user);
  await f.do('transition', { taskId: 'a', status: 'running' });
  await rejects(f.do('save', { patch: { planning: {} } }), 'PLAN_LOCKED');
  await f.do('transition', { taskId: 'a', status: 'blocked', reason: 'Revisit plan' });
  const beforeReplan = structuredClone(f.state.planning);
  await f.do('replan', {}, user);
  assert.equal(f.state.planVersion, 3);
  assert.deepEqual(f.state.planning, beforeReplan);
  assert.deepEqual(f.state.history.at(-1).snapshot.planning, beforeReplan);
});

test('delivery acceptance enforces actor, revision, note, approval and task gates', async t => {
  const f = await fixture(t);
  const accept = (fields = {}, actor = user) => f.do('acceptDelivery', { note: 'Reviewed delivery', ...fields }, actor);
  await rejects(accept({}, { kind: 'agent', id: 'reviewer' }), 'FORBIDDEN');
  await rejects(accept({ actor: user }), 'INVALID_INPUT');
  await rejects(accept({ expectedRevision: undefined }), 'REVISION_REQUIRED');
  await rejects(accept({ expectedRevision: 99 }), 'REVISION_CONFLICT');
  for (const note of [undefined, null, '', ' \t\n', 1, 'x'.repeat(20001)]) await rejects(accept({ note }), 'INVALID_INPUT');
  await rejects(accept(), 'APPROVAL_REQUIRED');
  await approve(f, [task('a'), task('b')]);
  for (const status of ['pending', 'running', 'verifying', 'failed', 'blocked']) {
    const snapshot = structuredClone(f.state);
    snapshot.tasks[0].status = status;
    snapshot.tasks[1].status = 'completed';
    await fs.writeFile(path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'state.json'), JSON.stringify(snapshot));
    await rejects(accept(), 'DELIVERY_NOT_READY');
  }
  await fs.writeFile(path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'state.json'), JSON.stringify(f.state));
  await f.do('transition', { taskId: 'a', status: 'cancelled' });
  await f.do('transition', { taskId: 'b', status: 'cancelled' });
  await rejects(accept(), 'DELIVERY_NOT_READY');
  const empty = { ...f.state, tasks: [] };
  await fs.writeFile(path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'state.json'), JSON.stringify(empty));
  await rejects(accept(), 'DELIVERY_NOT_READY');
});

test('delivery confirmation preserves evidence, exports and archives across versions', async t => {
  const f = await fixture(t); await approve(f, [task('a'), task('b')]);
  await complete(f, 'a'); await f.do('transition', { taskId: 'b', status: 'cancelled' });
  const before = structuredClone(f.state);
  const stateFile = path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'state.json');
  for (const approvals of [[], [{ planVersion: before.planVersion - 1, actor: user }], [{ planVersion: before.planVersion, actor: { kind: 'agent', id: 'fake' } }]]) {
    await fs.writeFile(stateFile, JSON.stringify({ ...before, approvals }));
    await rejects(f.do('acceptDelivery', { note: 'Must have current human approval' }, user), 'APPROVAL_REQUIRED');
  }
  await fs.writeFile(stateFile, JSON.stringify(before));
  const pendingExport = await f.do('export');
  assert.match(await fs.readFile(pendingExport.files.find(p => p.endsWith('progress.md')), 'utf8'), /Not accepted for the current plan version/);
  await f.do('acceptDelivery', { note: 'User reviewed delivered behavior' }, user);
  const accepted = structuredClone(f.state.deliveryAcceptance);
  assert.deepEqual(accepted.actor, user);
  assert.equal(accepted.planVersion, before.planVersion);
  assert.equal(new Date(accepted.acceptedAt).toISOString(), accepted.acceptedAt);
  assert.equal(accepted.note, 'User reviewed delivered behavior');
  assert.equal(f.state.revision, before.revision + 1);
  assert.deepEqual(f.state.tasks, before.tasks); assert.deepEqual(f.state.evidence, before.evidence);
  assert.deepEqual((await f.store.execute({ action: 'context', changeId: f.state.id })).deliveryAcceptance, accepted);
  await rejects(f.do('acceptDelivery', { note: 'Again' }, user), 'INVALID_STATE');
  await rejects(f.do('transition', { taskId: 'b', status: 'pending' }), 'DELIVERY_LOCKED');
  await rejects(f.do('evidence', { taskId: 'a', criterion: 'works', outcome: 'passed', note: 'Changed' }), 'DELIVERY_LOCKED');
  const result = await f.do('export');
  const progress = await fs.readFile(result.files.find(p => p.endsWith('progress.md')), 'utf8');
  for (const text of ['explicit human confirmation', 'Accepted plan version: 1', 'user:reviewer', accepted.acceptedAt, accepted.note, 'not independent execution testing']) assert.ok(progress.includes(text));
  await f.do('replan', {}, user);
  assert.equal(f.state.deliveryAcceptance, null);
  assert.deepEqual(f.state.history.at(-1).snapshot.deliveryAcceptance, accepted);
  await f.do('save', { patch: { title: 'Next delivery' } });
  assert.equal(f.state.deliveryAcceptance, null);
  await f.do('approve', {}, user);
  await f.do('save', { patch: { goal: 'Updated approved version' } });
  assert.equal(f.state.deliveryAcceptance, null);
  assert.equal(f.state.history.at(-1).snapshot.deliveryAcceptance, null);
  await f.do('approve', {}, user); await complete(f, 'a');
  await f.do('transition', { taskId: 'b', status: 'cancelled' });
  await f.do('acceptDelivery', { note: 'New version reviewed' }, user);
  assert.equal(f.state.deliveryAcceptance.planVersion, 3);
  assert.deepEqual(f.state.history.find(h => h.kind === 'replan').snapshot.deliveryAcceptance, accepted);
});

test('delivery acceptance supports legacy state without confirmation and never infers it', async t => {
  const f = await fixture(t); await approve(f); await complete(f, 'a');
  const file = path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'state.json');
  const legacy = structuredClone(f.state); delete legacy.deliveryAcceptance;
  await fs.writeFile(file, JSON.stringify(legacy));
  assert.equal((await f.store.execute({ action: 'get', changeId: f.state.id })).change.deliveryAcceptance, null);
  assert.equal((await f.store.execute({ action: 'context', changeId: f.state.id })).deliveryAcceptance, null);
  await f.do('export');
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(file, 'utf8')), 'deliveryAcceptance'), false);
  await f.do('acceptDelivery', { note: 'Legacy delivery reviewed' }, user);
  assert.equal(f.state.deliveryAcceptance.actor.kind, 'user');
});

test('delivery acceptance blocks all active runs and unknown until exact human resolution', async t => {
  const f = await fixture(t); await approve(f); await complete(f, 'a');
  const runs = new VerificationRunStore(f.root);
  let run = await runs.reserve({ changeId: f.state.id, taskId: 'a', planVersion: f.state.planVersion, commandIndex: 0, command: 'echo fixture', requestId: 'delivery-run', hostInstanceId: 'host', ownerSessionId: 'session' });
  const accept = () => f.do('acceptDelivery', { note: 'Reviewed' }, user);
  await rejects(accept(), 'VERIFICATION_RUN_BLOCKED');
  for (const state of ['starting', 'running', 'unknown']) {
    run = await runs.update(f.state.id, run.runId, 'host', { expectedRevision: run.revision, state });
    await rejects(accept(), 'VERIFICATION_RUN_BLOCKED');
  }
  const file = path.join(f.root, '.dsh', 'engineering', 'changes', f.state.id, 'state.json');
  for (const entry of [
    { kind: 'verification-unknown-resolved', runId: run.runId, runRevision: run.revision - 1, actor: user },
    { kind: 'verification-unknown-resolved', runId: run.runId, runRevision: run.revision, actor: { kind: 'agent', id: 'fake' } },
    { kind: 'verification-unknown-resolved', runId: 'other', runRevision: run.revision, actor: user },
  ]) {
    await fs.writeFile(file, JSON.stringify({ ...f.state, history: [...f.state.history, entry] }));
    await rejects(accept(), 'VERIFICATION_RUN_BLOCKED');
  }
  await fs.writeFile(file, JSON.stringify(f.state));
  await rejects(f.do('resolveUnknown', { runId: run.runId, expectedRunRevision: run.revision, reason: 'Stopped' }), 'FORBIDDEN');
  await f.do('resolveUnknown', { runId: run.runId, expectedRunRevision: run.revision, reason: 'Confirmed process stopped' }, user);
  await accept();
  assert.equal(f.state.deliveryAcceptance.actor.kind, 'user');
});

test('delivery confirmation permits terminal runs and serializes competing confirmations', async t => {
  const f = await fixture(t); await approve(f); await complete(f, 'a');
  const runs = new VerificationRunStore(f.root);
  for (const state of ['succeeded', 'failed', 'cancelled', 'timed_out', 'error']) {
    let run = await runs.reserve({ changeId: f.state.id, taskId: 'a', planVersion: f.state.planVersion, commandIndex: 0, command: 'echo fixture', requestId: state, hostInstanceId: 'host', ownerSessionId: 'session' });
    run = await runs.update(f.state.id, run.runId, 'host', { expectedRevision: run.revision, state: 'starting' });
    await runs.update(f.state.id, run.runId, 'host', { expectedRevision: run.revision, state, ...(state === 'succeeded' ? { exitCode: 0, timedOut: false, aborted: false } : {}) });
  }
  const input = { action: 'acceptDelivery', changeId: f.state.id, expectedRevision: f.state.revision, note: 'User confirmed delivered behavior' };
  const results = await Promise.allSettled([f.store.execute(input, user), new EngineeringStore(f.root).execute(input, user)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal((await f.store.execute({ action: 'get', changeId: f.state.id })).change.deliveryAcceptance.actor.kind, 'user');
});

test('malformed actions and invalid creates leave valid listing', async t => {
  const f = await fixture(t);
  for (const input of [null, {}, { action: '__proto__' }, { action: 'constructor' }]) await rejects(f.store.execute(input), 'INVALID_ACTION');
  await rejects(f.store.execute({ action: 'create', title: '', goal: 'x' }), 'INVALID_INPUT');
  assert.equal((await f.store.execute({ action: 'list' })).changes.length, 1);
  const cyclic = { action: 'save', changeId: f.state.id, expectedRevision: 1, patch: {} }; cyclic.patch.goal = cyclic;
  await rejects(f.store.execute(cyclic), 'INVALID_INPUT');
});

test('the DAG labels each node with its status', async t => {
  const f = await fixture(t);
  await approve(f, [task('a'), task('b', ['a'])]);
  await complete(f, 'a');
  const result = await f.do('export');
  const dag = await fs.readFile(result.files.find(p => p.endsWith('task-dag.mmd')), 'utf8');
  assert.match(dag, /task0\["a<br\/>completed"\]/);
  assert.match(dag, /task1\["b<br\/>pending"\]/);
  assert.match(dag, /task0 --> task1/);
});
