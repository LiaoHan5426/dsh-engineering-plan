import { EngineeringStore } from './src/core.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { launchVerification } from './src/verification-runner.js';
import { VerificationRunStore } from './src/verification-store.js';
import { DispatchRunStore } from './src/dispatch-store.js';
import { launchDispatch } from './src/dispatch-runner.js';
import { GitObservationStore } from './src/git-observation-store.js';
import { createGitOperations, gitParameters } from './src/git-operations.js';
export { gitParameters } from './src/git-operations.js';

export const inject = ['tools', 'commands', 'workingDirectory', 'skills', 'shell', 'jobs', 'shellEnv', 'sandboxPolicy', 'subagents'];
export const dispatchParameters = {
  type: 'object', additionalProperties: false,
  properties: {
    changeId: { type: 'string' }, taskId: { type: 'string' },
    expectedRevision: { type: 'integer', minimum: 1 }, planVersion: { type: 'integer', minimum: 1 },
    requestId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$', description: 'Stable identifier for this attempt; reuse to observe its existing run without restarting.' },
  },
  required: ['changeId', 'taskId', 'expectedRevision', 'planVersion', 'requestId'],
};
export const verificationParameters = {
  type: 'object', additionalProperties: false,
  properties: {
    changeId: { type: 'string' }, taskId: { type: 'string' },
    expectedRevision: { type: 'integer', minimum: 1 }, planVersion: { type: 'integer', minimum: 1 },
    commandIndex: { type: 'integer', minimum: 0 },
    command: { type: 'string', description: 'Exact verification command from the approved task.' },
    requestId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$', description: 'Stable identifier for this attempt; reuse to observe its existing run.' },
  },
  required: ['changeId', 'taskId', 'expectedRevision', 'planVersion', 'commandIndex', 'command', 'requestId'],
};
const skillDescriptions = {
  'engineering-planning': '为工程需求建立可持久化规划：核实源码、记录六项自报就绪度、分阶段任务和验收标准，提交人工评审。',
  'architecture-design': '依据实际代码与运行契约设计模块边界、接口、数据流和迁移方案，保存架构决策与依赖任务。',
  'engineering-review': '评审工程规划或实施结果，核对来源、任务依赖、版本与实际验证证据，记录问题供人工决策。',
};
const actions = ['list', 'create', 'get', 'save', 'transition', 'evidence', 'context', 'export', 'verificationRuns', 'dispatchRuns', 'gitObservations', 'approvalBaselineStatus', 'gateStatus', 'readyTasks', 'scopeAudit'];
const str = { type: 'string' };
const strings = { type: 'array', items: str };
const task = {
  type: 'object', additionalProperties: false,
  properties: {
    id: str, title: str, description: str, dependencies: strings, expectedFiles: strings,
    acceptanceCriteria: strings, verificationCommands: strings,
    affectedModules: { ...strings, description: 'Advisory module or package names this task touches; not used for DAG or file-conflict gating.' },
    executor: { type: 'string', enum: ['local', 'subagent', 'external'], description: 'Planned executor. Metadata only: no executor is wired to this value in this version.' },
    requiredApproval: { type: 'boolean', description: 'Planner intent flag. Metadata only: dispatch and verification are always gated by the current human plan approval.' },
    maxRetries: { type: 'integer', minimum: 0, maximum: 10, description: 'Planner intent flag. Metadata only: nothing retries automatically in this version.' },
  },
  required: ['id', 'title', 'dependencies', 'expectedFiles', 'acceptanceCriteria', 'verificationCommands'],
};
export const parameters = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: actions }, changeId: str,
    expectedRevision: { type: 'integer', minimum: 1, description: 'Required by mutating actions (save, transition, evidence, export); read-only actions must omit it.' },
    title: str, goal: str, mode: { type: 'string', enum: ['lite', 'standard'] },
    patch: { type: 'object', additionalProperties: false, properties: {
      title: str, goal: str,
      planning: {
        type: 'object', additionalProperties: false,
        description: 'Explicit self-reported planning readiness, never inferred from Markdown. Partial updates merge with existing values; omitted sections default to pending on creation or legacy reads. This is not independent verification or an additional approval gate.',
        properties: {
          reviewRequirements: str,
          sections: { type: 'object', additionalProperties: false, properties: Object.fromEntries(['requirements', 'analysis', 'architecture', 'interfaces', 'tasks', 'acceptance'].map(key => [key, {
            type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['pending', 'ready'] }, note: str },
          }])) },
        },
      },
      documents: { type: 'object', additionalProperties: false, properties: Object.fromEntries(['proposal', 'requirements', 'architecture', 'implementation', 'impact-analysis', 'acceptance', 'decisions', 'findings'].map(k => [k, str])) },
      diagrams: { type: 'object', additionalProperties: false, properties: Object.fromEntries(['architecture', 'sequence', 'data-flow'].map(k => [k, str])) },
      tasks: { type: 'array', items: task },
      references: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: str, title: str, source: str, kind: { type: 'string', enum: ['reference', 'verified', 'assumption'] }, note: str }, required: ['id', 'title', 'source', 'kind', 'note'] } },
    } },
    runId: { type: 'string', description: 'Optional run identifier for verificationRuns or dispatchRuns; omit to list runs. Both actions require changeId.' },
    observationId: { type: 'string', description: 'Optional observation identifier for gitObservations or approvalBaselineStatus. The latter reads current approval baseline comparison without capture or state changes; omit observationId to leave it unchecked. Requires changeId.' },
    taskId: str, status: { type: 'string', enum: ['pending', 'running', 'verifying', 'blocked', 'failed', 'completed', 'cancelled'] },
    reason: str, criterion: str, outcome: { type: 'string', enum: ['passed', 'failed'] }, note: str, artifact: str,
  }, required: ['action'],
};

