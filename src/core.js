import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { VerificationRunStore } from './verification-store.js';
import { resolveVerificationRequest } from './verification-request.js';
import { DispatchRunStore } from './dispatch-store.js';
import { cleanTemporaries, createLockFile, isLockContention, lockFileState, lockHolder, staleLockMessage, renameWithRetry } from './lock-retry.js';
import { resolveDispatchRequest } from './dispatch-request.js';
import { readTerminationEvidence } from './termination-evidence.js';

const DOCS = ['proposal', 'requirements', 'architecture', 'implementation', 'impact-analysis', 'acceptance', 'decisions', 'findings'];
const DIAGRAMS = ['architecture', 'sequence', 'data-flow'];
const PLANNING_SECTIONS = ['requirements', 'analysis', 'architecture', 'interfaces', 'tasks', 'acceptance'];
const defaultPlanning = () => ({ reviewRequirements: '', sections: Object.fromEntries(PLANNING_SECTIONS.map(key => [key, { status: 'pending', note: '' }])) });
// Explicit self-reports only; document contents never determine readiness.
function planning(value, base = defaultPlanning()) {
  keys(value, ['reviewRequirements', 'sections'], 'planning');
  const result = clone(base);
  if ('reviewRequirements' in value) result.reviewRequirements = text(value.reviewRequirements, 'reviewRequirements');
  if ('sections' in value) {
    keys(value.sections, PLANNING_SECTIONS, 'planning sections');
    for (const [key, section] of Object.entries(value.sections)) {
      keys(section, ['status', 'note'], `planning ${key}`);
      if ('status' in section) {
        if (!['pending', 'ready'].includes(section.status)) fail('INVALID_INPUT', 'Invalid planning status');
        result.sections[key].status = section.status;
      }
      if ('note' in section) result.sections[key].note = text(section.note, `planning ${key} note`);
    }
  }
  return result;
}
const LIMIT = 2 * 1024 * 1024;
// 派发/验证只推进 run 状态，任务在 run 未结案期间仍是 pending；文件冲突必须把在途 run 算进去。
const INFLIGHT_RUN = new Set(['reserved', 'starting', 'running']);
const queues = new Map();
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = value => structuredClone(value);
function text(value, name, max = 20000, nonempty = false) {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim()) || value.includes('\0')) fail('INVALID_INPUT', `Invalid ${name}`);
  return value;
}
function keys(value, allowed, name) {
  if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('INVALID_INPUT', `Invalid ${name} fields`);
}
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value) || DEVICE_NAME.test(value)) fail('INVALID_ID', 'Invalid identifier');
  return value;
}
function array(value, name, max = 200) {
  if (!Array.isArray(value) || value.length > max) fail('INVALID_INPUT', `Invalid ${name}`);
  return value;
}
function strings(value, name, max = 200) {
  return array(value, name, max).map(v => text(v, name, 4000, true));
}
// 规划元数据：只描述任务怎么被计划执行，不参与 DAG、文件冲突、审批或证据门禁。
// 旧 state 缺少这些键时按默认值读出（见 readState），永远不因此判定 CORRUPT_STATE。
const EXECUTORS = ['local', 'subagent', 'external'];
const TASK_METADATA = ['affectedModules', 'executor', 'requiredApproval', 'maxRetries'];
function taskMetadata(t) {
  const result = { affectedModules: [], executor: 'local', requiredApproval: false, maxRetries: 0 };
  if (Object.hasOwn(t, 'affectedModules')) {
    // 去重后保存；空字符串、纯空白与 NUL 由 text 拒绝，长度上限 200。
    result.affectedModules = [...new Set(array(t.affectedModules, 'affectedModules').map(v => text(v, 'affectedModules', 200, true)))];
  }
  if (Object.hasOwn(t, 'executor')) {
    if (!EXECUTORS.includes(t.executor)) fail('INVALID_INPUT', 'Invalid executor');
    result.executor = t.executor;
  }
  if (Object.hasOwn(t, 'requiredApproval')) {
    if (typeof t.requiredApproval !== 'boolean') fail('INVALID_INPUT', 'Invalid requiredApproval');
    result.requiredApproval = t.requiredApproval;
  }
  if (Object.hasOwn(t, 'maxRetries')) {
    if (!Number.isInteger(t.maxRetries) || t.maxRetries < 0 || t.maxRetries > 10) fail('INVALID_INPUT', 'Invalid maxRetries');
    result.maxRetries = t.maxRetries;
  }
  return result;
}
function fileName(value) {
  text(value, 'expectedFiles', 500, true);
  const normalized = value.replaceAll('\\', '/');
  // A trailing slash declares a directory; everything else must look like a portable relative path.
  const directory = normalized.endsWith('/');
  const body = directory ? normalized.slice(0, -1) : normalized;
  if (body === '' || body.startsWith('/') || /^[a-z]:/i.test(body) || body.split('/').some(p => !p || p === '.' || p === '..' || /[:<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) fail('PATH_UNSAFE', 'Expected file must be a relative portable path');
  return directory ? `${body}/` : body;
}
// A file inside a declared directory is the same scope as the direct declaration.
// 任务能否开始执行由两条规则决定：依赖是否完成、申报文件是否与在跑任务重叠。
// 这两条同时被 transition 与 readyTasks 使用，避免「预览说能开、真开却被拒」。
function startConstraints(s, task, runs) {
  const missing = task.dependencies.filter(id => s.tasks.find(d => d.id === id)?.status !== 'completed');
  const owned = new Set(s.tasks.filter(other => ['running', 'verifying'].includes(other.status)).map(other => other.id));
  for (const run of runs) if (INFLIGHT_RUN.has(run.state)) owned.add(run.taskId);
  const collisions = [];
  for (const other of s.tasks) {
    if (other.id === task.id || !owned.has(other.id)) continue;
    for (const theirs of other.expectedFiles)
      for (const mine of task.expectedFiles)
        if (scopeOverlap(mine, theirs) && !collisions.some(c => c.taskId === other.id && c.theirs === theirs && c.mine === mine))
          collisions.push({ taskId: other.id, theirs, mine });
  }
  return { missing, collisions };
}
function collisionText(collisions) {
  return `${collisions.slice(0, 3).map(c => `${c.mine} overlaps ${c.taskId} ${c.theirs}`).join('; ')}${collisions.length > 3 ? ` (+${collisions.length - 3} more)` : ''}`;
}
function scopeOverlap(a, b) {
  const left = a.toLowerCase(), right = b.toLowerCase();
  if (left === right) return true;
  if (left.endsWith('/')) return right.startsWith(left);
  return right.endsWith('/') && left.startsWith(right);
}
function planTasks(value) {
  const tasks = array(value, 'tasks').map(t => {
    keys(t, ['id', 'title', 'description', 'dependencies', 'expectedFiles', 'acceptanceCriteria', 'verificationCommands', ...TASK_METADATA], 'task');
    return { id: identifier(t.id), title: text(t.title, 'task title', 300, true), description: text(t.description ?? '', 'description'), dependencies: strings(t.dependencies ?? [], 'dependencies').map(identifier), expectedFiles: strings(t.expectedFiles ?? [], 'expectedFiles').map(fileName), acceptanceCriteria: strings(t.acceptanceCriteria ?? [], 'acceptanceCriteria'), verificationCommands: strings(t.verificationCommands ?? [], 'verificationCommands'), ...taskMetadata(t), status: 'pending', evidence: [] };
  });
  const map = new Map(tasks.map(t => [t.id, t]));
  if (map.size !== tasks.length) fail('INVALID_TASKS', 'Duplicate task id');
  const visiting = new Set(), done = new Set();
  function visit(id) {
    if (!map.has(id)) fail('INVALID_TASKS', `Missing dependency: ${id}`);
    if (visiting.has(id)) fail('TASK_CYCLE', 'Task dependencies contain a cycle');
    if (done.has(id)) return;
    visiting.add(id);
    map.get(id).dependencies.forEach(visit);
    visiting.delete(id); done.add(id);
  }
  tasks.forEach(t => {
    if (new Set(t.acceptanceCriteria).size !== t.acceptanceCriteria.length || new Set(t.dependencies).size !== t.dependencies.length) fail('INVALID_TASKS', 'Duplicate criteria or dependencies');
    visit(t.id);
  });
  return tasks;
}
function references(value) {
  const refs = array(value, 'references').map(r => {
    keys(r, ['id', 'title', 'source', 'kind', 'note'], 'reference');
    if (!['reference', 'verified', 'assumption'].includes(r.kind)) fail('INVALID_INPUT', 'Invalid reference kind');
    return { id: identifier(r.id), title: text(r.title, 'reference title', 300, true), source: text(r.source, 'source', 4000, true), kind: r.kind, note: text(r.note ?? '', 'note') };
  });
  if (new Set(refs.map(r => r.id)).size !== refs.length) fail('INVALID_INPUT', 'Duplicate reference id');
  return refs;
}
async function secureDirectory(target) {
  const absolute = path.resolve(target), parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { await fs.mkdir(cursor); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const st = await fs.lstat(cursor);
    if (st.isSymbolicLink() || !st.isDirectory()) fail('PATH_UNSAFE', 'Storage path contains a link or non-directory');
  }
  return absolute;
}
async function safeFile(file, missing = true) {
  try {
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink > 1) fail('PATH_UNSAFE', 'Storage file is not a standalone regular file');
    return st;
  } catch (e) { if (e.code === 'ENOENT' && missing) return null; throw e; }
}
async function readState(file) {
  const st = await safeFile(file);
  if (!st) fail('NOT_FOUND', 'Change not found');
  if (st.size > LIMIT) fail('STATE_TOO_LARGE', 'State exceeds size limit');
  let state;
  try { state = JSON.parse(await fs.readFile(file, 'utf8')); } catch { fail('CORRUPT_STATE', 'State JSON is corrupt'); }
  if (!plain(state) || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || !Array.isArray(state.tasks) || !Array.isArray(state.approvals) || !Array.isArray(state.evidence)) fail('CORRUPT_STATE', 'Invalid stored state');
  // task.evidence 必须是 state.evidence 的按 id 子集，否则手工改写 state.json 就能伪造「有证据」的任务而审计视图为空。
  const evidenceIds = new Set(state.evidence.filter(plain).map(entry => entry.id).filter(value => typeof value === 'string'));
  if (state.tasks.some(task => !plain(task) || !Array.isArray(task.evidence) || task.evidence.some(entry => !plain(entry) || typeof entry.id !== 'string' || !evidenceIds.has(entry.id)))) fail('CORRUPT_STATE', 'Task evidence is not backed by change evidence');
  try { state.planning = Object.hasOwn(state, 'planning') ? planning(state.planning) : defaultPlanning(); }
  catch { fail('CORRUPT_STATE', 'Invalid stored planning'); }
  // 缺失的任务元数据补默认值（向后兼容）；存在但非法仍然是损坏的 state。
  for (const task of state.tasks) {
    let metadata;
    try { metadata = taskMetadata(task); } catch { fail('CORRUPT_STATE', 'Invalid stored task fields'); }
    Object.assign(task, metadata);
  }
  state.deliveryAcceptance ??= null;
  return state;
}
async function atomic(file, content) {
  if (Buffer.byteLength(content) > LIMIT) fail('STATE_TOO_LARGE', 'Output exceeds size limit');
  await safeFile(file);
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8'); await handle.sync(); await handle.close(); handle = null;
    await safeFile(file); await renameWithRetry(temporary, file);
  } finally { if (handle) await handle.close(); await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
async function locked(key, fn) {
  const previous = queues.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  queues.set(key, tail);
  await previous.catch(() => {});
  let handle, held;
  const lock = path.join(key, '.lock');
  try {
    await secureDirectory(key);
    const start = Date.now();
    while (!handle) {
      try { ({ handle, identity: held } = await createLockFile(lock, { pid: process.pid, createdAt: new Date().toISOString() })); }
      catch (e) {
        // Windows reports contention as EPERM/EACCES/EBUSY too, and the holder
        // may unlink after our failure but before lstat. A lock that is gone
        // (or already detached) is a release, not ownership: retry the
        // exclusive open instead of failing the caller.
        if (!isLockContention(e)) throw e;
        if (!await lockFileState(lock)) continue;
        if (Date.now() - start > 3000) fail('LOCK_BUSY', staleLockMessage('Change', await lockHolder(lock)));
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    return await fn();
  } finally {
    let replaced = false;
    try {
      if (handle) {
        await handle.close();
        // Never delete a lock we no longer own: a hardlinked or swapped lock file
        // belongs to someone else, and unlinking it would admit a second writer.
        const current = await fs.lstat(lock).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (current && (!held || current.dev !== held.dev || current.ino !== held.ino || current.nlink !== 1)) replaced = true;
        else await fs.unlink(lock).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    } finally { release(); if (queues.get(key) === tail) queues.delete(key); }
    if (replaced) fail('PATH_UNSAFE', 'Lock replaced during operation');
  }
}
function verificationBlockers(change, runs, taskId) {
  return runs.filter(run => (!taskId || run.taskId === taskId) && (
    ['reserved', 'starting', 'running'].includes(run.state) ||
    (run.state === 'unknown' && !change.history?.some(entry =>
      entry.kind === 'verification-unknown-resolved' && entry.runId === run.runId &&
      entry.runRevision === run.revision && entry.actor?.kind === 'user'))
  ));
}
function assertNoVerificationBlockers(change, runs, taskId) {
  const blockers = verificationBlockers(change, runs, taskId);
  if (blockers.length) fail('VERIFICATION_RUN_BLOCKED', `Verification runs require completion or explicit human resolution: ${blockers.map(run => `${run.runId} (${run.state}${run.jobId ? `, ${run.jobId}` : ''})`).join(', ')}`);
}
function dispatchBlockers(change, runs, taskId) {
  return runs.filter(run => (!taskId || run.taskId === taskId) && (
    ['reserved', 'starting', 'running'].includes(run.state) ||
    (run.state === 'unknown' && !change.history?.some(entry =>
      entry.kind === 'dispatch-unknown-resolved' && entry.runId === run.runId &&
      entry.runRevision === run.revision && entry.actor?.kind === 'user'))
  ));
}
function assertNoDispatchBlockers(change, runs, taskId) {
  const blockers = dispatchBlockers(change, runs, taskId);
  if (blockers.length) fail('DISPATCH_RUN_BLOCKED', `Dispatch runs require completion or explicit human resolution: ${blockers.map(run => `${run.runId} (${run.state})`).join(', ')}`);
}
function terminationEvidence(value) {
  try {
    return readTerminationEvidence(value);
  } catch (error) {
    fail('INVALID_INPUT', error.message || 'Invalid termination evidence');
  }
}
function exactData(value, fields, name) {
  if (!plain(value) || Reflect.ownKeys(value).length !== fields.length || fields.some(key =>
    !Object.hasOwn(value, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')
    || !Object.getOwnPropertyDescriptor(value, key).enumerable)) {
    fail('INVALID_INPUT', `Invalid ${name} fields`);
  }
}
function exactOptionalData(value, required, optional, name) {
  if (!plain(value)) fail('INVALID_INPUT', `Invalid ${name} fields`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (required.some(key => !Object.hasOwn(descriptors, key)) || Reflect.ownKeys(descriptors).some(key =>
    ![...required, ...optional].includes(key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) fail('INVALID_INPUT', `Invalid ${name} fields`);
}
function positiveVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_INPUT', 'Expected positive planVersion');
}
function currentApproval(s) { return s.approvals.some(a => a.planVersion === s.planVersion && a.actor.kind === 'user'); }
/**
 * Read-only delivery gate summary. The same preconditions as acceptDelivery, reported as
 * data instead of thrown errors, so an agent can plan the remaining work without guessing
 * from the UI. It never mutates state or writes runs.
 */
async function readyTasks(s, root) {
  const verification = await new VerificationRunStore(root).list(s.id);
  const dispatch = await new DispatchRunStore(root).list(s.id);
  // 两个存储的记录里没有 kind 字段，这里补上，报告里才能说清是派发还是验证占着。
  const runs = [
    ...verification.map(run => ({ ...run, kind: 'verification' })),
    ...dispatch.map(run => ({ ...run, kind: 'dispatch' }))
  ];
  const approved = currentApproval(s);
  const tasks = s.tasks.map(task => {
    const reasons = [];
    if (task.status !== 'pending') reasons.push({ code: 'TASK_NOT_PENDING', detail: task.status });
    if (!approved) reasons.push({ code: 'APPROVAL_REQUIRED' });
    const { missing, collisions } = startConstraints(s, task, runs);
    if (missing.length) reasons.push({ code: 'DEPENDENCY_BLOCKED', detail: missing.join(', ') });
    if (collisions.length) reasons.push({ code: 'FILE_CONFLICT', detail: collisionText(collisions) });
    for (const run of runs) {
      if (run.taskId !== task.id) continue;
      if (INFLIGHT_RUN.has(run.state)) { reasons.push({ code: 'ACTIVE_RUN', detail: `${run.kind} ${run.runId} ${run.state}` }); continue; }
      if (run.state !== 'unknown') continue;
      const kind = run.kind === 'dispatch' ? 'dispatch-unknown-resolved' : 'verification-unknown-resolved';
      const resolved = s.history?.some(entry => entry.kind === kind && entry.runId === run.runId && entry.runRevision === run.revision && entry.actor?.kind === 'user');
      if (!resolved) reasons.push({ code: 'UNRESOLVED_UNKNOWN', detail: `${run.kind} ${run.runId}` });
    }
    return { id: task.id, title: task.title, status: task.status, dispatchable: reasons.length === 0, reasons };
  });
  return {
    changeId: s.id, revision: s.revision, planVersion: s.planVersion, status: status(s),
    approved, deliveryAccepted: s.deliveryAcceptance?.planVersion === s.planVersion,
    ready: tasks.filter(task => task.dispatchable).map(task => task.id), tasks
  };
}
async function gateStatus(s, root) {
  const verification = await new VerificationRunStore(root).list(s.id);
  const dispatch = await new DispatchRunStore(root).list(s.id);
  const runs = [
    ...verification.map(run => ({ kind: 'verification', runId: run.runId, taskId: run.taskId, state: run.state, jobId: run.jobId ?? null, revision: run.revision })),
    ...dispatch.map(run => ({ kind: 'dispatch', runId: run.runId, taskId: run.taskId, state: run.state, jobId: run.jobId ?? null, revision: run.revision }))
  ];
  const blockers = [];
  if (!currentApproval(s)) blockers.push({ code: 'APPROVAL_REQUIRED' });
  for (const run of runs) {
    if (INFLIGHT_RUN.has(run.state)) {
      blockers.push({ code: 'ACTIVE_RUN', kind: run.kind, runId: run.runId, taskId: run.taskId, state: run.state, jobId: run.jobId });
      continue;
    }
    if (run.state !== 'unknown') continue;
    const kind = run.kind === 'dispatch' ? 'dispatch-unknown-resolved' : 'verification-unknown-resolved';
    const resolved = s.history?.some(entry => entry.kind === kind && entry.runId === run.runId && entry.runRevision === run.revision && entry.actor?.kind === 'user');
    if (!resolved) blockers.push({ code: 'UNRESOLVED_UNKNOWN', kind: run.kind, runId: run.runId, taskId: run.taskId, state: run.state });
  }
  for (const task of s.tasks) {
    if (!['completed', 'cancelled'].includes(task.status)) blockers.push({ code: 'TASK_NOT_TERMINAL', taskId: task.id, status: task.status });
  }
  if (!s.tasks.some(task => task.status === 'completed')) blockers.push({ code: 'NO_COMPLETED_TASK' });
  // Both evidence views must agree, mirroring the completion gate rather than trusting one copy.
  const passed = (list, taskId, criterion) => list.filter(e => e.taskId === taskId && e.criterion === criterion && e.planVersion === s.planVersion).at(-1)?.outcome === 'passed';
  for (const task of s.tasks.filter(task => task.status === 'completed')) {
    for (const criterion of task.acceptanceCriteria) {
      if (!passed(task.evidence, task.id, criterion) || !passed(s.evidence, task.id, criterion)) blockers.push({ code: 'MISSING_EVIDENCE', taskId: task.id, criterion });
    }
  }
  // Evidence and command runs are recorded independently on purpose: a note can
  // be honest about a manual check. But a task whose every criterion is claimed
  // passed while no approved command ever succeeded in this plan version is worth
  // saying out loud. It is a warning, never a blocker.
  const commands = commandSummary(s, verification);
  const warnings = [];
  for (const task of s.tasks.filter(task => task.status === 'completed')) {
    if (!task.acceptanceCriteria.length) continue;
    if (!task.acceptanceCriteria.every(criterion => passed(task.evidence, task.id, criterion))) continue;
    const latest = commands.tasks.find(entry => entry.taskId === task.id);
    if (latest && latest.succeeded === 0 && task.verificationCommands.length > 0) {
      warnings.push({ code: 'NO_SUCCEEDED_COMMAND', taskId: task.id });
    }
  }
  const deliveryAccepted = s.deliveryAcceptance?.planVersion === s.planVersion;
  const counts = Object.fromEntries(['pending', 'running', 'verifying', 'blocked', 'failed', 'completed', 'cancelled'].map(key => [key, s.tasks.filter(task => task.status === key).length]));
  return {
    changeId: s.id, revision: s.revision, planVersion: s.planVersion, status: status(s),
    approved: currentApproval(s), deliveryAccepted, ready: !deliveryAccepted && blockers.length === 0,
    blockers, tasks: counts, runs, commands, warnings
  };
}
// Latest verification attempt per (task, command index) in the current plan
// version only: an older plan's success says nothing about this version.
function commandSummary(s, verification) {
  const perTask = s.tasks.map(task => {
    const entries = task.verificationCommands.map((command, commandIndex) => {
      const attempts = verification
        .filter(run => run.taskId === task.id && run.commandIndex === commandIndex && run.planVersion === s.planVersion)
        .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
      const latest = attempts.at(-1);
      return {
        commandIndex, command,
        state: latest ? latest.state : null,
        runId: latest ? latest.runId : null,
        exitCode: latest && typeof latest.exitCode === 'number' ? latest.exitCode : null
      };
    });
    return {
      taskId: task.id,
      succeeded: entries.filter(entry => entry.state === 'succeeded').length,
      failed: entries.filter(entry => ['failed', 'error', 'timed_out', 'cancelled', 'unknown'].includes(entry.state)).length,
      unrun: entries.filter(entry => entry.state === null).length,
      entries
    };
  });
  return {
    total: perTask.reduce((sum, task) => sum + task.entries.length, 0),
    succeeded: perTask.reduce((sum, task) => sum + task.succeeded, 0),
    failed: perTask.reduce((sum, task) => sum + task.failed, 0),
    unrun: perTask.reduce((sum, task) => sum + task.unrun, 0),
    tasks: perTask
  };
}
function status(s) {
  if (!currentApproval(s)) return 'draft';
  if (s.tasks.length && s.tasks.every(t => t.status === 'completed' || t.status === 'cancelled')) return 'completed';
  // A task whose gate needs a human is not progress the agent can close: surface it as its own state
  // so the workbench can ask for exactly one confirmation instead of showing "running" forever.
  if (s.tasks.some(t => t.status === 'awaiting-review')) return 'awaiting-review';
  return s.startedAt || s.tasks.some(t => t.status !== 'pending') ? 'running' : 'approved';
}
const actions = {
  list: ['action'], create: ['action', 'title', 'goal', 'mode', 'changeId'], get: ['action', 'changeId'],
  save: ['action', 'changeId', 'expectedRevision', 'patch'], approve: ['action', 'changeId', 'expectedRevision', 'planVersion'],
  replan: ['action', 'changeId', 'expectedRevision'],
  acceptDelivery: ['action', 'changeId', 'expectedRevision', 'note'],
  resolveUnknown: ['action', 'changeId', 'expectedRevision', 'runId', 'expectedRunRevision', 'reason'],
  resolveDispatchUnknown: ['action', 'changeId', 'expectedRevision', 'runId', 'expectedRunRevision', 'reason', 'terminationEvidence'],
  abandonRun: ['action', 'changeId', 'kind', 'runId', 'expectedRevision', 'expectedRunRevision', 'reason'],
  terminateRun: ['action', 'changeId', 'kind', 'runId', 'expectedRevision', 'expectedRunRevision', 'reason', 'terminationEvidence'],
  transition: ['action', 'changeId', 'expectedRevision', 'taskId', 'status', 'reason'],
  amendTask: ['action', 'changeId', 'expectedRevision', 'taskId', 'taskPatch'],
  evidence: ['action', 'changeId', 'expectedRevision', 'taskId', 'criterion', 'outcome', 'note', 'artifact'],
  context: ['action', 'changeId'], export: ['action', 'changeId', 'expectedRevision'],
  gateStatus: ['action', 'changeId'],
  readyTasks: ['action', 'changeId']
};

export class EngineeringStore {
  constructor(root) {
    text(root, 'root', 4000, true);
    this.root = path.resolve(root);
    this.directory = path.join(this.root, '.dsh', 'engineering', 'changes');
  }
  /** Host-only admission primitive; reserving does not launch a child or change task status.
   * Lock order: change, then dispatches/runs. Public tool registration is separate.
   */
  async reserveDispatch(request, identity) {
    exactData(request, ['changeId', 'taskId', 'planVersion', 'expectedRevision', 'requestId'], 'dispatch request');
    exactData(identity, ['hostInstanceId', 'ownerSessionId', 'childId'], 'dispatch identity');
    request = clone(request); identity = clone(identity);
    for (const key of ['hostInstanceId', 'ownerSessionId', 'childId']) text(identity[key], key, 4000, true);
    const id = identifier(request.changeId);
    identifier(request.taskId); identifier(request.requestId);
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) fail('REVISION_REQUIRED', 'expectedRevision is required');
    if (!Number.isSafeInteger(request.planVersion) || request.planVersion < 1) fail('PLAN_VERSION_CONFLICT', 'Invalid plan version');
    const directory = path.join(this.directory, id);
    await secureDirectory(this.directory);
    const stat = await fs.lstat(directory).catch(e => { if (e.code === 'ENOENT') fail('NOT_FOUND', 'Change not found'); throw e; });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('PATH_UNSAFE', 'Invalid change directory');
    const runs = new DispatchRunStore(this.root);
    return locked(directory, async () => {
      const change = await readState(path.join(directory, 'state.json'));
      if (change.id !== id) fail('CORRUPT_STATE', 'State identifier mismatch');
      const records = await runs.list(id);
      const existing = records.find(run => run.requestId === request.requestId);
      if (existing) {
        // Requests carry no snapshot hash. Compare only their explicit binding fields.
        for (const key of ['taskId', 'planVersion']) {
          if (existing[key] !== request[key]) fail('REQUEST_CONFLICT', 'Request id already has a different snapshot');
        }
        if (existing.ownerSessionId !== identity.ownerSessionId) fail('REQUEST_CONFLICT', 'Request id belongs to another session');
        return { run: existing, created: false };
      }
      const snapshot = resolveDispatchRequest(change, request);
      // First version serializes the whole change, regardless of declared file scopes.
      assertNoDispatchBlockers(change, records);
      assertNoVerificationBlockers(change, await new VerificationRunStore(this.root).list(id), snapshot.taskId);
      return runs.reserve({ ...snapshot, ...identity });
    });
  }
  /** Called only from an admitted verification tool body. Lock order: change, then runs. */
  async reserveVerification(request, identity) {
    keys(request, ['changeId', 'taskId', 'expectedRevision', 'planVersion', 'commandIndex', 'command', 'requestId'], 'verification request');
    keys(identity, ['hostInstanceId', 'ownerSessionId'], 'verification identity');
    request = clone(request); identity = clone(identity);
    for (const key of ['hostInstanceId', 'ownerSessionId']) text(identity[key], key, 4000, true);
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) fail('REVISION_REQUIRED', 'expectedRevision is required');
    const id = identifier(request.changeId), directory = path.join(this.directory, id);
    await secureDirectory(this.directory);
    const stat = await fs.lstat(directory).catch(e => { if (e.code === 'ENOENT') fail('NOT_FOUND', 'Change not found'); throw e; });
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('PATH_UNSAFE', 'Invalid change directory');
    const runs = new VerificationRunStore(this.root);
    return locked(directory, async () => {
      const change = await readState(path.join(directory, 'state.json'));
      if (change.id !== id) fail('CORRUPT_STATE', 'State identifier mismatch');
      const records = await runs.list(id);
      const existing = records.find(run => run.requestId === request.requestId);
      if (existing) {
        for (const key of ['taskId', 'planVersion', 'commandIndex', 'command']) {
          if (existing[key] !== request[key]) fail('REQUEST_CONFLICT', 'Request id already has a different snapshot');
        }
        if (existing.ownerSessionId !== identity.ownerSessionId) fail('REQUEST_CONFLICT', 'Request id belongs to another session');
        // Replays only observe the original result, even after the plan revision changes.
        return { run: existing, created: false };
      }
      assertNoDispatchBlockers(change, await new DispatchRunStore(this.root).list(id), request.taskId);
      const snapshot = resolveVerificationRequest(change, request);
      assertNoVerificationBlockers(change, records, snapshot.taskId);
      const run = await runs.reserve({ ...snapshot, ...identity });
      return { run, created: true };
    });
  }
  async execute(input, actor = { kind: 'agent', id: 'anonymous' }) {
    if (!plain(input)) fail('INVALID_ACTION', 'Unknown action');
    const actionDescriptor = Object.getOwnPropertyDescriptor(input, 'action');
    if (!actionDescriptor) fail('INVALID_ACTION', 'Unknown action');
    if (!Object.hasOwn(actionDescriptor, 'value') || !actionDescriptor.enumerable) fail('INVALID_INPUT', 'Invalid action field');
    if (typeof input.action !== 'string' || !Object.hasOwn(actions, input.action)) fail('INVALID_ACTION', 'Unknown action');
    if (input.action === 'create') {
      exactOptionalData(input, ['action', 'title', 'goal'], ['mode', 'changeId'], 'create');
      if (Object.hasOwn(input, 'changeId') &&
          (typeof input.changeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.changeId)))
        fail('INVALID_INPUT', 'Creation changeId must be a lowercase UUID v4');
    }
    if (input.action === 'approve') {
      exactOptionalData(input, ['action', 'changeId', 'expectedRevision'], ['planVersion'], 'approval');
      if (Object.hasOwn(input, 'planVersion')) positiveVersion(input.planVersion);
    }
    if (input.action === 'resolveDispatchUnknown') {
      exactData(input, actions.resolveDispatchUnknown, 'dispatch resolution');
      terminationEvidence(input.terminationEvidence);
      text(input.reason, 'resolution reason', 4000, true);
      if (input.reason.includes('\u0000')) fail('INVALID_INPUT', 'Invalid resolution reason');
    }
    if (input.action === 'abandonRun') {
      exactData(input, actions.abandonRun, 'run abandonment');
      if (!['dispatch', 'verification'].includes(input.kind)) fail('INVALID_INPUT', 'Invalid run kind');
      text(input.reason, 'abandonment reason', 4000, true);
      if (input.reason.includes('\u0000')) fail('INVALID_INPUT', 'Invalid abandonment reason');
    }
    if (input.action === 'terminateRun') {
      if (!['dispatch', 'verification'].includes(input.kind)) fail('INVALID_INPUT', 'Invalid run kind');
      text(input.reason, 'termination reason', 4000, true);
      if (input.reason.includes('\u0000')) fail('INVALID_INPUT', 'Invalid termination reason');
      terminationEvidence(input.terminationEvidence);
    }
    keys(input, actions[input.action], 'action');
    keys(actor, ['kind', 'id'], 'actor');
    if (!['user', 'agent'].includes(actor.kind)) fail('INVALID_ACTOR', 'Invalid actor kind');
    text(actor.id, 'actor id', 300, true);
    let serialized;
    try { serialized = JSON.stringify(input); } catch { fail('INVALID_INPUT', 'Input must be JSON serializable'); }
    if (Buffer.byteLength(serialized) > LIMIT) fail('INPUT_TOO_LARGE', 'Input exceeds size limit');
    try { input = clone(input); actor = clone(actor); } catch { fail('INVALID_INPUT', 'Input must contain data only'); }
    await secureDirectory(this.directory);
    const action = input.action;
    if (action === 'list') {
      const changes = [], warnings = [];
      for (const entry of await fs.readdir(this.directory, { withFileTypes: true })) {
        try {
          if (entry.isSymbolicLink()) fail('PATH_UNSAFE', 'Linked change directory');
          if (!entry.isDirectory()) continue;
          identifier(entry.name);
          const s = await readState(path.join(this.directory, entry.name, 'state.json'));
          if (s.id !== entry.name) fail('CORRUPT_STATE', 'State identifier mismatch');
          changes.push({ id: s.id, title: s.title, goal: s.goal, mode: s.mode, revision: s.revision, planVersion: s.planVersion, status: s.status, updatedAt: s.updatedAt, taskCount: s.tasks.length, completedTasks: s.tasks.filter(t => t.status === 'completed').length });
        } catch (error) {
          warnings.push({ changeId: entry.name, code: error.code ?? 'CORRUPT_STATE', message: error.message });
        }
      }
      return { changes: changes.sort((a, b) => a.id.localeCompare(b.id)), warnings: warnings.sort((a, b) => a.changeId.localeCompare(b.changeId)) };
    }
    if (action === 'create') {
      text(input.title, 'title', 300, true); text(input.goal, 'goal');
      if (!['lite', 'standard'].includes(input.mode ?? 'standard')) fail('INVALID_INPUT', 'Invalid mode');
    }
    const id = action === 'create' ? (input.changeId ?? randomUUID()) : identifier(input.changeId);
    const directory = path.join(this.directory, id), file = path.join(directory, 'state.json');
    if (action !== 'create') {
      const stat = await fs.lstat(directory).catch(e => { if (e.code === 'ENOENT') fail('NOT_FOUND', 'Change not found'); throw e; });
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('PATH_UNSAFE', 'Invalid change directory');
    }
    return locked(directory, async () => {
      let s;
      if (action === 'create') {
        if (await safeFile(file)) fail('CHANGE_EXISTS', 'Change already exists; use get to resume');
        if (!['lite', 'standard'].includes(input.mode ?? 'standard')) fail('INVALID_INPUT', 'Invalid mode');
        s = { schemaVersion: 1, id, title: text(input.title, 'title', 300, true), goal: text(input.goal, 'goal'), mode: input.mode ?? 'standard', revision: 1, planVersion: 1, status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), documents: Object.fromEntries(DOCS.map(k => [k, ''])), planning: defaultPlanning(), deliveryAcceptance: null, tasks: [], references: [], approvals: [], evidence: [], history: [], diagrams: Object.fromEntries(DIAGRAMS.map(k => [k, ''])) };
      } else s = await readState(file);
      if (s.id !== id) fail('CORRUPT_STATE', 'State identifier mismatch');
      if (action === 'get') return { change: s };
      if (action === 'readyTasks') return readyTasks(s, this.root);
      if (action === 'gateStatus') return gateStatus(s, this.root);
      if (action === 'context') {
        // 只截断 context 里的 documents 以控制体积，但必须显式报告截断键与原始长度；否则模型把 context 回写 save 会不可逆毁掉文档。
        const documents = {}, documentsTruncated = [], documentLengths = {};
        for (const key of DOCS) {
          const value = s.documents[key] ?? '';
          documentLengths[key] = value.length;
          if (value.length > 1000) documentsTruncated.push(key);
          documents[key] = value.slice(0, 1000);
        }
        // 恢复上下文时一并带上交付门禁的结论：否则模型恢复后还要再查 gateStatus、readyTasks、
        // 两个运行列表才能知道「现在卡在哪」。这里只放结论与仍活动的运行，不放历史记录。
        const gate = await gateStatus(s, this.root);
        const gateBlockers = gate.blockers;
        return { changeId: s.id, title: s.title, goal: s.goal, revision: s.revision, planVersion: s.planVersion, status: s.status, planning: s.planning, deliveryAcceptance: s.deliveryAcceptance, gate: { ready: gate.ready, approved: gate.approved, deliveryAccepted: gate.deliveryAccepted, blockerCodes: [...new Set(gateBlockers.map(blocker => blocker.code))], activeRuns: gate.runs.filter(run => INFLIGHT_RUN.has(run.state)), unresolvedUnknownRuns: gateBlockers.filter(blocker => blocker.code === 'UNRESOLVED_UNKNOWN'), commands: { total: gate.commands.total, succeeded: gate.commands.succeeded, failed: gate.commands.failed, unrun: gate.commands.unrun } }, documents, documentsTruncated, documentLengths, references: s.references, approvals: s.approvals, tasks: s.tasks.map(t => ({ id: t.id, title: t.title, status: t.status, dependencies: t.dependencies, expectedFiles: t.expectedFiles, acceptanceCriteria: t.acceptanceCriteria, affectedModules: t.affectedModules, executor: t.executor, requiredApproval: t.requiredApproval, maxRetries: t.maxRetries, reason: t.reason ?? null, evidence: t.evidence.map(e => ({ criterion: e.criterion, outcome: e.outcome, planVersion: e.planVersion, actor: e.actor })) })) };
      }
      if (action !== 'create') {
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('REVISION_REQUIRED', 'expectedRevision is required');
        if (input.expectedRevision !== s.revision) fail('REVISION_CONFLICT', 'State revision changed');
      }
      if (['replan', 'resolveUnknown', 'resolveDispatchUnknown', 'acceptDelivery', 'abandonRun', 'terminateRun'].includes(action) && actor.kind !== 'user') fail('FORBIDDEN', 'Only a user can perform this operation');
      let verificationRuns = [], dispatchRuns = [];
      if (['save', 'replan', 'transition', 'acceptDelivery'].includes(action)) {
        verificationRuns = await new VerificationRunStore(this.root).list(id);
        assertNoVerificationBlockers(s, verificationRuns, action === 'transition' ? input.taskId : undefined);
      }
      if (['save', 'replan', 'acceptDelivery', 'transition', 'evidence'].includes(action)) {
        dispatchRuns = await new DispatchRunStore(this.root).list(id);
        assertNoDispatchBlockers(s, dispatchRuns, ['transition', 'evidence'].includes(action) ? input.taskId : undefined);
      }
      if (action === 'acceptDelivery') {
        const note = text(input.note, 'delivery acceptance note', 20000, true);
        if (!currentApproval(s)) fail('APPROVAL_REQUIRED', 'Current plan must be approved');
        if (s.deliveryAcceptance?.planVersion === s.planVersion) fail('INVALID_STATE', 'Current delivery was already accepted');
        if (!s.tasks.length || !s.tasks.every(t => ['completed', 'cancelled'].includes(t.status)) || !s.tasks.some(t => t.status === 'completed')) fail('DELIVERY_NOT_READY', 'Delivery requires all tasks completed or cancelled and at least one completed task');
        // Explicit human delivery confirmation, not a test run or task evidence.
        s.deliveryAcceptance = { planVersion: s.planVersion, actor, acceptedAt: new Date().toISOString(), note };
      }
      if (action === 'resolveDispatchUnknown') {
        const run = await new DispatchRunStore(this.root).get(id, identifier(input.runId));
        if (!Number.isSafeInteger(input.expectedRunRevision) || input.expectedRunRevision < 1) fail('REVISION_REQUIRED', 'expectedRunRevision is required');
        if (run.revision !== input.expectedRunRevision) fail('REVISION_CONFLICT', 'Dispatch run revision changed');
        if (run.state !== 'unknown') fail('INVALID_STATE', 'Only unknown dispatch runs can be resolved');
        if (!dispatchBlockers(s, [run]).length) fail('INVALID_STATE', 'Dispatch run was already resolved');
        // A human attestation releases the blocker; it does not stop or observe processes.
        s.history.push({ kind: 'dispatch-unknown-resolved', runId: run.runId, runRevision: run.revision,
          taskId: run.taskId, planVersion: run.planVersion, taskSnapshotHash: run.taskSnapshotHash,
          hostInstanceId: run.hostInstanceId, ownerSessionId: run.ownerSessionId, childId: run.childId,
          jobId: run.jobId ?? null, actor, reason: input.reason,
          terminationEvidence: input.terminationEvidence, recordedAt: new Date().toISOString() });
      }
      if (action === 'resolveUnknown') {
        const run = await new VerificationRunStore(this.root).get(id, identifier(input.runId));
        if (!Number.isSafeInteger(input.expectedRunRevision) || input.expectedRunRevision < 1) fail('REVISION_REQUIRED', 'expectedRunRevision is required');
        if (run.revision !== input.expectedRunRevision) fail('REVISION_CONFLICT', 'Verification run revision changed');
        if (run.state !== 'unknown') fail('INVALID_STATE', 'Only unknown verification runs can be resolved');
        if (!verificationBlockers(s, [run]).length) fail('INVALID_STATE', 'Verification run was already resolved');
        s.history.push({ kind: 'verification-unknown-resolved', runId: run.runId, runRevision: run.revision,
          actor, reason: text(input.reason, 'resolution reason', 4000, true), recordedAt: new Date().toISOString() });
      }
      if (action === 'abandonRun') {
        // Human-only escape hatch for a reservation that never started. starting/running runs are deliberately
        // out of scope: releasing them needs execution termination evidence, which this action does not collect.
        const runKind = input.kind, runs = runKind === 'dispatch' ? new DispatchRunStore(this.root) : new VerificationRunStore(this.root);
        const run = await runs.get(id, identifier(input.runId));
        if (run.changeId !== id) fail('CORRUPT_STATE', 'Run belongs to a different change');
        if (!Number.isSafeInteger(input.expectedRunRevision) || input.expectedRunRevision < 1) fail('REVISION_REQUIRED', 'expectedRunRevision is required');
        if (run.revision !== input.expectedRunRevision) fail('REVISION_CONFLICT', `${runKind === 'dispatch' ? 'Dispatch' : 'Verification'} run revision changed`);
        // A missing jobId is the proof that no child agent or process was ever launched for this reservation.
        if (run.state !== 'reserved' || run.jobId != null) fail('ABANDON_NOT_RESERVED', 'Only a never-started reservation can be abandoned');
        const at = new Date().toISOString(), reason = text(input.reason, 'abandonment reason', 4000, true);
        const cancelled = await runs.update(id, run.runId, run.hostInstanceId,
          { expectedRevision: run.revision, state: 'cancelled', reason, abandoned: { actor, reason, at } });
        // Only the change history and revision move; task status, evidence, approvals, delivery acceptance and
        // planVersion stay untouched, so the same change can be saved, replanned or transitioned afterwards.
        s.history.push({ kind: 'run-abandoned', runKind, runId: cancelled.runId, runRevision: cancelled.revision,
          actor, reason, at });
      }
      if (action === 'terminateRun') {
        // Human-only escape hatch for a run that reached starting/running but whose job is no longer
        // attached in this process. The Host verifies that first (the jobs registry is process-local);
        // this action records the human's termination attestation and closes the run as cancelled.
        // It deliberately does not claim the process is gone: nothing here can observe that.
        const runKind = input.kind, runs = runKind === 'dispatch' ? new DispatchRunStore(this.root) : new VerificationRunStore(this.root);
        const run = await runs.get(id, identifier(input.runId));
        if (run.changeId !== id) fail('CORRUPT_STATE', 'Run belongs to a different change');
        if (!Number.isSafeInteger(input.expectedRunRevision) || input.expectedRunRevision < 1) fail('REVISION_REQUIRED', 'expectedRunRevision is required');
        if (run.revision !== input.expectedRunRevision) fail('REVISION_CONFLICT', `${runKind === 'dispatch' ? 'Dispatch' : 'Verification'} run revision changed`);
        if (!['starting', 'running'].includes(run.state)) fail('INVALID_STATE', 'Only a started run can be terminated this way');
        if (!run.jobId) fail('INVALID_STATE', 'A run without a job never started; abandon it instead');
        const at = new Date().toISOString(), reason = text(input.reason, 'termination reason', 4000, true);
        const evidence = terminationEvidence(input.terminationEvidence);
        const cancelled = await runs.update(id, run.runId, run.hostInstanceId,
          { expectedRevision: run.revision, state: 'cancelled', reason, abandoned: { actor, reason, at }, terminationEvidence: evidence });
        s.history.push({ kind: 'run-terminated-unattached', runKind, runId: cancelled.runId, runRevision: cancelled.revision,
          taskId: run.taskId, planVersion: run.planVersion, jobId: run.jobId,
          hostInstanceId: run.hostInstanceId, ownerSessionId: run.ownerSessionId,
          childId: run.childId ?? null, actor, reason, terminationEvidence: evidence, at });
      }
      if (action === 'save') {
        if (!['draft', 'approved'].includes(s.status)) fail('PLAN_LOCKED', 'Plan has started');
        keys(input.patch, ['title', 'goal', 'documents', 'tasks', 'references', 'diagrams', 'planning'], 'patch');
        const previousPlan = currentApproval(s) ? clone(s) : null;
        if (previousPlan) delete previousPlan.history;
        const p = input.patch;
        if ('planning' in p) s.planning = planning(p.planning, s.planning);
        if ('diagrams' in p) { keys(p.diagrams, DIAGRAMS, 'diagrams'); for (const [key, value] of Object.entries(p.diagrams)) s.diagrams[key] = text(value, key, 100000); }
        if ('title' in p) s.title = text(p.title, 'title', 300, true);
        if ('goal' in p) s.goal = text(p.goal, 'goal');
        if ('documents' in p) { keys(p.documents, DOCS, 'documents'); for (const [key, value] of Object.entries(p.documents)) s.documents[key] = text(value, key, 100000); }
        if ('tasks' in p) s.tasks = planTasks(p.tasks);
        if ('references' in p) s.references = references(p.references);
        if (currentApproval(s)) {
          s.history.push({ kind: 'plan-invalidated', recordedAt: new Date().toISOString(), actor, snapshot: previousPlan });
          s.planVersion++; s.approvals = []; s.evidence = []; s.deliveryAcceptance = null;
          s.tasks.forEach(t => { t.status = 'pending'; t.evidence = []; delete t.reason; });
        }
      }
      if (action === 'replan') {
        if (actor.kind !== 'user') fail('FORBIDDEN', 'Only a user can replan');
        if (s.tasks.some(t => ['running', 'verifying'].includes(t.status))) fail('PLAN_LOCKED', 'Stop active tasks before replanning');
        const snapshot = clone(s); delete snapshot.history;
        s.history.push({ kind: 'replan', recordedAt: new Date().toISOString(), actor, snapshot });
        s.planVersion++; s.approvals = []; s.evidence = []; s.deliveryAcceptance = null; delete s.startedAt;
        s.tasks.forEach(t => { t.status = 'pending'; t.evidence = []; delete t.reason; });
      }
      if (action === 'approve') {
        if (actor.kind !== 'user') fail('FORBIDDEN', 'Only a user can approve');
        if (s.status !== 'draft') fail('INVALID_STATE', 'Only draft plans can be approved');
        if (!s.goal.trim() || !s.tasks.length || s.tasks.some(t => !t.acceptanceCriteria.length)) fail('INCOMPLETE_PLAN', 'Goal, tasks and acceptance criteria are required');
        if (Object.hasOwn(input, 'planVersion') && input.planVersion !== s.planVersion) fail('PLAN_VERSION_CONFLICT', 'Plan version changed');
        s.approvals.push({ planVersion: s.planVersion, actor, recordedAt: new Date().toISOString() });
      }
      if (action === 'amendTask') {
        // Discovery during execution changes the task, not the plan version: the approved goal and the
        // existing approvals stay valid, so the work continues instead of demanding a human replan.
        if (s.deliveryAcceptance?.planVersion === s.planVersion) fail('DELIVERY_LOCKED', 'Accepted delivery requires human replan before task changes');
        if (!currentApproval(s)) fail('APPROVAL_REQUIRED', 'Current plan must be approved');
        const task = s.tasks.find(t => t.id === input.taskId);
        if (!task) fail('TASK_NOT_FOUND', 'Task not found');
        if (['completed', 'cancelled'].includes(task.status)) fail('INVALID_STATE', 'A completed or cancelled task cannot be amended');
        if (!input.taskPatch || typeof input.taskPatch !== 'object' || Array.isArray(input.taskPatch)) fail('INVALID_INPUT', 'taskPatch must be an object');
        keys(input.taskPatch, ['title', 'description', 'dependencies', 'expectedFiles', 'acceptanceCriteria', 'verificationCommands', 'affectedModules', 'executor', 'requiredApproval', 'maxRetries'], 'task patch');
        const projection = t => ({ id: t.id, title: t.title, description: t.description, dependencies: t.dependencies, expectedFiles: t.expectedFiles, acceptanceCriteria: t.acceptanceCriteria, verificationCommands: t.verificationCommands, affectedModules: t.affectedModules, executor: t.executor, requiredApproval: t.requiredApproval, maxRetries: t.maxRetries });
        // Reuse the plan validator instead of a second copy of the rules, so amended tasks obey the same
        // dependency cycle, duplicate id and expectedFiles checks as planned ones.
        const candidate = s.tasks.map(t => t.id === task.id ? { ...t, ...input.taskPatch } : t).map(projection);
        const validated = planTasks(candidate).find(t => t.id === task.id);
        const before = projection(task);
        const criteriaChanged = JSON.stringify(validated.acceptanceCriteria) !== JSON.stringify(task.acceptanceCriteria);
        Object.assign(task, {
          title: validated.title, description: validated.description, dependencies: validated.dependencies,
          expectedFiles: validated.expectedFiles, acceptanceCriteria: validated.acceptanceCriteria,
          verificationCommands: validated.verificationCommands, affectedModules: validated.affectedModules,
          executor: validated.executor, requiredApproval: validated.requiredApproval, maxRetries: validated.maxRetries,
        });
        if (criteriaChanged) {
          // Evidence is keyed by criterion: keeping it would let stale passes satisfy the new wording.
          task.evidence = [];
          s.evidence = s.evidence.filter(e => e.taskId !== task.id);
          if (task.status === 'verifying') task.status = 'running';
        }
        s.history.push({ kind: 'task-amended', taskId: task.id, planVersion: s.planVersion, actor, recordedAt: new Date().toISOString(), before, after: projection(task), criteriaChanged });
      }
      if (['transition', 'evidence'].includes(action)) {
        if (s.deliveryAcceptance?.planVersion === s.planVersion) fail('DELIVERY_LOCKED', 'Accepted delivery requires human replan before task changes');
        if (!currentApproval(s)) fail('APPROVAL_REQUIRED', 'Current plan must be approved');
        const t = s.tasks.find(t => t.id === input.taskId);
        if (!t) fail('TASK_NOT_FOUND', 'Task not found');
        if (action === 'evidence') {
          // 验收证据在 verifying 记录；失败/阻塞后的复盘也要能记，否则「为什么失败」只能
          // 卡在任务的上一状态里写，人一推进状态就再也补不回来。
          const postMortem = t.status === 'failed' || t.status === 'blocked';
          if (t.status !== 'verifying' && !postMortem) fail('INVALID_STATE', 'Evidence requires verifying, failed or blocked state');
          if (!t.acceptanceCriteria.includes(input.criterion) || !['passed', 'failed'].includes(input.outcome)) fail('INVALID_INPUT', 'Invalid evidence criterion or outcome');
          // 失败/阻塞任务只能追加失败证据：否则可以绕开 verifying 直接给「通过」。
          if (postMortem && input.outcome !== 'failed') fail('INVALID_STATE', 'A failed or blocked task only accepts failed evidence');
          if (s.evidence.length >= 2000) fail('LIMIT_EXCEEDED', 'Too many evidence records');
          const evidence = { id: randomUUID(), taskId: t.id, criterion: input.criterion, outcome: input.outcome, note: text(input.note ?? '', 'note'), artifact: text(input.artifact ?? '', 'artifact', 4000), planVersion: s.planVersion, actor, recordedAt: new Date().toISOString() };
          if (!evidence.note.trim() && !evidence.artifact.trim()) fail('EVIDENCE_EMPTY', 'Evidence requires a nonempty note or artifact');
          s.evidence.push(evidence); t.evidence.push(evidence);
        } else {
          const transitions = { pending: ['running', 'blocked', 'cancelled'], running: ['verifying', 'blocked', 'failed', 'cancelled'], verifying: ['running', 'blocked', 'failed', 'completed', 'awaiting-review', 'cancelled'], 'awaiting-review': ['running', 'blocked', 'cancelled', 'completed'], blocked: ['pending', 'running', 'cancelled'], failed: ['pending', 'running', 'cancelled'], completed: [], cancelled: ['pending'] };
          // The gate decides who may close a task: a task flagged requiredApproval can never be
          // completed by the executor, so its completion request lands in awaiting-review instead of
          // failing. Tasks without the flag close automatically once every criterion has passed.
          let target = input.status;
          if (target === 'completed' && t.requiredApproval && actor.kind !== 'user') target = 'awaiting-review';
          if (!transitions[t.status]?.includes(target)) fail('INVALID_TRANSITION', 'Invalid task transition');
          if (target === 'running') {
            // 依赖指向已被删除的任务时，`?.status` 让缺失依赖走同一个门禁，而不是抛 TypeError。
            const { missing, collisions } = startConstraints(s, t, [...verificationRuns, ...dispatchRuns]);
            if (missing.length) fail('DEPENDENCY_BLOCKED', 'Dependencies are not complete');
            // 冲突要能定位：只说「文件被占用」等于让用户自己猜是哪两个任务、哪两条路径撞上了。
            if (collisions.length) fail('FILE_CONFLICT', collisionText(collisions));
            s.startedAt ??= new Date().toISOString();
            if (t.evidence.length) s.history.push({ kind: 'task-restarted', taskId: t.id, planVersion: s.planVersion, actor, recordedAt: new Date().toISOString(), evidence: clone(t.evidence) });
            t.evidence = []; s.evidence = s.evidence.filter(e => e.taskId !== t.id);
          }
          if (target === 'completed' || target === 'awaiting-review') {
            // 任务视图与审计视图必须同时通过：只看 t.evidence 时，外部改写 state.json 就能让没有 change.evidence 的任务完成。
            const passed = (list, criterion) => list.filter(e => e.taskId === t.id && e.criterion === criterion && e.planVersion === s.planVersion).at(-1)?.outcome === 'passed';
            if (t.acceptanceCriteria.some(criterion => !passed(t.evidence, criterion) || !passed(s.evidence, criterion))) fail('EVIDENCE_REQUIRED', 'Each acceptance criterion requires current passed evidence');
          }
          if (target === 'blocked') t.reason = text(input.reason, 'block reason', 4000, true);
          else delete t.reason;
          t.status = target;
        }
      }
      if (action === 'export') {
        const files = [];
        const lite = s.mode === 'lite';
        const nodeIds = new Map(s.tasks.map((t, index) => [t.id, `task${index}`]));
        const label = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', ' ').replaceAll('\r', ' ').replaceAll('`', '&#96;');
        const dag = ['flowchart TD', ...s.tasks.map(t => `  ${nodeIds.get(t.id)}["${label(t.title)}<br/>${label(t.status)}"]`), ...s.tasks.flatMap(t => t.dependencies.map(d => `  ${nodeIds.get(d)} --> ${nodeIds.get(t.id)}`))].join('\n') + '\n';
        const diagrams = DIAGRAMS.filter(key => !lite || s.diagrams[key].trim()).map(key => [key, s.diagrams[key]]);
        if (!lite || s.tasks.length) diagrams.push(['task-dag', dag]);
        if (diagrams.length) {
          const diagramDirectory = await secureDirectory(path.join(directory, 'diagrams'));
          for (const [key, value] of diagrams) {
            const target = path.join(diagramDirectory, `${key}.mmd`); await atomic(target, value); files.push(target);
          }
        }
        // Only write this export's projections; previously exported files are retained.
        for (const key of DOCS.filter(key => !lite || ['proposal', 'implementation', 'acceptance'].includes(key) || s.documents[key].trim())) {
          const target = path.join(directory, `${key}.md`); await atomic(target, s.documents[key]); files.push(target);
        }
        const tasks = path.join(directory, 'tasks.json'); await atomic(tasks, JSON.stringify(s.tasks, null, 2) + '\n'); files.push(tasks);
        // An exported plan must not look verified just because a command ran under an older version,
        // nor look unverified because the reader cannot see the run records at all.
        const verificationList = await new VerificationRunStore(this.root).list(s.id);
        const dispatchList = await new DispatchRunStore(this.root).list(s.id);
        const currentRuns = [
          ...verificationList.map(run => ({ kind: 'verification', run })),
          ...dispatchList.map(run => ({ kind: 'dispatch', run })),
        ].filter(entry => entry.run.planVersion === s.planVersion);
        const runSection = currentRuns.length
          ? '\n\n## Runs for this plan version\n\n' + currentRuns.map(({ kind, run }) => {
            const detail = kind === 'verification' ? ` (command ${run.commandIndex}: ${run.command})` : '';
            const code = run.exitCode === null || run.exitCode === undefined ? '' : `, exit ${run.exitCode}`;
            return `- ${kind} ${run.runId}: ${run.taskId} — ${run.state}${detail}${code}`;
          }).join('\n') + '\n\nRuntime records are host-observed attempts, not acceptance: a succeeded command is not a passed criterion, and a returned dispatch is not a completed task.\n'
          : '\n\n## Runs for this plan version\n\nNo verification or dispatch run is recorded for this plan version. That is not proof the commands were never run elsewhere.\n';
        const progress = path.join(directory, 'progress.md');
        const acceptance = s.deliveryAcceptance;
        const delivery = '\n\n## Delivery acceptance (explicit human confirmation)\n\n' +
          (acceptance ? `Accepted plan version: ${acceptance.planVersion}\nActor: ${acceptance.actor.kind}:${acceptance.actor.id}\nAccepted at: ${acceptance.acceptedAt}\nNote: ${acceptance.note}\n` : 'Not accepted for the current plan version.\n') +
          '\nThis records user delivery confirmation, not independent execution testing.\n';
        await atomic(progress, `# ${s.title}\n\n${s.goal}\n\nRevision: ${s.revision}\nPlan version: ${s.planVersion}\nStatus: ${s.status}\n\n` + `## Planning readiness (self-reported)\n\nReview requirements: ${s.planning.reviewRequirements}\n\n` + PLANNING_SECTIONS.map(key => `- ${key}: ${s.planning.sections[key].status}\n  ${s.planning.sections[key].note}`).join('\n') + '\n\n## Tasks\n\n' + s.tasks.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.id}: ${t.title} — ${t.status}${t.reason ? ` (${t.reason})` : ''}`).join('\n') + '\n' + runSection + delivery); files.push(progress);
        // Retention is deliberate: an export never deletes files. That also means a directory can hold
        // projections from an earlier export (for example standard exports followed by a lite one).
        // Record what this run wrote and which known projections it did not, so the caller can tell
        // the difference instead of trusting whatever sits in the folder.
        const written = new Set(files.map(file => path.relative(directory, file).split(path.sep).join('/')));
        const known = [...DOCS.map(key => `${key}.md`), ...DIAGRAMS.map(key => `${key}.mmd`), 'task-dag.mmd', 'tasks.json', 'progress.md'];
        let present = [];
        try { present = (await fs.readdir(directory)).filter(name => known.includes(name)); } catch {}
        try { present.push(...(await fs.readdir(path.join(directory, 'diagrams'))).filter(name => known.includes(name)).map(name => `diagrams/${name}`)); } catch {}
        const stale = [...new Set(present)].filter(name => !written.has(name)).sort();
        const manifestPath = path.join(directory, 'manifest.json');
        await atomic(manifestPath, JSON.stringify({ schemaVersion: 1, changeId: s.id, planVersion: s.planVersion, revision: s.revision, mode: s.mode, exportedAt: new Date().toISOString(), files: [...written].sort(), stale }, null, 2) + '\n');
        return { change: s, files, manifest: manifestPath, stale };
      }
      if (action !== 'create') s.revision++;
      s.status = status(s); s.updatedAt = new Date().toISOString();
      await cleanTemporaries(directory);
      await atomic(file, JSON.stringify(s, null, 2) + '\n');
      return { change: s };
    });
  }
}
