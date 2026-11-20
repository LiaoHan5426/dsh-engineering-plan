/**
 * Pure scope audit: compare declared task scope against observed working-tree paths.
 *
 * This is evidence, not enforcement — it never changes a plan, approval or task state.
 */

const LIMIT = 2000;

function normalizePath(value) {
  if (typeof value !== 'string') throw invalid('path must be a string');
  if (value === '' || value.includes('\u0000')) throw invalid('path must be non-empty and free of NUL');
  return value.split('\\').join('/');
}

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_SCOPE_INPUT';
  return error;
}

function pathList(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalid(`${name} must be an array of paths`);
  if (value.length > LIMIT) throw invalid(`${name} has more than ${LIMIT} entries`);
  const seen = new Set();
  for (const item of value) seen.add(normalizePath(item));
  return [...seen].sort();
}

// Windows and macOS treat these paths case-insensitively, and the conflict gate
// (`scopeOverlap` in core) already does the same. The audit must not disagree with
// the gate about whether two spellings of one file are the same file.
function fold(value) {
  return value.toLowerCase();
}

function declares(declared, path) {
  if (declared === path) return true;
  return declared.endsWith('/') && path.startsWith(declared);
}

/**
 * @param {{tasks?: Array<{id:string, expectedFiles?: string[]}>, changedPaths?: string[], untrackedPaths?: string[]}} input
 */
export function auditScope(input) {
  const tasks = Array.isArray(input?.tasks) ? input.tasks : [];
  const changed = pathList(input?.changedPaths, 'changedPaths');
  const untracked = pathList(input?.untrackedPaths, 'untrackedPaths');

  const declarations = [];
  for (const task of tasks) {
    if (typeof task?.id !== 'string' || task.id === '') throw invalid('task id must be a non-empty string');
    for (const declared of pathList(task.expectedFiles, `expectedFiles of ${task.id}`))
      declarations.push({ taskId: task.id, path: declared, key: fold(declared) });
  }

  const owners = (path) => declarations.filter((item) => declares(item.key, fold(path))).map((item) => item.taskId);

  const entries = [];
  for (const path of changed) entries.push({ path, kind: 'tracked', declaredBy: owners(path) });
  for (const path of untracked) entries.push({ path, kind: 'untracked', declaredBy: owners(path) });

  const undeclared = entries.filter((entry) => entry.declaredBy.length === 0).map((entry) => entry.path);
  const matched = new Set(entries.flatMap((entry) => entry.declaredBy));
  const untouched = declarations
    .filter((item) => !matched.has(item.taskId))
    .map((item) => ({ taskId: item.taskId, path: item.path }));

  return {
    entries,
    undeclared,
    untouched,
    declaredCount: entries.length - undeclared.length,
    changedCount: changed.length,
    untrackedCount: untracked.length,
  };
}
