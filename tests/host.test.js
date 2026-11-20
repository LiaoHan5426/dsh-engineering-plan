import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply, createOperations, parameters, inject } from '../index.js';

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'engineering-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = { workingDirectory: { ensure: async agent => path.join(root, agent.id) }, sandboxPolicy: { resolve: ({ session }) => ({ workspaceRoot: path.join(root, session.id) }) } };
  return { ctx, root };
}

test('Host isolates workspaces and rejects forged approval before storage', async t => {
  const { ctx } = await setup(t);
  const execute = createOperations(ctx);
  const a = { id: 'project-a', session: { id: 'project-a' } }, b = { id: 'project-b', session: { id: 'project-b' } };
  const { change } = await execute({ action: 'create', title: 'A', goal: 'A goal' }, a, 'agent');
  assert.equal((await execute({ action: 'list' }, a, 'agent')).changes.length, 1);
  assert.equal((await execute({ action: 'list' }, b, 'agent')).changes.length, 0);
  await assert.rejects(execute({ action: 'approve', changeId: change.id, expectedRevision: 1 }, a, 'agent'), /HUMAN_APPROVAL/);
  await assert.rejects(execute({ action: 'replan', changeId: change.id, expectedRevision: 1 }, a, 'agent'), /HUMAN_APPROVAL/);
  await assert.rejects(execute({ action: 'list' }, null, 'agent'), /SESSION_REQUIRED/);
  await assert.rejects(execute({ action: 'list' }, a, 'agent', AbortSignal.abort()), /CANCELLED/);
  assert.equal(parameters.properties.action.enum.includes('approve'), false);
  assert.equal(parameters.properties.action.enum.includes('replan'), false);
  assert.equal(parameters.properties.action.enum.includes('resolveUnknown'), false);
  assert.equal(parameters.properties.action.enum.includes('acceptDelivery'), false);
  assert.equal(Object.hasOwn(parameters.properties, 'actor'), false);
  await assert.rejects(execute({ action: 'acceptDelivery', changeId: change.id, expectedRevision: 1, note: 'Forged', actor: { kind: 'user', id: 'attacker' } }, a, 'agent'), /HUMAN_APPROVAL/);
  await assert.rejects(execute({ action: 'acceptDelivery', changeId: change.id, expectedRevision: 1, note: 'Forged', actor: { kind: 'user', id: 'attacker' } }, a, 'user'), e => e.code === 'INVALID_INPUT');
  await assert.rejects(execute({ action: 'resolveUnknown', changeId: change.id, expectedRevision: 1 }, a, 'agent'), /HUMAN_APPROVAL/);
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
  const execute = createOperations(ctx), agent = { id: 'planning', session: { id: 'planning' } };
  const { change } = await execute({ action: 'create', title: 'Planning', goal: 'Review' }, agent, 'agent');
  const saved = await execute({ action: 'save', changeId: change.id, expectedRevision: change.revision, patch: { planning: { reviewRequirements: 'Check contracts', sections: { interfaces: { status: 'ready', note: 'API inspected' } } } } }, agent, 'agent');
  assert.equal(saved.change.planning.sections.interfaces.status, 'ready');
  assert.equal(saved.change.planning.sections.tasks.status, 'pending');
  assert.deepEqual((await execute({ action: 'context', changeId: change.id }, agent, 'user')).planning, saved.change.planning);
  await assert.rejects(execute({ action: 'save', changeId: change.id, expectedRevision: saved.change.revision, patch: { planning: { sections: { interfaces: { status: 'verified' } } } } }, agent, 'user'), e => e.code === 'INVALID_INPUT');
});

