// Pure observation facts only: no Git execution, persistence, approval or evidence.
const FIELDS = ['schemaVersion', 'id', 'changeId', 'planVersion', 'sourceRevision', 'actor',
  'capturedAt', 'finishedAt', 'workspaceRoot', 'repositoryRoot', 'collectorVersion', 'status',
  'head', 'headState', 'dirty', 'scope', 'stagedDiffSha256', 'worktreeDiffSha256',
  'untrackedPathsSha256', 'untrackedCount', 'limitations', 'error'];
// Retained path evidence added after v1 records shipped; both-or-none so old records stay readable.
const OPTIONAL = ['changedPaths', 'untrackedPaths'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const HEAD = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const LIMITATIONS = [
  'untracked-content: paths-only; untracked file contents are not compared',
  'ignored: excluded; ignored files are not compared',
  'excludedPaths: excluded paths are not compared',
  'observations are point-in-time facts, not approval or acceptance evidence',
];
function fail(path, message) {
  throw Object.assign(new Error(`${path}: ${message}`), { code: 'INVALID_GIT_OBSERVATION', path });
}
function requireValue(condition, path, message) { if (!condition) fail(path, message); }
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
// Read descriptors before values: accessors (including nested array getters) never execute.
function object(value, fields, path) {
  requireValue(plain(value), path, 'expected plain object');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  requireValue(keys.length === fields.length && keys.every(key => fields.includes(key)), path, 'unexpected or missing fields');
  const result = {};
  for (const key of fields) {
    const descriptor = descriptors[key];
    requireValue(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable,
      `${path}.${key}`, 'expected enumerable data property');
    requireValue(descriptor.value !== undefined, `${path}.${key}`, 'undefined is not JSON');
    result[key] = descriptor.value;
  }
  return result;
}
function strings(value, path) {
  requireValue(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, path, 'expected plain array');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length.value;
  requireValue(Reflect.ownKeys(descriptors).length === length + 1, path, 'sparse or extended array');
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index];
    requireValue(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable
      && typeof descriptor.value === 'string', `${path}[${index}]`, 'expected string data property');
    result.push(descriptor.value);
  }
  return result;
}
const nonempty = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
const positive = value => Number.isSafeInteger(value) && value > 0;
function timestamp(value, path) {
  requireValue(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), path, 'expected canonical ISO timestamp');
  const time = Date.parse(value);
  requireValue(Number.isFinite(time) && new Date(time).toISOString() === value, path, 'invalid calendar timestamp');
}

/** Validate strict schema v1 and return a detached JSON snapshot; throws INVALID_GIT_OBSERVATION. */
export function validateGitObservation(record) {
  const withPaths = Object.hasOwn(record ?? {}, 'changedPaths') || Object.hasOwn(record ?? {}, 'untrackedPaths');
  const value = object(record, withPaths ? [...FIELDS, ...OPTIONAL] : FIELDS, 'record');
  requireValue(value.schemaVersion === 1, 'record.schemaVersion', 'expected 1');
  for (const key of ['id', 'changeId']) requireValue(typeof value[key] === 'string' && UUID.test(value[key]), `record.${key}`, 'expected UUID');
  for (const key of ['planVersion', 'sourceRevision']) requireValue(positive(value[key]), `record.${key}`, 'expected positive safe integer');
  value.actor = object(value.actor, ['kind', 'id'], 'record.actor');
  requireValue(['agent', 'user'].includes(value.actor.kind) && nonempty(value.actor.id), 'record.actor', 'expected agent or user with nonempty id');
  timestamp(value.capturedAt, 'record.capturedAt');
  timestamp(value.finishedAt, 'record.finishedAt');
  requireValue(value.capturedAt <= value.finishedAt, 'record.finishedAt', 'precedes capturedAt');
  for (const key of ['workspaceRoot', 'repositoryRoot']) requireValue(value[key] === null || nonempty(value[key]), `record.${key}`, 'expected nonempty path or null');
  requireValue(value.collectorVersion === 'git-observation-v1', 'record.collectorVersion', 'unsupported collector');
  requireValue(['ok', 'partial', 'not_git', 'error', 'unstable'].includes(value.status), 'record.status', 'unsupported status');
  requireValue(value.head === null || (typeof value.head === 'string' && HEAD.test(value.head)), 'record.head', 'expected 40/64 hex or null');
  requireValue(['commit', 'unborn', 'unknown'].includes(value.headState), 'record.headState', 'unsupported head state');
  requireValue(value.headState === 'commit' ? value.head !== null : value.head === null, 'record.head', 'inconsistent head state');
  requireValue(value.dirty === null || typeof value.dirty === 'boolean', 'record.dirty', 'expected boolean or null');
  value.scope = object(value.scope, ['tracked', 'untracked', 'ignored', 'excludedPaths'], 'record.scope');
  requireValue(value.scope.tracked === 'git-diff' && value.scope.untracked === 'paths-only' && value.scope.ignored === 'excluded', 'record.scope', 'unsupported scope');
  value.scope.excludedPaths = strings(value.scope.excludedPaths, 'record.scope.excludedPaths');
  for (const key of ['stagedDiffSha256', 'worktreeDiffSha256', 'untrackedPathsSha256']) {
    requireValue(value[key] === null || (typeof value[key] === 'string' && SHA256.test(value[key])), `record.${key}`, 'expected 64 hex or null');
  }
  requireValue(value.untrackedCount === null || (Number.isSafeInteger(value.untrackedCount) && value.untrackedCount >= 0), 'record.untrackedCount', 'expected nonnegative safe integer or null');
  for (const key of withPaths ? OPTIONAL : []) {
    const list = value[key];
    requireValue(list === null || (Array.isArray(list) && list.length <= 2000
      && list.every(item => nonempty(item) && !item.includes('\u0000'))), `record.${key}`, 'expected null or at most 2000 nonempty paths');
    if (Array.isArray(list)) value[key] = [...list];
  }
  value.limitations = strings(value.limitations, 'record.limitations');
  if (value.error !== null) {
    value.error = object(value.error, ['code', 'message'], 'record.error');
    requireValue(nonempty(value.error.code) && nonempty(value.error.message), 'record.error', 'expected nonempty code and message');
  }
  if (value.status === 'ok') {
    requireValue(value.headState !== 'unknown' && value.repositoryRoot !== null && value.dirty !== null
      && value.stagedDiffSha256 !== null && value.worktreeDiffSha256 !== null
      && value.untrackedPathsSha256 !== null && value.untrackedCount !== null && value.error === null,
    'record.status', 'ok requires complete Git facts without error');
  }
  return value;
}

