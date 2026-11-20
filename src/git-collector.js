import path from 'node:path';
import { createHash } from 'node:crypto';

const MAX_BYTES = 1024 * 1024;
// Diffs are hashed and then dropped, never retained as evidence text. A single
// large text file (this plugin's own client.js is ~3.9 MB) makes the diff far
// bigger than the retained-evidence budget, so diff streams get their own cap
// and are not charged against MAX_BYTES; they still fail closed when truncated.
const DIFF_BYTES = 16 * 1024 * 1024;
const DIFF_KEYS = new Set(['staged', 'worktree']);
const EOL_WARNING = /^warning: in the working copy of '.+', (LF will be replaced by CRLF|CRLF will be replaced by LF) the next time Git touches it$/;
const EOL_LIMITATION = 'eol-normalization: Git warned that working-tree line endings will be rewritten';
const PREFIX = 'git --no-pager -c core.fsmonitor=false -c core.untrackedCache=false -c diff.external= -c diff.renames=false -c status.renames=false -c diff.submodule=short -c diff.algorithm=myers -c color.ui=false';
const PATHS = " -- . ':(top,exclude).dsh/engineering' ':(top,exclude).dsh/engineering/**'";
const DIFF = 'diff --binary --full-index --no-ext-diff --no-textconv --no-renames --diff-algorithm=myers --no-indent-heuristic --no-color --src-prefix=a/ --dst-prefix=b/ --unified=3 --ignore-submodules=none';
// Closed command set: neither the tool arguments nor Git output become shell syntax.
const COMMANDS = Object.freeze({
  root: 'rev-parse --show-toplevel',
  head: "rev-parse --verify --quiet 'HEAD^{commit}'",
  symbolic: 'symbolic-ref --quiet HEAD',
  rawHead: 'rev-parse --verify --quiet HEAD',
  refs: "for-each-ref --format='%(refname)' refs/heads/",
  status: 'status --porcelain=v2 -z --untracked-files=all --ignore-submodules=none' + PATHS,
  flags: 'ls-files -v -z' + PATHS,
  index: 'ls-files --stage -z' + PATHS,
  staged: DIFF + ' --cached' + PATHS,
  worktree: DIFF + PATHS,
});
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const failure = (code, message) => Object.assign(new Error(message), { code });
// Path lists are retained as evidence of *what* changed (never the content), so a
// plan can be audited against observed scope. The list is capped to stay small.
const PATH_LIMIT = 2000;
const PATH_CAP_LIMITATION = `changed-paths: lists are capped at ${PATH_LIMIT} entries`;
function capped(list) {
  const unique = [...new Set(list)].sort();
  return { paths: unique.slice(0, PATH_LIMIT), truncated: unique.length > PATH_LIMIT };
}
const excluded = value => value === '.dsh/engineering' || value.startsWith('.dsh/engineering/');
const oid = value => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
const normalize = value => path.resolve(value);
function nulRecords(text) {
  if (text === '') return [];
  if (!text.endsWith('\0')) throw failure('invalid_git_output', 'NUL record stream is incomplete');
  return text.slice(0, -1).split('\0');
}
function parseStatus(text) {
  const records = nulRecords(text), tracked = [], untracked = [], limitations = [], paths = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith('? ')) {
      const name = record.slice(2);
      if (!name) throw failure('invalid_git_output', 'Empty untracked path');
      if (!excluded(name)) untracked.push(name);
      continue;
    }
    // Renames may still be reported by status; the original path is its own NUL record.
    const kind = record[0], count = kind === '1' ? 8 : kind === '2' ? 9 : kind === 'u' ? 10 : 0;
    if (!count) throw failure('invalid_git_output', 'Unknown porcelain v2 record');
    let cursor = 0;
    for (let field = 0; field < count; field++) {
      cursor = record.indexOf(' ', cursor) + 1;
      if (!cursor) throw failure('invalid_git_output', 'Malformed porcelain v2 fields');
    }
    const name = record.slice(cursor), fields = record.slice(0, cursor - 1).split(' ');
    const original = kind === '2' ? records[++i] : null;
    if (!name || (kind === '2' && !original)) throw failure('invalid_git_output', 'Missing porcelain path');
    if (excluded(name) && (original === null || excluded(original))) continue;
    if (original !== null && (excluded(name) || excluded(original))) limitations.push('rename-crosses-excluded-path');
    if (!/^[.MADRCUT?!]{2}$/.test(fields[1]) || !/^(N\.\.\.|S[.C][.M][.U])$/.test(fields[2]))
      throw failure('invalid_git_output', 'Malformed porcelain state');
    if (kind === 'u') limitations.push('unmerged-index: conflicts are not fully represented by diffs');
    if (fields[2][0] === 'S') limitations.push('submodules: nested content is not covered');
    tracked.push(record, ...(original === null ? [] : [original]));
    paths.push(name, ...(original === null ? [] : [original]));
  }
  untracked.sort();
  paths.sort();
  return { tracked, untracked, paths, limitations };
}
function parseIndex(text, flags) {
  const kept = [], limitations = [];
  for (const record of nulRecords(text)) {
    const match = flags ? /^([A-Za-z?]) (.+)$/s.exec(record)
      : /^(\d{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])\t(.+)$/s.exec(record);
    if (!match) throw failure('invalid_git_output', 'Malformed index record');
    const name = flags ? match[2] : match[4];
    if (excluded(name)) continue;
    kept.push(record);
    if (flags && match[1] !== 'H') limitations.push('special-index-flags: assume-unchanged, skip-worktree or other nonstandard index state');
    if (!flags && match[1] === '160000') limitations.push('submodules: nested content is not covered');
    if (!flags && match[3] !== '0') limitations.push('unmerged-index: conflicts are not fully represented by diffs');
  }
  return { kept, limitations };
}

