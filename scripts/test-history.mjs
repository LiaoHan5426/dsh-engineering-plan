#!/usr/bin/env node
// 测试历史夹具：用插件自己的核心 API 生成/校验一组「可点开就看得到结论」的变更记录。
// 目的是替代旧工作区里那批不可用于验收的历史（残留 running、缺 manifest、只为 UI 表单做的假数据），
// 让工作台的四个使用目的每一项都有对应的可观测状态。
//
//   node scripts/test-history.mjs --mode seed [--reset] [--root DIR]   归档旧历史并重建夹具（写操作）
//   node scripts/test-history.mjs --mode check [--root DIR]           只读断言，不改任何文件
//   node scripts/test-history.mjs check            只读断言当前夹具是否仍是预期形态
//
// 只写 .dsh/engineering（被 .gitignore 忽略），不碰源码，不做 Git 操作。
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineeringStore } from '../src/core.js';
import { VerificationRunStore } from '../src/verification-store.js';

const ROOT = path.resolve(argValue('--root') || process.cwd());
const MODE = (argValue('--mode') || 'seed') === 'check' ? 'check' : 'seed';
const RESET = process.argv.includes('--reset');
const ENGINEERING = path.join(ROOT, '.dsh', 'engineering');

function argValue(flag) {
  const at = process.argv.indexOf(flag);
  if (at > 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--')) return process.argv[at + 1];
  return null;
}
const CHANGES = path.join(ENGINEERING, 'changes');
const TEST_PLAN_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-plan.md');

const USER = { kind: 'user', id: 'owner' };
const AGENT = { kind: 'agent', id: 'dsh-agent' };

export const FIXTURES = {
  auto: 'c1000000-0000-4000-8000-000000000001',
  review: 'c2000000-0000-4000-8000-000000000002',
  draft: 'c3000000-0000-4000-8000-000000000003',
};

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  return ok;
}
function report() {
  const failed = checks.filter(c => !c.ok);
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
  if (failed.length) process.exitCode = 1;
  return failed.length === 0;
}

async function archiveExisting() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(ENGINEERING, 'archive', `pre-test-${stamp}`);
  await fs.mkdir(target, { recursive: true });
  const moved = [];
  const skipped = [];
  for (const name of await fs.readdir(ENGINEERING).catch(() => [])) {
    if (name === 'archive' || name === 'FIXTURES.md' || name === 'TEST-PLAN.md') continue;
    const from = path.join(ENGINEERING, name);
    const to = path.join(target, name);
    try {
      await fs.rename(from, to);
      moved.push(name);
    } catch (error) {
      // Windows 上被句柄占用的目录（如 git-smoke 里的 .git）先尝试复制后删除，仍失败则跳过。
      try {
        await fs.cp(from, to, { recursive: true, force: true });
        await fs.rm(from, { recursive: true, force: true, maxRetries: 3 });
        moved.push(name);
      } catch {
        skipped.push(`${name}: ${error.code || error.message}`);
      }
    }
  }
  await fs.mkdir(CHANGES, { recursive: true });
  return { target, moved, skipped };
}

// 夹具要长得像真的跑过：完成的任务留下一条 succeeded 的验证记录，否则门禁会报
// NO_SUCCEEDED_COMMAND（"任务完成但没有成功命令记录"）——那是真实告警，不该由夹具制造。
async function seedRun(changeId, taskId) {
  const store = new VerificationRunStore(ROOT);
  const reserved = await store.reserve({
    changeId, taskId, requestId: `fixture-run-${taskId.toLowerCase()}`,
    hostInstanceId: 'fixture-host', ownerSessionId: 'fixture-session',
    command: 'node scripts/fixtures-report.mjs', planVersion: 1, commandIndex: 0,
  });
  await store.update(changeId, reserved.runId, 'fixture-host', {
    expectedRevision: reserved.revision, state: 'starting', jobId: 'fixture-job', pid: null,
  });
  const started = await store.get(changeId, reserved.runId);
  const now = new Date().toISOString();
  await store.update(changeId, reserved.runId, 'fixture-host', {
    expectedRevision: started.revision, state: 'succeeded', exitCode: 0,
    startedAt: now, finishedAt: now, stdout: 'OK\n', timedOut: false, aborted: false,
  });
  return reserved.runId;
}