function metadata(value) {
  return { id: value.id, changeId: value.changeId, capturedAt: value.capturedAt, finishedAt: value.finishedAt,
    planVersion: value.planVersion, sourceRevision: value.sourceRevision, status: value.status };
}
const sameHex = (left, right) => left.toLowerCase() === right.toLowerCase();
const scopeKey = scope => JSON.stringify({ ...scope, excludedPaths: [...new Set(scope.excludedPaths)].sort() });

/** Compare recorded facts only. Null means not established; false means an observed difference. */
export function compareGitObservations(baseline, current) {
  const before = validateGitObservation(baseline);
  const after = validateGitObservation(current);
  const reasons = [];
  for (const key of ['changeId', 'workspaceRoot', 'repositoryRoot', 'collectorVersion']) {
    if (before[key] !== after[key]) reasons.push(`${key}: mismatch`);
  }
  for (const key of ['workspaceRoot', 'repositoryRoot']) {
    if (before[key] === null || after[key] === null) reasons.push(`${key}: missing`);
  }
  if (scopeKey(before.scope) !== scopeKey(after.scope)) reasons.push('scope: mismatch');
  if (after.capturedAt < before.finishedAt) reasons.push('time: current observation predates or overlaps baseline completion');
  for (const [name, value] of [['baseline', before], ['current', after]]) {
    if (['not_git', 'error', 'unstable'].includes(value.status)) reasons.push(`${name}.status: ${value.status}`);
  }
  const components = { head: null, staged: null, worktree: null, untrackedPaths: null };
  const bindingComparable = reasons.length === 0;
  if (bindingComparable) {
    if (before.headState === 'unknown' || after.headState === 'unknown') reasons.push('head: unknown');
    else components.head = before.headState === after.headState
      && (before.headState === 'unborn' || sameHex(before.head, after.head));
    for (const [component, field] of [['staged', 'stagedDiffSha256'], ['worktree', 'worktreeDiffSha256'], ['untrackedPaths', 'untrackedPathsSha256']]) {
      if (before[field] === null || after[field] === null) reasons.push(`${component}: missing digest`);
      else components[component] = sameHex(before[field], after[field]);
    }
    if (before.untrackedCount === null || after.untrackedCount === null) {
      components.untrackedPaths = null;
      reasons.push('untrackedPaths: missing count');
    } else if (components.untrackedPaths !== null) components.untrackedPaths &&= before.untrackedCount === after.untrackedCount;
  }
  for (const [name, value] of [['baseline', before], ['current', after]]) {
    if (value.status === 'partial') reasons.push(`${name}.status: partial; truncated or incomplete facts do not establish equality`);
  }
  const comparable = bindingComparable && Object.values(components).every(value => value !== null);
  const complete = before.status === 'ok' && after.status === 'ok';
  let observedEqual = null;
  if (comparable && Object.values(components).includes(false)) observedEqual = false;
  else if (comparable && complete) observedEqual = true;
  return {
    baseline: metadata(before), current: metadata(after), comparable,
    headChanged: comparable ? !components.head : null,
    stagedChanged: comparable ? !components.staged : null,
    worktreeChanged: comparable ? !components.worktree : null,
    untrackedPathsChanged: comparable ? !components.untrackedPaths : null,
    reasons, observedEqual,
    fullWorkspaceEquality: 'not-established',
    limitations: [...new Set([...LIMITATIONS,
      ...[before, after].filter(value => value.status !== 'ok').map(value => `status: ${value.status}; complete observation equality is not established`),
      ...before.limitations, ...after.limitations])],
  };
}
