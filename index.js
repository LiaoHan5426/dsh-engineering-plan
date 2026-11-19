import { EngineeringStore } from './src/core.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const inject = ['tools', 'commands', 'workingDirectory', 'skills'];
const skillDescriptions = {
  'engineering-planning': '为工程需求建立可持久化规划：核实源码、记录六项自报就绪度、分阶段任务和验收标准，提交人工评审。',
  'architecture-design': '依据实际代码与运行契约设计模块边界、接口、数据流和迁移方案，保存架构决策与依赖任务。',
  'engineering-review': '评审工程规划或实施结果，核对来源、任务依赖、版本与实际验证证据，记录问题供人工决策。',
};
const actions = ['list', 'create', 'get', 'save', 'transition', 'evidence', 'context', 'export'];
const str = { type: 'string' };
const strings = { type: 'array', items: str };
const task = {
  type: 'object', additionalProperties: false,
  properties: { id: str, title: str, description: str, dependencies: strings, expectedFiles: strings, acceptanceCriteria: strings, verificationCommands: strings },
  required: ['id', 'title', 'dependencies', 'expectedFiles', 'acceptanceCriteria', 'verificationCommands'],
};
export const parameters = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: actions }, changeId: str, expectedRevision: { type: 'integer' },
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
    taskId: str, status: { type: 'string', enum: ['pending', 'running', 'verifying', 'blocked', 'failed', 'completed', 'cancelled'] },
    reason: str, criterion: str, outcome: { type: 'string', enum: ['passed', 'failed'] }, note: str, artifact: str,
  }, required: ['action'],
};

/** One operation boundary for the human command and model tool. Actor is never read from input. */
export function createOperations(ctx) {
  const stores = new Map();
  return async (input, agent, kind, signal) => {
    if (!agent) throw new Error('ENGINEERING_SESSION_REQUIRED');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('ENGINEERING_INVALID_INPUT');
    if (kind !== 'user' && ['approve', 'replan'].includes(input.action)) throw new Error('ENGINEERING_HUMAN_APPROVAL_REQUIRED');
    if (![...actions, 'approve', 'replan'].includes(input.action)) throw new Error('ENGINEERING_UNKNOWN_ACTION');
    if (signal?.aborted) throw new Error('ENGINEERING_CANCELLED');
    const root = await ctx.workingDirectory.ensure(agent, signal);
    let store = stores.get(root);
    if (!store) { store = new EngineeringStore(root); stores.set(root, store); }
    return store.execute(input, { kind, id: agent.id });
  };
}

export function apply(ctx) {
  const skills = Object.entries(skillDescriptions).map(([name, description]) => {
    const directory = new URL(`./skills/${name}/`, import.meta.url);
    const file = new URL('SKILL.md', directory);
    return { name, description, source: 'runtime', path: fileURLToPath(file), resourceBase: { kind: 'directory', path: fileURLToPath(directory) }, invocation: { modelInvocable: true, userInvocable: true }, content: readFileSync(file, 'utf8') };
  });
  for (const skill of skills) ctx.effect(() => ctx.skills.register(skill));
  const execute = createOperations(ctx);
  ctx.effect(() => ctx.tools.register({
    name: 'engineering_plan',
    description: 'Manage durable engineering plans in the current workspace. Start with list/get/context; create a draft, inspect source and separate reference documents from verified facts, then save detailed documents and dependency tasks with explicit acceptance criteria. All writes except create require the latest expectedRevision. Approval belongs to the human workbench. Transition through running and verifying; record actual evidence per criterion (a nonempty note or artifact is required) before completed. Evidence is attributed self-report, not independent verification. This tool does not execute shell commands, launch agents, or authorize arbitrary source edits. After context loss call context. Export rebuilds Markdown projections from authoritative state.',
    parameters,
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(args, exec) { return execute(args, exec.agent, 'agent', exec.signal); },
    isConcurrencySafe: args => ['list', 'get', 'context'].includes(args?.action),
  }));
  ctx.effect(() => ctx.commands.register({
    name: 'engineering',
    description: '工程研发：管理规划、任务、证据；工作台中的评审仅由用户确认。',
    input: { hint: 'JSON operation, e.g. {"action":"list"}' },
    recordInput: false,
    async handler(invocation) {
      try {
        const raw = invocation.rawInput.trim();
        if (raw.length > 1_000_000) throw new Error('ENGINEERING_INPUT_TOO_LARGE');
        const input = raw ? JSON.parse(raw) : { action: 'list' };
        const result = await execute(input, invocation.agent, 'user', invocation.signal);
        return { kind: 'success', text: JSON.stringify(result) };
      } catch (error) {
        return { kind: 'error', text: `${error.code || 'ENGINEERING_ERROR'}: ${error.message}` };
      }
    },
  }));
}