// ---- 夹具 A：自动闭环（无需人工审核的任务自己完成）+ 自动架构图 ----
async function seedAuto(store) {
  const id = FIXTURES.auto;
  await store.execute({
    action: 'create', changeId: id, mode: 'lite',
    title: '测试夹具 A：自动闭环与自动架构图',
    goal: '验证任务在证据齐全后由 Agent 自动完成、验收标准变更会清空旧证据、架构图由任务图自动生成并随状态着色。',
  }, USER);
  let { change } = await store.execute({
    action: 'save', changeId: id, expectedRevision: 1, patch: {
      goal: '验证任务在证据齐全后由 Agent 自动完成、验收标准变更会清空旧证据、架构图由任务图自动生成并随状态着色。',
      documents: {
        proposal: '三个任务串成最小闭环：采集事实 → 实现自动完成 → 复核。任务 1 已完成，任务 2 停在 verifying 且只通过一条标准，任务 3 因依赖未完成而不可派发。',
        implementation: '任务 2 在 verifying 期间被 amendTask 追加一条验收标准，旧证据按设计清空并退回 running，再重新进入 verifying。',
        acceptance: '这组夹具本身就是读数：任务 1 绿、任务 2 蓝、任务 3 灰，并带两条依赖边。',
      },
      planning: {
        reviewRequirements: '夹具：不代表真实业务设计，只用于工作台读数。',
        sections: {
          requirements: { status: 'ready', note: '三任务闭环' },
          analysis: { status: 'ready', note: '只碰 .dsh/engineering' },
          architecture: { status: 'ready', note: '自动架构图' },
          interfaces: { status: 'ready', note: '只改 .dsh/engineering 数据，无新接口' },
          tasks: { status: 'ready', note: 'A1→A2→A3' },
          acceptance: { status: 'ready', note: '每条标准一条证据' },
        },
      },
      tasks: [
        { id: 'A1', title: '采集工作区事实', description: '读 package.json 记录插件名与版本。', dependencies: [], expectedFiles: ['scripts/'], acceptanceCriteria: ['记录 package.json 的 name 与 version'], verificationCommands: ['node -e "console.log(require(\'./package.json\').name)"'], affectedModules: ['scripts'] },
        { id: 'A2', title: '实现自动完成路径', description: '证据齐全时 Agent 可把任务推进 completed。', dependencies: ['A1'], expectedFiles: ['src/core.js'], acceptanceCriteria: ['证据齐全后 Agent 可推进 completed', '验收标准变化会清空该任务证据'], verificationCommands: ['npm test'], affectedModules: ['core'] },
        { id: 'A3', title: '复核并记录结论', description: '复核前两个任务的读数并写进 progress。', dependencies: ['A2'], expectedFiles: ['docs/'], acceptanceCriteria: ['复核结论写入 progress.md'], verificationCommands: [], affectedModules: ['docs'] },
      ],
    },
  }, USER);

  change = await approve(store, id);
  // A1：完整走到 completed（requiredApproval=false，agent 可以自己收尾）
  await transition(store, id, 'A1', 'running', AGENT);
  await transition(store, id, 'A1', 'verifying', AGENT);
  await seedRun(id, 'A1');
  await evidence(store, id, 'A1', '记录 package.json 的 name 与 version', 'passed', '@local/dsh-engineering-planner 0.3.0');
  await transition(store, id, 'A1', 'completed', AGENT);
  // A2：verifying 期间发现新验收项 → amendTask → 证据清空、退回 running（因新发现调整任务）
  await transition(store, id, 'A2', 'running', AGENT);
  await transition(store, id, 'A2', 'verifying', AGENT);
  await evidence(store, id, 'A2', '证据齐全后 Agent 可推进 completed', 'passed', 'A1 已自动 completed');
  const amended = await amend(store, id, 'A2', { acceptanceCriteria: ['证据齐全后 Agent 可推进 completed', '验收标准变化会清空该任务证据', 'amendTask 在 history 留下 task-amended'] });
  await transition(store, id, 'A2', 'verifying', AGENT);
  await evidence(store, id, 'A2', '证据齐全后 Agent 可推进 completed', 'passed', 'after amend');
  await evidence(store, id, 'A2', '验收标准变化会清空该任务证据', 'passed', 'history 里 before=2 条、after=3 条标准');
  return { amended };
}