/**
 * Internal adapter for an already admitted model ToolExecution. The caller owns
 * pipeline admission, workspace selection and persistence metadata. No tool is
 * registered here. Hashes describe two matching observations, not a transaction.
 * Shell output is UTF-8 text; replacement characters fail closed. We never read
 * spill files or untracked contents. stderr's native cap is executor-owned.
 */
export async function collectGitObservation(ctx, exec, { workspaceRoot, signal } = {}) {
  const capturedAt = new Date().toISOString();
  const result = { schemaVersion: 1, capturedAt, finishedAt: capturedAt,
    workspaceRoot: typeof workspaceRoot === 'string' ? workspaceRoot : null, repositoryRoot: null,
    collectorVersion: 'git-observation-v1', status: 'error', head: null, headState: 'unknown', dirty: null,
    scope: { tracked: 'git-diff', untracked: 'paths-only', ignored: 'excluded', excludedPaths: ['.dsh/engineering/**'] },
    stagedDiffSha256: null, worktreeDiffSha256: null, untrackedPathsSha256: null, untrackedCount: null,
    changedPaths: null, untrackedPaths: null,
    limitations: ['untracked-content: paths-only; untracked file contents are not compared',
      'ignored: excluded; ignored files are not compared', 'excludedPaths: excluded paths are not compared',
      'two-pass observation is not a transactional lock; intervening changes may escape detection',
      'digests cover Git UTF-8 output, not arbitrary raw filesystem bytes',
      'inherited Git environment/configuration (including GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and GIT_CONFIG_*) may select alternate state or affect diffs; canonical full worktree coverage is not established'], error: null };
  const controller = new AbortController();
  const sources = [...new Set([exec?.signal, signal].filter(Boolean))];
  const cancel = () => controller.abort();
  let budget = MAX_BYTES;
  async function run(key, allowed = [0]) {
    controller.signal.throwIfAborted();
    const sandboxPolicy = ctx.sandboxPolicy.resolve({ session: exec.agent.session });
    if (!sandboxPolicy || typeof sandboxPolicy.workspaceRoot !== 'string'
        || normalize(sandboxPolicy.workspaceRoot) !== normalize(workspaceRoot))
      throw failure('workspace_changed', 'Sandbox workspace differs from the pinned workspace');
    const spec = ctx.shell.resolve({ command: `${PREFIX} ${COMMANDS[key]}`, workdir: workspaceRoot,
      sandboxPolicy, dshEnv: ctx.shellEnv.collect(exec), signal: controller.signal,
      env: { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat', LC_ALL: 'C', LANG: 'C' },
      onExpiry: 'kill', timeoutMs: 15000,
      stdoutMaxBytes: DIFF_KEYS.has(key) ? DIFF_BYTES : Math.max(1, budget) });
    let proc, pending, killError;
    const kill = () => {
      try { proc?.kill(); } catch (error) { killError = error; }
    };
    controller.signal.addEventListener('abort', kill, { once: true });
    try {
      controller.signal.throwIfAborted();
      proc = await ctx.shell.execute(spec);
      pending = Promise.resolve().then(() => proc.result());
      pending.catch(() => {});
      if (controller.signal.aborted) proc.kill();
      const output = await pending;
      await proc.done;
      if (controller.signal.aborted || output?.aborted === true) throw failure('aborted', `Git ${key} aborted`);
      if (output?.timedOut === true) throw failure('timeout', `Git ${key} timed out`);
      if (output?.signal !== null || output?.aborted !== false || output?.timedOut !== false
          || !Number.isInteger(output?.exitCode)) throw failure('invalid_shell_result', `Git ${key} has no complete exit result`);
      if (output.sandbox?.denied || output.sandbox?.runnerFailed) throw failure('sandbox_error', `Git ${key} sandbox failed`);
      for (const channel of ['stdout', 'stderr']) {
        const stream = output[channel];
        if (!stream || stream.truncated !== false || typeof stream.text !== 'string')
          throw failure('output_truncated', `Git ${key} ${channel} is incomplete`);
        if (!(channel === 'stdout' && DIFF_KEYS.has(key))) {
          budget -= Buffer.byteLength(stream.text, 'utf8');
          if (budget < 0) throw failure('output_limit', 'Git observation exceeded the 1 MiB aggregate output budget');
        }
        if (stream.text.includes('\ufffd')) throw failure('output_encoding', 'Git output contains ambiguous UTF-8 replacement characters');
      }
      if (killError) throw failure('cleanup_error', `Git ${key} cancellation cleanup failed: ${killError.message}`);
      if (!allowed.includes(output.exitCode)) throw failure('git_exit', `Git ${key} exited with code ${output.exitCode}: ${output.stderr.text.slice(0, 240)}`);
      if (output.exitCode === 0 && output.stderr.text !== '') {
        // `core.autocrlf` makes `git diff` print line-ending warnings on stderr while
        // exiting 0. Those are informational, but everything else still fails closed.
        const lines = output.stderr.text.split(/\r?\n/).filter(line => line !== '');
        if (!lines.every(line => EOL_WARNING.test(line)))
          throw failure('git_diagnostic', `Git ${key} reported a diagnostic: ${output.stderr.text.slice(0, 240)}`);
        if (!result.limitations.includes(EOL_LIMITATION)) result.limitations.push(EOL_LIMITATION);
      }
      return output;
    } catch (error) {
      if (proc) {
        try { proc.kill(); } catch (cleanupError) {
          throw failure('cleanup_error', `${error.message}; kill failed: ${cleanupError.message}`);
        } finally { await Promise.allSettled([proc.done, pending]); }
      }
      throw error;
    } finally { controller.signal.removeEventListener('abort', kill); }
  }
  async function root() {
    const output = await run('root', [0, 128]);
    if (output.exitCode === 128) {
      if (output.stdout.text === '' && /^fatal: not a git repository \(or any of the parent directories\): \.git\r?\n?$/.test(output.stderr.text))
        throw failure('not_git', 'Workspace is not a Git repository');
      throw failure('repository_discovery_failed', 'Git repository discovery failed');
    }
    const value = output.stdout.text.replace(/\r?\n$/, '');
    if (!value || value.includes('\n') || value.includes('\0') || !path.isAbsolute(value))
      throw failure('invalid_repository_root', 'Git did not return an absolute repository root');
    result.repositoryRoot = value;
    if (normalize(value) !== normalize(workspaceRoot))
      throw failure('repository_outside_workspace', 'Repository root differs from workspace; content collection stopped');
    return normalize(value);
  }
  async function pass(repositoryRoot) {
    const headResult = await run('head', [0, 1]);
    let head = null, headState = 'unborn', symbolic = null;
    if (headResult.exitCode === 0) {
      head = headResult.stdout.text.trim();
      if (!oid(head)) throw failure('invalid_head', 'HEAD is not a commit object id');
      headState = 'commit';
    } else {
      if (headResult.stdout.text || headResult.stderr.text) throw failure('head_unknown', 'HEAD failure is not evidence of an unborn branch');
      symbolic = (await run('symbolic')).stdout.text.replace(/\r?\n$/, '');
      if (!/^refs\/heads\/[^\s\0]+$/.test(symbolic)) throw failure('head_unknown', 'HEAD is not a verified symbolic branch');
      const raw = await run('rawHead', [0, 1]);
      const refs = (await run('refs')).stdout.text.split(/\r?\n/).filter(Boolean);
      if (raw.exitCode !== 1 || raw.stdout.text || raw.stderr.text || refs.includes(symbolic)
          || refs.some(ref => !/^refs\/heads\/[^\s\0]+$/.test(ref)))
        throw failure('head_unknown', 'Unborn HEAD could not be established');
    }
    const status = parseStatus((await run('status')).stdout.text);
    const flags = parseIndex((await run('flags')).stdout.text, true);
    const index = parseIndex((await run('index')).stdout.text, false);
    const staged = hash((await run('staged')).stdout.text);
    const worktree = hash((await run('worktree')).stdout.text);
    return { repositoryRoot, head, headState, symbolic, staged, worktree,
      status: status.tracked, untracked: status.untracked, paths: status.paths, flags: flags.kept, index: index.kept,
      limitations: [...new Set([...status.limitations, ...flags.limitations, ...index.limitations])] };
  }
  try {
    if (!exec?.agent?.id || !exec.agent.session || !exec.callId || !exec.rootCallId || !exec.signal)
      throw failure('invalid_execution', 'An admitted agent tool execution is required');
    if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot) || workspaceRoot.includes('\0'))
      throw failure('invalid_workspace', 'Workspace root must be an absolute path');
    for (const source of sources) {
      source.addEventListener('abort', cancel, { once: true });
      if (source.aborted) controller.abort();
    }
    const before = await pass(await root());
    const after = await pass(await root());
    controller.signal.throwIfAborted();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      result.status = 'unstable';
      result.error = { code: 'observation_changed', message: 'The two complete Git observations differ' };
    } else {
      Object.assign(result, { status: after.limitations.length ? 'partial' : 'ok', head: after.head, headState: after.headState,
        dirty: after.status.length > 0 || after.untracked.length > 0 || after.staged !== hash('') || after.worktree !== hash(''),
        stagedDiffSha256: after.staged, worktreeDiffSha256: after.worktree,
        untrackedPathsSha256: hash(after.untracked.map(name => name + '\0').join('')), untrackedCount: after.untracked.length });
      const changed = capped(after.paths);
      const untrackedPaths = capped(after.untracked);
      result.changedPaths = changed.paths;
      result.untrackedPaths = untrackedPaths.paths;
      if (changed.truncated || untrackedPaths.truncated) result.limitations.push(PATH_CAP_LIMITATION);
      result.limitations.push(...after.limitations);
    }
  } catch (error) {
    const code = controller.signal.aborted ? 'aborted' : error.code || 'collection_error';
    result.status = code === 'not_git' ? 'not_git' : code === 'repository_outside_workspace' ? 'partial' : 'error';
    result.error = { code, message: String(error.message || error).slice(0, 512) };
  } finally {
    for (const source of sources) source.removeEventListener('abort', cancel);
    result.finishedAt = new Date().toISOString();
  }
  return result;
}
