import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply, createOperations, parameters, inject } from '../index.js';

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'engineering-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = { workingDirectory: { ensure: async agent => path.join(root, agent.id) } };
  return { ctx, root };
}

test('Host isolates workspaces and rejects forged approval before storage', async t => {
  const { ctx } = await setup(t);
  const execute = createOperations(ctx);
  const a = { id: 'project-a' }, b = { id: 'project-b' };
  const { change } = await execute({ action: 'create', title: 'A', goal: 'A goal' }, a, 'agent');
  assert.equal((await execute({ action: 'list' }, a, 'agent')).changes.length, 1);
  assert.equal((await execute({ action: 'list' }, b, 'agent')).changes.length, 0);
  await assert.rejects(execute({ action: 'approve', changeId: change.id, expectedRevision: 1 }, a, 'agent'), /HUMAN_APPROVAL/);
  await assert.rejects(execute({ action: 'replan', changeId: change.id, expectedRevision: 1 }, a, 'agent'), /HUMAN_APPROVAL/);
  await assert.rejects(execute({ action: 'list' }, null, 'agent'), /SESSION_REQUIRED/);
  await assert.rejects(execute({ action: 'list' }, a, 'agent', AbortSignal.abort()), /CANCELLED/);
  assert.equal(parameters.properties.action.enum.includes('approve'), false);
  assert.equal(parameters.properties.action.enum.includes('replan'), false);
});

test('planning schema and Host adapter expose explicit readiness', async t => {
  const schema = parameters.properties.patch.properties.planning;
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.reviewRequirements.type, 'string');
  const sections = schema.properties.sections;
  assert.equal(sections.additionalProperties, false);
  assert.deepEqual(Object.keys(sections.properties), ['requirements', 'analysis', 'architecture', 'interfaces', 'tasks', 'acceptance']);
  for (const section of Object.values(sections.properties)) {
    assert.equal(section.additionalProperties, false);
    assert.deepEqual(section.properties.status.enum, ['pending', 'ready']);
    assert.equal(section.properties.note.type, 'string');
  }
  const { ctx } = await setup(t);
  const execute = createOperations(ctx), agent = { id: 'planning' };
  const { change } = await execute({ action: 'create', title: 'Planning', goal: 'Review' }, agent, 'agent');
  const saved = await execute({ action: 'save', changeId: change.id, expectedRevision: change.revision, patch: { planning: { reviewRequirements: 'Check contracts', sections: { interfaces: { status: 'ready', note: 'API inspected' } } } } }, agent, 'agent');
  assert.equal(saved.change.planning.sections.interfaces.status, 'ready');
  assert.equal(saved.change.planning.sections.tasks.status, 'pending');
  assert.deepEqual((await execute({ action: 'context', changeId: change.id }, agent, 'user')).planning, saved.change.planning);
  await assert.rejects(execute({ action: 'save', changeId: change.id, expectedRevision: saved.change.revision, patch: { planning: { sections: { interfaces: { status: 'verified' } } } } }, agent, 'user'), e => e.code === 'INVALID_INPUT');
});

test('Tool and human command share core while only human path approves', async t => {
  const { ctx } = await setup(t);
  let tool, command, disposals = 0;
  const cleanup = [], registeredSkills = new Map();
  ctx.skills = { register(def) { assert.equal(registeredSkills.has(def.name), false); registeredSkills.set(def.name, def); return () => { registeredSkills.delete(def.name); disposals++; }; } };
  ctx.tools = { register(def) { tool = def; return () => disposals++; } };
  ctx.commands = { register(def) { command = def; return () => disposals++; } };
  ctx.effect = fn => cleanup.push(fn());
  apply(ctx);
  assert.equal(tool.name, 'engineering_plan');
  assert.ok(inject.includes('skills'));
  assert.deepEqual([...registeredSkills.keys()], ['engineering-planning', 'architecture-design', 'engineering-review']);
  for (const [name, skill] of registeredSkills) {
    assert.equal(skill.source, 'runtime');
    assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true });
    assert.equal(skill.resourceBase.kind, 'directory');
    assert.equal(path.dirname(skill.path), path.normalize(skill.resourceBase.path).replace(/[\\/]$/, ''));
    assert.equal(skill.content, await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8'));
    assert.ok(skill.description.length > 10);
    for (const term of ['expectedRevision', 'reference', 'verified', 'assumption', 'approve', 'context', 'executor']) assert.ok(skill.content.includes(term), `${name}: missing ${term}`);
  }
  const agent = { id: 'session' }, signal = new AbortController().signal;
  let result = await tool.execute({ action: 'create', title: 'Host contract', goal: 'Verify adapters' }, { agent, signal });
  let change = result.change;
  result = await tool.execute({ action: 'save', changeId: change.id, expectedRevision: change.revision, patch: { tasks: [{ id: 'T1', title: 'Check', acceptanceCriteria: ['Host contract passes'] }] } }, { agent, signal });
  change = result.change;
  const invocation = { agent, signal, rawInput: JSON.stringify({ action: 'approve', changeId: change.id, expectedRevision: change.revision }) };
  const approval = await command.handler(invocation);
  assert.equal(approval.kind, 'success');
  assert.equal(JSON.parse(approval.text).change.approvals[0].actor.kind, 'user');
  assert.equal((await command.handler({ ...invocation, rawInput: '{broken' })).kind, 'error');
  assert.equal((await command.handler({ ...invocation, rawInput: 'x'.repeat(1_000_001) })).kind, 'error');
  assert.equal(tool.isConcurrencySafe({ action: 'save' }), false);
  assert.equal(tool.isConcurrencySafe({ action: 'context' }), true);
  cleanup.forEach(fn => fn());
  assert.equal(disposals, 5);
  assert.equal(registeredSkills.size, 0);
});