// ---- 夹具 B：需要人工审核的任务停在 awaiting-review ----
async function seedReview(store) {
  const id = FIXTURES.review;
  await store.execute({
    action: 'create', changeId: id, mode: 'standard',
    title: '测试夹具 B：人工审核任务停在待人工审核',
    goal: '验证 requiredApproval 任务在证据齐全后由 Agent 推进 completed 时被改写为 awaiting-review，整条变更状态报 awaiting-review，只有人工确认才真正完成。',
  }, USER);
  await store.execute({
    action: 'save', changeId: id, expectedRevision: 1, patch: {
      documents: {
        proposal: '任务 B1 需要人工收尾，任务 B2 不需要。B1 已由 Agent 备齐证据并请求完成，插件把它停在 awaiting-review。',
        requirements: 'B1：requiredApproval=true；B2：普通任务。',
        architecture: '单条主干：B1 → B2。',
        implementation: 'B1 走 running → verifying → evidence → transition completed(agent) 被改写。',
        acceptance: 'B1 停在 awaiting-review 且证据齐；B2 仍 pending 等待人工放行。',
      },
      planning: {
        reviewRequirements: '夹具：B1 是唯一需要人工确认的任务。',
        sections: {
          requirements: { status: 'ready', note: '' },
          analysis: { status: 'ready', note: '' },
          architecture: { status: 'ready', note: '' },
          interfaces: { status: 'ready', note: '' },
          tasks: { status: 'ready', note: '' },
          acceptance: { status: 'ready', note: '' },
        },
      },
      tasks: [
        { id: 'B1', title: '实现门禁归属（需要人工确认）', description: '收尾必须由用户确认，Agent 只能推进到 awaiting-review。', dependencies: [], expectedFiles: ['src/core.js'], acceptanceCriteria: ['requiredApproval 任务由 Agent 推进 completed 时被改写为 awaiting-review'], verificationCommands: ['npm test'], affectedModules: ['core'], requiredApproval: true },
        { id: 'B2', title: '整理结论文档', description: '普通任务，证据齐即自动完成。', dependencies: ['B1'], expectedFiles: ['docs/'], acceptanceCriteria: ['结论写入进 docs/VERIFICATION.md'], verificationCommands: [], affectedModules: ['docs'] },
      ],
    },
  }, USER);
  await approve(store, id);
  await transition(store, id, 'B1', 'running', AGENT);
  await transition(store, id, 'B1', 'verifying', AGENT);
  await evidence(store, id, 'B1', 'requiredApproval 任务由 Agent 推进 completed 时被改写为 awaiting-review', 'passed', 'core.js:776');
  await transition(store, id, 'B1', 'completed', AGENT);
}

// ---- 夹具 C：对话生成、等待用户批准的规划 ----
async function seedDraft(store) {
  const id = FIXTURES.draft;
  await store.execute({
    action: 'create', changeId: id, mode: 'lite',
    title: '测试夹具 C：待批准的对话规划',
    goal: '验证「对话生成规划 → 人工批准 → 任务自动可派发」的前半段：这里是草稿，批准按钮应当可用，批准后状态变为 approved。',
  }, USER);
  await store.execute({
    action: 'save', changeId: id, expectedRevision: 1, patch: {
      documents: {
        proposal: '两条任务，验收标准齐全，因此可以批准；批准后任务看板立即可以派发。',
        implementation: '批准前 dispatching 应被 APPROVAL_REQUIRED 挡住。',
        acceptance: 'approve 后 status=approved，readyTasks 中两条任务都不再报 APPROVAL_REQUIRED。',
      },
      planning: {
        reviewRequirements: '夹具：六项准备齐全，只差一次人工批准。',
        sections: {
          requirements: { status: 'ready', note: '未批准不得派发' },
          analysis: { status: 'ready', note: '只读 core.js 门禁分支' },
          architecture: { status: 'ready', note: 'C1 → C2' },
          interfaces: { status: 'ready', note: '不改对外接口' },
          tasks: { status: 'ready', note: 'C1→C2' },
          acceptance: { status: 'ready', note: 'approved 读数' },
        },
      },
      tasks: [
        { id: 'C1', title: '实现批准门禁', description: '未批准时不得派发。', dependencies: [], expectedFiles: ['src/core.js'], acceptanceCriteria: ['未批准时 readyTasks 报 APPROVAL_REQUIRED'], verificationCommands: ['npm test'], affectedModules: ['core'] },
        { id: 'C2', title: '记录批准读数', description: '批准后记录状态。', dependencies: ['C1'], expectedFiles: ['docs/'], acceptanceCriteria: ['批准后 status 变为 approved'], verificationCommands: [], affectedModules: ['docs'] },
      ],
    },
  }, USER);
}