/** Guards in this file are not core refusals, so they must carry their code too: the workbench maps a
 * code to a bilingual sentence, and a bare Error would surface as "ENGINEERING_ERROR: ..." instead. */
const fail = (code, message = code) => { throw Object.assign(new Error(message), { code }); };

/**
 * Resolve the plan store root only when the session workspace is the policy workspace.
 * Without this check a session cwd moved into a subdirectory (or any other directory the
 * host can write) would silently create a second, invisible store outside the workbench.
 */
export async function admittedWorkspace(ctx, agent, signal) {
  if (!agent || typeof agent.id !== 'string') fail('ENGINEERING_SESSION_REQUIRED');
  const root = await ctx.workingDirectory.ensure(agent, signal);
  if (signal?.aborted) fail('ENGINEERING_CANCELLED');
  const policy = typeof ctx.sandboxPolicy?.resolve === 'function'
    ? ctx.sandboxPolicy.resolve({ session: agent.session })
    : undefined;
  if (typeof policy?.workspaceRoot !== 'string' || path.resolve(root) !== path.resolve(policy.workspaceRoot)) {
    fail('ENGINEERING_WORKSPACE_MISMATCH');
  }
  return root;
}

/** One operation boundary for the human command and model tool. Actor is never read from input. */
export function createOperations(ctx, admitted = (agent, signal) => admittedWorkspace(ctx, agent, signal)) {
  const stores = new Map();
  return async (input, agent, kind, signal) => {
    if (!agent) fail('ENGINEERING_SESSION_REQUIRED');
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('ENGINEERING_INVALID_INPUT');
    const actionDescriptor = Object.getOwnPropertyDescriptor(input, 'action');
    if (!actionDescriptor) fail('ENGINEERING_UNKNOWN_ACTION');
    if (!Object.hasOwn(actionDescriptor, 'value') || !actionDescriptor.enumerable) fail('ENGINEERING_INVALID_INPUT');
    if (kind !== 'user' && ['approve', 'replan', 'resolveUnknown', 'resolveDispatchUnknown', 'acceptDelivery', 'abandonRun'].includes(input.action)) fail('ENGINEERING_HUMAN_APPROVAL_REQUIRED');
    if (![...actions, 'approve', 'replan', 'resolveUnknown', 'resolveDispatchUnknown', 'acceptDelivery', 'abandonRun'].includes(input.action)) fail('ENGINEERING_UNKNOWN_ACTION');
    if (signal?.aborted) fail('ENGINEERING_CANCELLED');
    const root = await admitted(agent, signal);
    let store = stores.get(root);
    if (!store) { store = new EngineeringStore(root); stores.set(root, store); }
    if (input.action === 'gitObservations') {
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(descriptors).some(key =>
        !['action', 'changeId', 'observationId'].includes(key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) fail('ENGINEERING_INVALID_INPUT');
      await store.execute({ action: 'get', changeId: input.changeId }, { kind, id: agent.id });
      if (signal?.aborted) fail('ENGINEERING_CANCELLED');
      const observations = new GitObservationStore(root);
      return Object.hasOwn(input, 'observationId')
        ? { observation: await observations.get(input.changeId, input.observationId) }
        : { observations: await observations.list(input.changeId) };
    }
    if (['verificationRuns', 'dispatchRuns'].includes(input.action)) {
      if (Object.keys(input).some(key => !['action', 'changeId', 'runId'].includes(key))) fail('ENGINEERING_INVALID_INPUT');
      await store.execute({ action: 'get', changeId: input.changeId }, { kind, id: agent.id });
      if (signal?.aborted) fail('ENGINEERING_CANCELLED');
      const runs = input.action === 'dispatchRuns' ? new DispatchRunStore(root) : new VerificationRunStore(root);
      return Object.hasOwn(input, 'runId') ? { run: await runs.get(input.changeId, input.runId) } : { runs: await runs.list(input.changeId) };
    }
    return store.execute(input, { kind, id: agent.id });
  };
}

// 人工终止「正在运行」的派生任务或验证：jobs.kill 会触发 runner 自己的取消路径，
// 由 runner 把运行记录结算成 cancelled，插件不直接改写运行状态。
export async function cancelRun(ctx, agent, signal, input, hostInstanceId) {
  const allowed = ['action', 'changeId', 'kind', 'runId', 'reason'];
  if (Object.keys(input).some(key => !allowed.includes(key))) fail('ENGINEERING_INVALID_INPUT');
  if (!input.changeId || typeof input.changeId !== 'string' || !input.runId || typeof input.runId !== 'string') fail('ENGINEERING_INVALID_INPUT');
  if (!['verification', 'dispatch'].includes(input.kind)) fail('ENGINEERING_INVALID_INPUT');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 4000 || input.reason.includes('\u0000')) fail('ENGINEERING_INVALID_INPUT');
  const admitted = await admittedWorkspace(ctx, agent, signal);
  const runs = input.kind === 'dispatch' ? new DispatchRunStore(admitted) : new VerificationRunStore(admitted);
  const record = await runs.get(input.changeId, input.runId);
  if (!['starting', 'running'].includes(record.state)) fail('ENGINEERING_RUN_NOT_RUNNING');
  if (!record.jobId) fail('ENGINEERING_RUN_WITHOUT_JOB');
  // The jobs registry lives in this process, not in this apply: a run created
  // before a plugin reload is still killable, so hostInstanceId is only worth a
  // warning. What actually proves the handle is gone is jobs.kill throwing
  // JOB_NOT_FOUND, and that decision is left to the registry.
  const sameHost = record.hostInstanceId === hostInstanceId;
  // jobs authorizes kill against the session that started the job. A run started
  // by a child session is owned by that child, so the persisted owner is used
  // rather than the session that happens to send this command.
  const caller = typeof record.ownerSessionId === 'string' && record.ownerSessionId
    ? record.ownerSessionId
    : agent.id;
  let kill;
  try {
    kill = ctx.jobs.kill(record.jobId, caller, input.reason);
  } catch (error) {
    if (error?.code === 'JOB_NOT_FOUND') fail('ENGINEERING_RUN_EXECUTOR_GONE');
    throw error;
  }
  return {
    changeId: input.changeId,
    runId: input.runId,
    kind: input.kind,
    jobId: record.jobId,
    kill,
    // 'already-finished' means the executor had already exited; nothing was
    // terminated and the record settles on its own.
    outcome: kill === 'requested' ? 'terminating' : 'already-finished',
    sameHost,
  };
}