test('Tool and human command share core while only human path approves', async t => {
  const { ctx } = await setup(t);
  let command, disposals = 0;
  const cleanup = [], registeredSkills = new Map(), tools = new Map();
  ctx.skills = { register(def) { assert.equal(registeredSkills.has(def.name), false); registeredSkills.set(def.name, def); return () => { registeredSkills.delete(def.name); disposals++; }; } };
  ctx.tools = { register(def) { assert.equal(tools.has(def.name), false); tools.set(def.name, def); return () => disposals++; } };
  ctx.commands = { register(def) { command = def; return () => disposals++; } };
  ctx.effect = fn => cleanup.push(fn());
  apply(ctx);
  assert.deepEqual([...tools.keys()].sort(), ['engineering_dispatch', 'engineering_git', 'engineering_plan', 'engineering_verify']);
  const tool = tools.get('engineering_plan');
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
    for (const term of ['expectedRevision', 'reference', 'verified', 'assumption', 'approve', 'context']) assert.ok(skill.content.includes(term), `${name}: missing ${term}`);
  }
  const agent = { id: 'session', session: { id: 'session' } }, signal = new AbortController().signal;
  const exec = { agent, signal, callId: 'call', rootCallId: 'root-call' };
  let result = await tool.execute({ action: 'create', title: 'Host contract', goal: 'Verify adapters' }, exec);
  let change = result.change;
  result = await tool.execute({ action: 'save', changeId: change.id, expectedRevision: change.revision, patch: { tasks: [{ id: 'T1', title: 'Check', acceptanceCriteria: ['Host contract passes'] }] } }, exec);
  change = result.change;
  const invocation = { agent, signal, rawInput: JSON.stringify({ action: 'approve', changeId: change.id, expectedRevision: change.revision }) };
  const approval = await command.handler(invocation);
  assert.equal(approval.kind, 'success');
  assert.equal(JSON.parse(approval.text).change.approvals[0].actor.kind, 'user');
  change = JSON.parse(approval.text).change;
  const operate = async fields => {
    const result = await tool.execute({ changeId: change.id, expectedRevision: change.revision, ...fields }, exec);
    change = result.change;
  };
  await operate({ action: 'transition', taskId: 'T1', status: 'running' });
  await operate({ action: 'transition', taskId: 'T1', status: 'verifying' });
  await operate({ action: 'evidence', taskId: 'T1', criterion: 'Host contract passes', outcome: 'passed', note: 'Host fixture checked' });
  await operate({ action: 'transition', taskId: 'T1', status: 'completed' });
  const deliveryInput = { action: 'acceptDelivery', changeId: change.id, expectedRevision: change.revision, note: 'Reviewed delivered result' };
  await assert.rejects(tool.execute(deliveryInput, exec), /HUMAN_APPROVAL/);
  const delivery = await command.handler({ ...invocation, rawInput: JSON.stringify(deliveryInput) });
  assert.equal(delivery.kind, 'success');
  const accepted = JSON.parse(delivery.text).change;
  assert.deepEqual(accepted.deliveryAcceptance.actor, { kind: 'user', id: agent.id });
  assert.deepEqual(accepted.tasks, change.tasks);
  assert.deepEqual(accepted.evidence, change.evidence);
  assert.deepEqual((await tool.execute({ action: 'context', changeId: change.id }, exec)).deliveryAcceptance, accepted.deliveryAcceptance);
  const duplicate = await command.handler({ ...invocation, rawInput: JSON.stringify({ ...deliveryInput, expectedRevision: accepted.revision }) });
  assert.equal(duplicate.kind, 'error'); assert.match(duplicate.text, /INVALID_STATE/);
  assert.equal((await command.handler({ ...invocation, rawInput: '{broken' })).kind, 'error');
  assert.equal((await command.handler({ ...invocation, rawInput: 'x'.repeat(1_000_001) })).kind, 'error');
  assert.equal(tool.isConcurrencySafe({ action: 'save' }), false);
  assert.equal(tool.isConcurrencySafe({ action: 'context' }), true);
  cleanup.forEach(fn => fn());
  assert.equal(disposals, 8);
  assert.equal(registeredSkills.size, 0);
});