async function approve(store, id) {
  const { change } = await store.execute({ action: 'get', changeId: id }, AGENT);
  const result = await store.execute({ action: 'approve', changeId: id, expectedRevision: change.revision, planVersion: change.planVersion }, USER);
  return result.change;
}
async function transition(store, id, taskId, status, actor) {
  const { change } = await store.execute({ action: 'get', changeId: id }, AGENT);
  return store.execute({ action: 'transition', changeId: id, expectedRevision: change.revision, taskId, status }, actor);
}
async function evidence(store, id, taskId, criterion, outcome, note) {
  const { change } = await store.execute({ action: 'get', changeId: id }, AGENT);
  return store.execute({ action: 'evidence', changeId: id, expectedRevision: change.revision, taskId, criterion, outcome, note }, AGENT);
}
async function amend(store, id, taskId, taskPatch) {
  const { change } = await store.execute({ action: 'get', changeId: id }, AGENT);
  return store.execute({ action: 'amendTask', changeId: id, expectedRevision: change.revision, taskId, taskPatch }, AGENT);
}

// ---- 只读断言：四个使用目的各自的可观测结论 ----
async function verify(store) {
  const list = await store.execute({ action: 'list' }, AGENT);
  check('三个夹具都在且列表无残留/损坏告警',
    ['auto', 'review', 'draft'].every(k => list.changes.some(c => c.id === FIXTURES[k])) && list.warnings.length === 0,
    `changes=${list.changes.map(c => c.status).join(',')} warnings=${list.warnings.length}`);
  check('三个夹具 id 与预期一致', ['auto', 'review', 'draft'].every(k => list.changes.some(c => c.id === FIXTURES[k])), '');

  // A：自动完成 + amendTask + 自动架构图输入
  const a = (await store.execute({ action: 'get', changeId: FIXTURES.auto }, AGENT)).change;
  const byId = Object.fromEntries(a.tasks.map(t => [t.id, t]));
  check('A · 目的2 任务1 由 Agent 自行完成', byId.A1.status === 'completed', byId.A1.status);
  check('A · 目的2 任务2 停在 verifying（证据 2/3）', byId.A2.status === 'verifying' && byId.A2.evidence.length === 2, `${byId.A2.status}/${byId.A2.evidence.length}`);
  check('A · 目的2 amendTask 写入 history 且 criteriaChanged', a.history.some(h => h.kind === 'task-amended' && h.taskId === 'A2' && h.criteriaChanged === true), `${a.history.filter(h => h.kind === 'task-amended').length} 条 task-amended`);
  check('A · 目的2 改标准后旧证据被清空（history 记录 before/after）', (() => { const h = a.history.find(x => x.kind === 'task-amended'); return h && h.before.acceptanceCriteria.length === 2 && h.after.acceptanceCriteria.length === 3; })(), '');
  check('A · 变更状态为 running', a.status === 'running', a.status);
  const aReady = await store.execute({ action: 'readyTasks', changeId: FIXTURES.auto }, AGENT);
  check('A · 目的1/2 A3 因依赖未完成不可派发', aReady.tasks.find(t => t.id === 'A3').reasons.some(r => r.code === 'DEPENDENCY_BLOCKED'), JSON.stringify(aReady.ready));
  const aGate = await store.execute({ action: 'gateStatus', changeId: FIXTURES.auto }, AGENT);
  check('A · 门禁未就绪且列出非终态任务', aGate.ready === false && aGate.blockers.some(b => b.code === 'TASK_NOT_TERMINAL'), aGate.blockers.map(b => b.code).join(','));
  check('A · 完成的任务带 succeeded 验证记录（无 NO_SUCCEEDED_COMMAND 噪声）', aGate.warnings.length === 0, aGate.warnings.map(w => w.code).join(','));
  check('A · 架构图输入完整（3 任务 + 2 依赖边 + affectedModules）', a.tasks.length === 3 && a.tasks.reduce((n, t) => n + t.dependencies.length, 0) === 2 && a.tasks.every(t => Array.isArray(t.affectedModules)), '');

  // B：awaiting-review
  const b = (await store.execute({ action: 'get', changeId: FIXTURES.review }, AGENT)).change;
  const b1 = b.tasks.find(t => t.id === 'B1');
  check('B · 目的3 需要人工审核的任务停在 awaiting-review', b1.status === 'awaiting-review', b1.status);
  check('B · 目的3 变更级状态报 awaiting-review', b.status === 'awaiting-review', b.status);
  check('B · awaiting-review 任务证据已齐（1 条 passed）', b1.evidence.length === 1 && b1.evidence[0].outcome === 'passed', '');
  check('B · 目的3 requiredApproval 被持久化', b1.requiredApproval === true, String(b1.requiredApproval));
  check('B · B2 仍 pending（等待人工放行）', b.tasks.find(t => t.id === 'B2').status === 'pending', '');

  // C：待批准
  const c = (await store.execute({ action: 'get', changeId: FIXTURES.draft }, AGENT)).change;
  check('C · 目的1 草稿未批准', c.status === 'draft' && c.approvals.length === 0, c.status);
  const cReady = await store.execute({ action: 'readyTasks', changeId: FIXTURES.draft }, AGENT);
  check('C · 目的1 未批准时任务报 APPROVAL_REQUIRED', cReady.tasks.every(t => t.reasons.some(r => r.code === 'APPROVAL_REQUIRED')), '');
  // 目的1：规划完整度读数（交互界面顶部 6/6 就是从这三组 planning 算出来的）
  const SECTIONS = ['requirements', 'analysis', 'architecture', 'interfaces', 'tasks', 'acceptance'];
  for (const [label, id] of [['A', FIXTURES.auto], ['B', FIXTURES.review], ['C', FIXTURES.draft]]) {
    const s = (await store.execute({ action: 'get', changeId: id }, AGENT)).change;
    const ready = SECTIONS.filter(k => s.planning.sections[k].status === 'ready').length;
    check(`${label} · 目的1 规划完整度 6/6`, ready === 6, `${ready}/6`);
  }
  return report();
}

