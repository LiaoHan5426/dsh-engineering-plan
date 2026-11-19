import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) fail('INVALID_ID', 'Invalid identifier');
  return value;
}
function array(value, name, max = 200) {
  if (!Array.isArray(value) || value.length > max) fail('INVALID_INPUT', `Invalid ${name}`);
  return value;
}
function strings(value, name, max = 200) {
  return array(value, name, max).map(v => text(v, name, 4000, true));
}
function fileName(value) {
  text(value, 'expectedFiles', 500, true);
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').some(p => !p || p === '.' || p === '..' || /[:<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) fail('PATH_UNSAFE', 'Expected file must be a relative portable path');
  return normalized;
}
function planTasks(value) {
  const tasks = array(value, 'tasks').map(t => {
    keys(t, ['id', 'title', 'description', 'dependencies', 'expectedFiles', 'acceptanceCriteria', 'verificationCommands'], 'task');
    return { id: identifier(t.id), title: text(t.title, 'task title', 300, true), description: text(t.description ?? '', 'description'), dependencies: strings(t.dependencies ?? [], 'dependencies').map(identifier), expectedFiles: strings(t.expectedFiles ?? [], 'expectedFiles').map(fileName), acceptanceCriteria: strings(t.acceptanceCriteria ?? [], 'acceptanceCriteria'), verificationCommands: strings(t.verificationCommands ?? [], 'verificationCommands'), status: 'pending', evidence: [] };
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
  try { state.planning = Object.hasOwn(state, 'planning') ? planning(state.planning) : defaultPlanning(); }
  catch { fail('CORRUPT_STATE', 'Invalid stored planning'); }
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
    await safeFile(file); await fs.rename(temporary, file);
  } finally { if (handle) await handle.close(); await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
async function locked(key, fn) {
  const previous = queues.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  queues.set(key, tail);
  await previous.catch(() => {});
  let handle;
  const lock = path.join(key, '.lock');
  try {
    await secureDirectory(key);
    const start = Date.now();
    while (!handle) {
      try { handle = await fs.open(lock, 'wx', 0o600); }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        await safeFile(lock, false);
        if (Date.now() - start > 3000) fail('LOCK_BUSY', 'Change is locked; inspect stale lock after confirming its process exited');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return await fn();
  } finally {
    try { if (handle) { await handle.close(); await fs.unlink(lock); } }
    finally { release(); if (queues.get(key) === tail) queues.delete(key); }
  }
}
function currentApproval(s) { return s.approvals.some(a => a.planVersion === s.planVersion && a.actor.kind === 'user'); }
function status(s) {
  if (!currentApproval(s)) return 'draft';
  if (s.tasks.length && s.tasks.every(t => t.status === 'completed' || t.status === 'cancelled')) return 'completed';
  return s.startedAt || s.tasks.some(t => t.status !== 'pending') ? 'running' : 'approved';
}
const actions = {
  list: ['action'], create: ['action', 'title', 'goal', 'mode'], get: ['action', 'changeId'],
  save: ['action', 'changeId', 'expectedRevision', 'patch'], approve: ['action', 'changeId', 'expectedRevision'],
  replan: ['action', 'changeId', 'expectedRevision'],
  transition: ['action', 'changeId', 'expectedRevision', 'taskId', 'status', 'reason'],
  evidence: ['action', 'changeId', 'expectedRevision', 'taskId', 'criterion', 'outcome', 'note', 'artifact'],
  context: ['action', 'changeId'], export: ['action', 'changeId', 'expectedRevision']
};

export class EngineeringStore {
  constructor(root) {
    text(root, 'root', 4000, true);
    this.root = path.resolve(root);
    this.directory = path.join(this.root, '.dsh', 'engineering', 'changes');
  }
  async execute(input, actor = { kind: 'agent', id: 'anonymous' }) {
    if (!plain(input) || typeof input.action !== 'string' || !Object.hasOwn(actions, input.action)) fail('INVALID_ACTION', 'Unknown action');
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
    const id = action === 'create' ? randomUUID() : identifier(input.changeId);
    const directory = path.join(this.directory, id), file = path.join(directory, 'state.json');
    if (action !== 'create') {
      const stat = await fs.lstat(directory).catch(e => { if (e.code === 'ENOENT') fail('NOT_FOUND', 'Change not found'); throw e; });
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('PATH_UNSAFE', 'Invalid change directory');
    }
    return locked(directory, async () => {
      let s;
      if (action === 'create') {
        if (!['lite', 'standard'].includes(input.mode ?? 'standard')) fail('INVALID_INPUT', 'Invalid mode');
        s = { schemaVersion: 1, id, title: text(input.title, 'title', 300, true), goal: text(input.goal, 'goal'), mode: input.mode ?? 'standard', revision: 1, planVersion: 1, status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), documents: Object.fromEntries(DOCS.map(k => [k, ''])), planning: defaultPlanning(), tasks: [], references: [], approvals: [], evidence: [], history: [], diagrams: Object.fromEntries(DIAGRAMS.map(k => [k, ''])) };
      } else s = await readState(file);
      if (s.id !== id) fail('CORRUPT_STATE', 'State identifier mismatch');
      if (action === 'get') return { change: s };
      if (action === 'context') return { changeId: s.id, title: s.title, goal: s.goal, revision: s.revision, planVersion: s.planVersion, status: s.status, planning: s.planning, documents: Object.fromEntries(Object.entries(s.documents).map(([k, v]) => [k, v.slice(0, 1000)])), references: s.references, approvals: s.approvals, tasks: s.tasks.map(t => ({ id: t.id, title: t.title, status: t.status, dependencies: t.dependencies, expectedFiles: t.expectedFiles, acceptanceCriteria: t.acceptanceCriteria, reason: t.reason, evidence: t.evidence.map(e => ({ criterion: e.criterion, outcome: e.outcome, planVersion: e.planVersion, actor: e.actor })) })) };
      if (action !== 'create') {
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('REVISION_REQUIRED', 'expectedRevision is required');
        if (input.expectedRevision !== s.revision) fail('REVISION_CONFLICT', 'State revision changed');
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
          s.planVersion++; s.approvals = []; s.evidence = [];
          s.tasks.forEach(t => { t.status = 'pending'; t.evidence = []; delete t.reason; });
        }
      }
      if (action === 'replan') {
        if (actor.kind !== 'user') fail('FORBIDDEN', 'Only a user can replan');
        if (s.tasks.some(t => ['running', 'verifying'].includes(t.status))) fail('PLAN_LOCKED', 'Stop active tasks before replanning');
        const snapshot = clone(s); delete snapshot.history;
        s.history.push({ kind: 'replan', recordedAt: new Date().toISOString(), actor, snapshot });
        s.planVersion++; s.approvals = []; s.evidence = []; delete s.startedAt;
        s.tasks.forEach(t => { t.status = 'pending'; t.evidence = []; delete t.reason; });
      }
      if (action === 'approve') {
        if (actor.kind !== 'user') fail('FORBIDDEN', 'Only a user can approve');
        if (s.status !== 'draft') fail('INVALID_STATE', 'Only draft plans can be approved');
        if (!s.goal.trim() || !s.tasks.length || s.tasks.some(t => !t.acceptanceCriteria.length)) fail('INCOMPLETE_PLAN', 'Goal, tasks and acceptance criteria are required');
        s.approvals.push({ planVersion: s.planVersion, actor, recordedAt: new Date().toISOString() });
      }
      if (['transition', 'evidence'].includes(action)) {
        if (!currentApproval(s)) fail('APPROVAL_REQUIRED', 'Current plan must be approved');
        const t = s.tasks.find(t => t.id === input.taskId);
        if (!t) fail('TASK_NOT_FOUND', 'Task not found');
        if (action === 'evidence') {
          if (t.status !== 'verifying') fail('INVALID_STATE', 'Evidence requires verifying state');
          if (!t.acceptanceCriteria.includes(input.criterion) || !['passed', 'failed'].includes(input.outcome)) fail('INVALID_INPUT', 'Invalid evidence criterion or outcome');
          if (s.evidence.length >= 2000) fail('LIMIT_EXCEEDED', 'Too many evidence records');
          const evidence = { id: randomUUID(), taskId: t.id, criterion: input.criterion, outcome: input.outcome, note: text(input.note ?? '', 'note'), artifact: text(input.artifact ?? '', 'artifact', 4000), planVersion: s.planVersion, actor, recordedAt: new Date().toISOString() };
          if (!evidence.note.trim() && !evidence.artifact.trim()) fail('EVIDENCE_EMPTY', 'Evidence requires a nonempty note or artifact');
          s.evidence.push(evidence); t.evidence.push(evidence);
        } else {
          const transitions = { pending: ['running', 'blocked', 'cancelled'], running: ['verifying', 'blocked', 'failed', 'cancelled'], verifying: ['running', 'blocked', 'failed', 'completed', 'cancelled'], blocked: ['pending', 'running', 'cancelled'], failed: ['pending', 'running', 'cancelled'], completed: [], cancelled: ['pending'] };
          if (!transitions[t.status]?.includes(input.status)) fail('INVALID_TRANSITION', 'Invalid task transition');
          if (input.status === 'running') {
            if (t.dependencies.some(id => s.tasks.find(d => d.id === id).status !== 'completed')) fail('DEPENDENCY_BLOCKED', 'Dependencies are not complete');
            const files = new Set(t.expectedFiles.map(f => f.toLowerCase()));
            if (s.tasks.some(other => other.id !== t.id && ['running', 'verifying'].includes(other.status) && other.expectedFiles.some(f => files.has(f.toLowerCase())))) fail('FILE_CONFLICT', 'Expected files are in use');
            s.startedAt ??= new Date().toISOString();
            if (t.evidence.length) s.history.push({ kind: 'task-restarted', taskId: t.id, planVersion: s.planVersion, actor, recordedAt: new Date().toISOString(), evidence: clone(t.evidence) });
            t.evidence = []; s.evidence = s.evidence.filter(e => e.taskId !== t.id);
          }
          if (input.status === 'completed' && t.acceptanceCriteria.some(c => t.evidence.filter(e => e.criterion === c && e.planVersion === s.planVersion).at(-1)?.outcome !== 'passed')) fail('EVIDENCE_REQUIRED', 'Each acceptance criterion requires current passed evidence');
          if (input.status === 'blocked') t.reason = text(input.reason, 'block reason', 4000, true);
          else delete t.reason;
          t.status = input.status;
        }
      }
      if (action === 'export') {
        const files = [];
        const diagramDirectory = await secureDirectory(path.join(directory, 'diagrams'));
        const nodeIds = new Map(s.tasks.map((t, index) => [t.id, `task${index}`]));
        const label = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', ' ').replaceAll('\r', ' ').replaceAll('`', '&#96;');
        const dag = ['flowchart TD', ...s.tasks.map(t => `  ${nodeIds.get(t.id)}["${label(t.title)}"]`), ...s.tasks.flatMap(t => t.dependencies.map(d => `  ${nodeIds.get(d)} --> ${nodeIds.get(t.id)}`))].join('\n') + '\n';
        for (const [key, value] of [...DIAGRAMS.map(k => [k, s.diagrams[k]]), ['task-dag', dag]]) {
          const target = path.join(diagramDirectory, `${key}.mmd`); await atomic(target, value); files.push(target);
        }
        for (const key of DOCS) { const target = path.join(directory, `${key}.md`); await atomic(target, s.documents[key]); files.push(target); }
        const tasks = path.join(directory, 'tasks.json'); await atomic(tasks, JSON.stringify(s.tasks, null, 2) + '\n'); files.push(tasks);
        const progress = path.join(directory, 'progress.md');
        await atomic(progress, `# ${s.title}\n\n${s.goal}\n\nRevision: ${s.revision}\nPlan version: ${s.planVersion}\nStatus: ${s.status}\n\n` + `## Planning readiness (self-reported)\n\nReview requirements: ${s.planning.reviewRequirements}\n\n` + PLANNING_SECTIONS.map(key => `- ${key}: ${s.planning.sections[key].status}\n  ${s.planning.sections[key].note}`).join('\n') + '\n\n## Tasks\n\n' + s.tasks.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.id}: ${t.title} — ${t.status}${t.reason ? ` (${t.reason})` : ''}`).join('\n') + '\n'); files.push(progress);
        return { change: s, files };
      }
      if (action !== 'create') s.revision++;
      s.status = status(s); s.updatedAt = new Date().toISOString();
      await atomic(file, JSON.stringify(s, null, 2) + '\n');
      return { change: s };
    });
  }
}