export function codedError(error) {
  if (!error || typeof error !== 'object') return error;
  const code = error.code;
  if (typeof code !== 'string' || !code) return error;
  const message = typeof error.message === 'string' ? error.message : '';
  if (!message || message === code || message.startsWith(`${code}:`)) return error;
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

/**
 * Tool calls surface error.message to the model, so a guard that throws a plain
 * message would hide its own code. Prefix the code without changing the command
 * channel, which builds the same shape itself.
 */
const toolExecute = (run) => async (args, exec) => {
  try {
    return await run(args, exec);
  } catch (error) {
    throw codedError(error);
  }
};

export function apply(ctx) {
  const hostInstanceId = randomUUID();
  const skills = Object.entries(skillDescriptions).map(([name, description]) => {
    const directory = new URL(`./skills/${name}/`, import.meta.url);
    const file = new URL('SKILL.md', directory);
    return { name, description, source: 'runtime', path: fileURLToPath(file), resourceBase: { kind: 'directory', path: fileURLToPath(directory) }, invocation: { modelInvocable: true, userInvocable: true }, content: readFileSync(file, 'utf8') };
  });
  for (const skill of skills) ctx.effect(() => ctx.skills.register(skill));
  const execute = createOperations(ctx);
  ctx.effect(() => ctx.tools.register({
    name: 'engineering_plan',
    description: 'Manage durable engineering plans in the current workspace. For create, use the supplied changeId when the workbench provides a UUID v4; on CHANGE_EXISTS use get to resume. Start with list/get/context; create a draft, inspect source and separate reference documents from verified facts, then save detailed documents and dependency tasks with explicit acceptance criteria. All writes except create require the latest expectedRevision; every action rejects fields that belong to another action, so pass only what that action documents (read-only actions take action plus changeId, and omit expectedRevision). Approval belongs to the human workbench. Transition through running and verifying; record actual evidence per criterion (a nonempty note or artifact is required) before completed. Evidence is attributed self-report, not independent verification. This tool does not execute shell commands, launch agents, or authorize arbitrary source edits. After context loss call context; its documents are excerpted to 1000 characters each, so check documentsTruncated/documentLengths and use get before rewriting a document. verificationRuns reads verification execution records; dispatchRuns reads native Agent dispatch records. Both require changeId and optionally select runId; returned dispatch is not task acceptance. gitObservations reads immutable Git envelopes with changeId and optional observationId. approvalBaselineStatus reads the current user approval baseline and optionally compares an existing observationId without capture, mutation or changing execution gates; equality covers only recorded Git scope. gateStatus is read-only and reports the delivery preconditions (approval, task terminality, current-version evidence per criterion, active or unresolved runs) as data. scopeAudit is read-only and compares the retained Git path lists of an observation against each task expectedFiles, returning declared and undeclared paths; it audits evidence and enforces nothing. readyTasks is read-only and reports which pending tasks could start now, with one reason per blocked task (approval, dependencies, file overlap with running work, or an in-flight/unresolved run); it starts nothing. Export rebuilds Markdown projections from authoritative state.',
    parameters,
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: toolExecute(async (args, exec) => {
      if (!exec?.agent?.id || !exec.agent.session || !exec.callId || !exec.rootCallId || !exec.signal) fail('ENGINEERING_TOOL_EXECUTION_REQUIRED');
      exec.signal.throwIfAborted();
      return execute(args, exec.agent, 'agent', exec.signal);
    }),
    isConcurrencySafe: args => ['list', 'get', 'context', 'verificationRuns', 'dispatchRuns', 'gitObservations', 'approvalBaselineStatus', 'gateStatus', 'readyTasks', 'scopeAudit'].includes(args?.action),
  }));
  ctx.effect(() => ctx.tools.register({
    name: 'engineering_verify',
    description: 'Run one exact approved verification command for a task in verifying state. Returns a background job/run id for a new attempt, or the original run on request replay. Collect or cancel the job with the job tools. Results are execution records; acceptance evidence remains explicit.',
    parameters: verificationParameters,
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: toolExecute(async (args, exec) => {
      if (!exec.agent?.id || !exec.agent.session || !exec.callId || !exec.rootCallId) fail('ENGINEERING_TOOL_EXECUTION_REQUIRED');
      exec.signal.throwIfAborted();
      const root = await admittedWorkspace(ctx, exec.agent, exec.signal);
      exec.signal.throwIfAborted();
      const { run, created } = await new EngineeringStore(root).reserveVerification(args, { hostInstanceId, ownerSessionId: exec.agent.id });
      if (!created) return run;
      return launchVerification(ctx, exec, run, new VerificationRunStore(root));
    }),
    isConcurrencySafe: () => false,
  }));
  ctx.effect(() => ctx.tools.register({
    name: 'engineering_dispatch',
    description: 'Dispatch one pending task from a human-approved plan to a native subagent. A new attempt returns jobId/runId after publication, not completion. Collect or cancel the background job with the job tools; read durable records with engineering_plan dispatchRuns. Reusing requestId returns the original run without restarting, even after revision changes. A returned subagent result is not task acceptance; task state, approval and acceptance evidence remain explicit.',
    parameters: dispatchParameters,
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: toolExecute(async (args, exec) => {
      if (!exec.agent?.id || !exec.agent.session || !exec.callId || !exec.rootCallId) fail('ENGINEERING_TOOL_EXECUTION_REQUIRED');
      exec.signal.throwIfAborted();
      const root = await admittedWorkspace(ctx, exec.agent, exec.signal);
      exec.signal.throwIfAborted();
      const { run, created } = await new EngineeringStore(root).reserveDispatch(args, {
        hostInstanceId, ownerSessionId: exec.agent.id, childId: randomUUID(),
      });
      if (!created) return run;
      return launchDispatch(ctx, exec, run, new DispatchRunStore(root));
    }),
    isConcurrencySafe: () => false,
  }));
  const executeGit = createGitOperations(ctx, (agent, signal) => admittedWorkspace(ctx, agent, signal));
  ctx.effect(() => ctx.tools.register({
    name: 'engineering_git',
    description: 'Capture immutable Git observations or compare a new observation with a saved baseline from this change. Replaying a request returns the saved observation without collecting again. Returns bindingCurrent and, for compare, comparison. Observations do not bind a baseline, change plans, approve work or establish full workspace equality. Concurrent hosts may collect before the store deduplicates their records.',
    parameters: gitParameters,
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    execute: toolExecute((args, exec) => executeGit(args, exec)),
    isConcurrencySafe: () => false,
  }));
  ctx.effect(() => ctx.commands.register({
    name: 'engineering',
    description: '工程研发：管理规划、任务、证据；工作台中的评审仅由用户确认。',
    input: { hint: 'JSON operation, e.g. {"action":"list"}' },
    recordInput: false,
    async handler(invocation) {
      try {
        const raw = invocation.rawInput.trim();
        if (raw.length > 1_000_000) fail('ENGINEERING_INPUT_TOO_LARGE');
        const input = raw ? JSON.parse(raw) : { action: 'list' };
        if (input && input.action === 'cancelRun') {
          const result = await cancelRun(ctx, invocation.agent, invocation.signal, input, hostInstanceId);
          return { kind: 'success', text: JSON.stringify(result) };
        }
        const result = await execute(input, invocation.agent, 'user', invocation.signal);
        return { kind: 'success', text: JSON.stringify(result) };
      } catch (error) {
        const code = error.code || 'ENGINEERING_ERROR';
        const text = error.message === code ? code : `${code}: ${error.message}`;
        return { kind: 'error', text };
      }
    },
  }));
}