async function seed(store) {
  if (RESET) {
    const { target, moved } = await archiveExisting();
    check('旧历史整体归档（可用 mv 原路恢复）', moved.length > 0, `${moved.join(', ')} -> ${path.relative(ROOT, target)}`);
    await fs.mkdir(CHANGES, { recursive: true });
  }
  await seedAuto(store);
  await seedReview(store);
  await seedDraft(store);
  await fs.writeFile(path.join(ENGINEERING, 'FIXTURES.md'), [
    '# 测试夹具说明（由 scripts/test-history.mjs seed 生成）',
    '',
    `生成时间：${new Date().toISOString()}`,
    `工作区：${ROOT}`,
    '',
    '| id | 用途 | 预期首屏读数 |',
    '| --- | --- | --- |',
    `| ${FIXTURES.auto} | 目的2 自动完成 + 目的4 自动架构图 | 状态 running；A1 已完成、A2 verifying(2/3)、A3 pending；架构图 3 节点 2 边，绿/蓝/灰 |`,
    `| ${FIXTURES.review} | 目的3 人工审核归属 | 状态 待人工审核；B1 "确认完成"按钮可用、B2 pending |`,
    `| ${FIXTURES.draft} | 目的1 对话生成规划待批准 | 状态 draft；批准按钮可用，派发被 APPROVAL_REQUIRED 挡住 |`,
    '',
    '复测：`node scripts/test-history.mjs --mode check`；重建：`node scripts/test-history.mjs --mode seed --reset`。',
    '旧历史（旧的四个变更 + git-smoke 目录）已整体移到 `.dsh/engineering/archive/legacy-2026-11-19/`，恢复时用 `mv` 移回 `.dsh/engineering/changes/`。',
    '之后每次 `--mode seed --reset` 都会把当时的夹具整体移到 `.dsh/engineering/archive/pre-test-<时间戳>/`，可原路 mv 回来。',
    '人工测试步骤见同目录 `TEST-PLAN.md`（由 `scripts/test-plan.md` 复制而来，seed 不会覆盖手改内容之外的东西）。',
    '',
  ].join('\n'));
  await fs.copyFile(TEST_PLAN_SOURCE, path.join(ENGINEERING, 'TEST-PLAN.md')).catch(() => {});
  return verify(store);
}

const store = new EngineeringStore(ROOT);
await (MODE === 'check' ? verify(store) : seed(store));
