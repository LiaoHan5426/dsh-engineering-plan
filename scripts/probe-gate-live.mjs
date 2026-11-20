// 门禁复测工具：验证 requiredApproval 任务由 Agent 请求 completed 时是否被改写成 awaiting-review。
//
//   node scripts/probe-gate-live.mjs --mode setup     # 建一个专用草稿变更，等你在工作台批准
//   node scripts/probe-gate-live.mjs --mode probe     # 批准后跑：推进到 verifying、写证据、请求 completed，打印落点
//   node scripts/probe-gate-live.mjs --mode temp      # 不碰工作区，临时 root 里全自动跑一遍（只验磁盘代码）
//
// 判定：probe 输出 `GATE_OK` = 运行实例加载的是新 src/core.js；输出 `GATE_BROKEN …completed` = 还是旧模块，需重启应用。
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineeringStore } from '../src/core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CHANGE_ID = 'd3000000-0000-4000-8000-000000000004';
const TASK_ID = 'G1';
const CRITERION = '人工确认后才能完成';

const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const mode = arg('--mode') ?? 'temp';

// 脚本直调 store：approve 在宿主里只允许 user 通道，这里用显式 actor 模拟人工批准，
// 目的只是造出「已批准 + requiredApproval 任务」的数据形态。
const AGENT = { kind: 'agent', id: 'probe-gate' };
const USER = { kind: 'user', id: 'probe-gate-human' };

async function setup(store) {
  const exists = (await store.execute({ action: 'list' }, AGENT)).changes.some(c => c.id === CHANGE_ID);
  if (exists) {
    const { change } = await store.execute({ action: 'get', changeId: CHANGE_ID }, AGENT);
    console.log(`已存在：${change.title} · status=${change.status} · revision=${change.revision}`);
    return change.id;
  }
  await store.execute({
    action: 'create', changeId: CHANGE_ID, mode: 'lite',
    title: '门禁复测：人工审核任务',
    goal: '验证 requiredApproval 任务由 Agent 请求 completed 时被改写成 awaiting-review，只有人工确认才落 completed。',
  }, AGENT);
  let rev = (await store.execute({ action: 'get', changeId: CHANGE_ID }, AGENT)).change.revision;
  await store.execute({
    action: 'save', changeId: CHANGE_ID, expectedRevision: rev, patch: {
      goal: '验证 requiredApproval 任务由 Agent 请求 completed 时被改写成 awaiting-review，只有人工确认才落 completed。',
      documents: {
        proposal: '一条命令复测人工审核门禁。Agent 把任务推到 verifying 并挂齐证据后请求 completed，观察落点。',
        requirements: 'G1 的 requiredApproval 必须为 true；Agent 请求 completed 后 status 应停在 awaiting-review。',
      },
      planning: {
        reviewRequirements: 'G1 只能由人在工作台点「确认完成」。',
        sections: {
          requirements: { status: 'ready', note: '单任务门禁探针' },
          analysis: { status: 'ready', note: '只读 store，不碰源码' },
          architecture: { status: 'ready', note: '单任务，无依赖' },
          interfaces: { status: 'ready', note: '复用现有 transition/evidence' },
          tasks: { status: 'ready', note: '只有一个 G1' },
          acceptance: { status: 'ready', note: '看落点是否 awaiting-review' },
        },
      },
      tasks: [{
        id: TASK_ID,
        title: '收尾必须由人确认',
        description: 'Agent 把任务推到 verifying、挂证据、请求 completed；门禁应把它改写成 awaiting-review。',
        dependencies: [],
        expectedFiles: [],
        acceptanceCriteria: [CRITERION],
        verificationCommands: [],
        affectedModules: ['core'],
        requiredApproval: true,
      }],
    },
  }, AGENT);
  console.log(`已建草稿：门禁复测：人工审核任务（${CHANGE_ID}）`);
  console.log('下一步：在工程研发工作台点「评审方案 → 批准当前方案」，然后跑 --mode probe');
  return CHANGE_ID;
}

const rev = async (store, id) => (await store.execute({ action: 'get', changeId: id }, AGENT)).change.revision;

async function probe(store, id, { autoApprove = false } = {}) {
  let { change } = await store.execute({ action: 'get', changeId: id }, AGENT);
  if (change.status === 'draft') {
    if (!autoApprove) {
      console.log('变更还是草稿：先在工作台批准，或加 --auto-approve 由脚本模拟人工批准。');
      return 'NEEDS_APPROVAL';
    }
    await store.execute({ action: 'approve', changeId: id, expectedRevision: change.revision }, USER);
    ({ change } = await store.execute({ action: 'get', changeId: id }, AGENT));
  }
  const t0 = change.tasks.find(t => t.id === TASK_ID);
  if (t0.status === 'completed' || t0.status === 'awaiting-review') {
    console.log(`G1 已是 ${t0.status}，状态机不能回退；重建变更或换一个 changeId 再测。`);
    return t0.status;
  }
  for (const status of ['running', 'verifying']) {
    const cur = (await store.execute({ action: 'get', changeId: id }, AGENT)).change.tasks.find(t => t.id === TASK_ID).status;
    if (cur === status) continue;
    await store.execute({ action: 'transition', changeId: id, taskId: TASK_ID, status, expectedRevision: await rev(store, id) }, AGENT);
  }
  const withEvidence = (await store.execute({ action: 'get', changeId: id }, AGENT)).change.tasks.find(t => t.id === TASK_ID);
  if (!withEvidence.evidence.some(e => e.criterion === CRITERION)) {
    await store.execute({
      action: 'evidence', changeId: id, taskId: TASK_ID, criterion: CRITERION, outcome: 'passed',
      note: 'Agent 侧完成：脚本已跑通，等人工确认收尾。', expectedRevision: await rev(store, id),
    }, AGENT);
  }
  const after = await store.execute({ action: 'transition', changeId: id, taskId: TASK_ID, status: 'completed', expectedRevision: await rev(store, id) }, AGENT);
  const landed = after.change.tasks.find(t => t.id === TASK_ID).status;
  console.log(`Agent 请求 completed → G1 = ${landed} | change.status = ${after.change.status}`);
  if (landed === 'awaiting-review') {
    console.log('GATE_OK 门禁生效：只剩人工在工作台点「确认完成」。');
    return 'GATE_OK';
  }
  console.log('GATE_BROKEN 门禁未生效：运行实例加载的还是旧 src/core.js，重启 dsh 桌面应用后重测。');
  return 'GATE_BROKEN';
}

if (mode === 'temp') {
  const root = await mkdtemp(path.join(tmpdir(), 'ep-gate-'));
  try {
    const store = new EngineeringStore(root);
    const id = await setup(store);
    await probe(store, id, { autoApprove: true });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
} else {
  // EngineeringStore 的构造参数是「工作区根」，它自己会拼 .dsh/engineering。
  const store = new EngineeringStore(ROOT);
  if (mode === 'setup') await setup(store);
  else if (mode === 'probe') await probe(store, CHANGE_ID, { autoApprove: process.argv.includes('--auto-approve') });
  else console.log('用法：--mode setup|probe|temp');
}
