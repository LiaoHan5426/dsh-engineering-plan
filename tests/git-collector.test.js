import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectGitObservation } from '../src/git-collector.js';
import { validateGitObservation } from '../src/git-comparison.js';

const ROOT = path.resolve('fixture workspace');
const HEAD = 'a'.repeat(40);
const sha = value => createHash('sha256').update(value).digest('hex');
const ok = (text = '', patch = {}) => ({ exitCode: 0, signal: null, timedOut: false, aborted: false,
  timeoutMs: 15000, stdout: { text, truncated: false }, stderr: { text: '', truncated: false }, ...patch });
function harness(override = () => undefined) {
  const requests = [], policies = [], environments = [], executions = [], killed = [];
  const controller = new AbortController();
  const exec = { agent: { id: 'agent-1', session: { header: { cwd: ROOT } } },
    callId: 'call-1', rootCallId: 'call-1', signal: controller.signal };
  let round = 0;
  const ctx = {
    sandboxPolicy: { resolve(request) { policies.push(request); return { mode: 'read-only', workspaceRoot: ROOT }; } },
    shellEnv: { collect(value) { environments.push(value); return { DSH_TEST: 'trusted' }; } },
    shell: {
      resolve(request) { requests.push(request); return { ...request, resolved: true }; },
      async execute(spec) {
        executions.push(spec);
        let key;
        if (spec.command.includes('rev-parse --show-toplevel')) { key = 'root'; round++; }
        else if (spec.command.includes('HEAD^{commit}')) key = 'head';
        else if (spec.command.includes('symbolic-ref')) key = 'symbolic';
        else if (spec.command.includes('rev-parse --verify')) key = 'rawHead';
        else if (spec.command.includes('for-each-ref')) key = 'refs';
        else if (spec.command.includes('status --porcelain')) key = 'status';
        else if (spec.command.includes('ls-files -v')) key = 'flags';
        else if (spec.command.includes('ls-files --stage')) key = 'index';
        else if (spec.command.includes('--cached')) key = 'staged';
        else if (spec.command.includes('diff --binary')) key = 'worktree';
        else assert.fail(`Unexpected command: ${spec.command}`);
        const defaults = { root: ROOT + '\n', head: HEAD + '\n', flags: 'H file\0',
          index: `100644 ${HEAD} 0\tfile\0`, status: '', staged: '', worktree: '' };
        const custom = override({ key, round, spec, controller, requests });
        if (custom instanceof Error) throw custom;
        if (custom?.handle) return custom.handle;
        return { done: Promise.resolve(), kill() { killed.push(key); return true; },
          result: async () => custom ?? ok(defaults[key] ?? '') };
      },
    },
  };
  const collect = options => collectGitObservation(ctx, exec, { workspaceRoot: ROOT, ...options });
  return { ctx, exec, controller, requests, policies, environments, executions, killed, collect };
}

test('two complete fixed-command passes use the native shell and pinned policy each time', async () => {
  const h = harness();
  const result = await h.collect({ command: 'touch forbidden', cwd: '/elsewhere' });
  assert.equal(result.status, 'ok');
  assert.equal(result.head, HEAD);
  assert.equal(result.headState, 'commit');
  assert.equal(result.dirty, false);
  assert.equal(result.stagedDiffSha256, sha(''));
  assert.equal(result.untrackedCount, 0);
  assert.equal(h.requests.length, 14);
  assert.equal(h.policies.length, 14);
  assert.equal(h.environments.length, 14);
  assert.deepEqual(h.requests.slice(0, 7).map(r => r.command), h.requests.slice(7).map(r => r.command));
  for (const request of h.requests) {
    assert.equal(request.workdir, ROOT);
    assert.equal(request.sandboxPolicy.workspaceRoot, ROOT);
    assert.equal(request.sandboxPolicy.mode, 'read-only');
    assert.equal(request.env.GIT_OPTIONAL_LOCKS, '0');
    assert.equal(request.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(request.onExpiry, 'kill');
    if (/diff --binary/.test(request.command)) assert.equal(request.stdoutMaxBytes, 16 * 1024 * 1024);
    else assert.ok(request.stdoutMaxBytes <= 1024 * 1024);
    assert.match(request.command, /^git --no-pager -c core.fsmonitor=false /);
    assert.doesNotMatch(request.command, /touch|forbidden/);
    if (/status --|ls-files|diff --binary/.test(request.command)) {
      assert.ok(request.command.endsWith(" -- . ':(top,exclude).dsh/engineering' ':(top,exclude).dsh/engineering/**'"));
    }
    if (/diff --binary/.test(request.command)) for (const flag of ['--full-index', '--no-ext-diff', '--no-textconv', '--no-renames', '--diff-algorithm=myers']) assert.ok(request.command.includes(flag));
  }
  assert.ok(h.executions.every(spec => spec.resolved));
  assert.ok(h.policies.every(p => p.session === h.exec.agent.session && !Object.hasOwn(p, 'mode')));
  assert.ok(h.environments.every(value => value === h.exec));
  for (const key of ['id', 'changeId', 'planVersion', 'sourceRevision', 'actor']) assert.equal(Object.hasOwn(result, key), false);
});

test('NUL paths preserve whitespace/newlines and untracked output is hash/count only', async () => {
  const paths = ['name with spaces.txt', 'line\nbreak'];
  const h = harness(({ key }) => key === 'status' ? ok(paths.map(p => '? ' + p + '\0').join('')) : undefined);
  const result = await h.collect();
  assert.equal(result.status, 'ok');
  assert.equal(result.untrackedCount, 2);
  assert.equal(result.untrackedPathsSha256, sha([...paths].sort().map(p => p + '\0').join('')));
  assert.equal(result.dirty, true);
  // Path *names* are retained (they are the evidence for scope audits); contents are not.
  assert.deepEqual(result.untrackedPaths, [...paths].sort());
  assert.ok(!JSON.stringify(result).includes('cat '));
  assert.ok(h.requests.every(r => !/cat |show |hash-object|ls-files.*others/.test(r.command)));
});

test('excluded engineering state is filtered from status and both index observations', async () => {
  const h = harness(({ key, round }) => ({
    status: ok(`? .dsh/engineering/change-${round}.json\0`),
    flags: ok('s .dsh/engineering/skip\0'),
    index: ok(`160000 ${HEAD} 0\t.dsh/engineering/module\0`),
  })[key]);
  const result = await h.collect();
  assert.equal(result.status, 'ok');
  assert.equal(result.untrackedCount, 0);
  assert.equal(result.dirty, false);
});

for (const changed of ['head', 'status', 'staged', 'worktree', 'flags', 'index']) {
  test(`second-pass ${changed} difference is unstable with no final digests`, async () => {
    const h = harness(({ key, round }) => round === 2 && key === changed ? ok({
      head: 'b'.repeat(40) + '\n', status: '? new file\0', staged: 'patch', worktree: 'patch',
      flags: 'H other file\0', index: `100644 ${'b'.repeat(40)} 0\tfile\0`,
    }[key]) : undefined);
    const result = await h.collect();
    assert.equal(result.status, 'unstable');
    assert.equal(result.stagedDiffSha256, null);
    assert.equal(result.worktreeDiffSha256, null);
    assert.equal(result.untrackedPathsSha256, null);
  });
}

test('parent repository stops before reading HEAD/status/diff', async () => {
  const h = harness(({ key }) => key === 'root' ? ok(path.dirname(ROOT) + '\n') : undefined);
  const result = await h.collect();
  assert.equal(result.status, 'partial');
  assert.equal(result.error.code, 'repository_outside_workspace');
  assert.equal(h.requests.length, 1);
  assert.equal(result.stagedDiffSha256, null);
});

test('workspace policy is rechecked on every execution', async () => {
  const h = harness();
  let calls = 0;
  h.ctx.sandboxPolicy.resolve = () => ({ workspaceRoot: ++calls === 3 ? path.dirname(ROOT) : ROOT });
  const result = await h.collect();
  assert.equal(result.error.code, 'workspace_changed');
  assert.equal(h.executions.length, 2);
});

for (const [name, patch, code] of [
  ['stdout truncation', { stdout: { text: 'partial patch', truncated: true } }, 'output_truncated'],
  ['stderr truncation', { stderr: { text: '', truncated: true } }, 'output_truncated'],
  ['missing truncation flag', { stdout: { text: '' } }, 'output_truncated'],
  ['timeout', { timedOut: true }, 'timeout'], ['abort', { aborted: true }, 'aborted'],
  ['signal', { signal: 'SIGTERM' }, 'invalid_shell_result'],
  ['missing timeout flag', { timedOut: undefined }, 'invalid_shell_result'],
  ['missing abort flag', { aborted: undefined }, 'invalid_shell_result'],
  ['missing exit', { exitCode: null }, 'invalid_shell_result'],
  ['nonzero exit', { exitCode: 1 }, 'git_exit'],
  ['denied', { sandbox: { denied: true } }, 'sandbox_error'],
]) {
  test(`${name} never yields a complete hash`, async () => {
    const h = harness(({ key }) => key === 'worktree' ? ok('data', patch) : undefined);
    const result = await h.collect();
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, code);
    assert.equal(result.stagedDiffSha256, null);
    assert.equal(result.worktreeDiffSha256, null);
    assert.equal(result.untrackedPathsSha256, null);
  });
}

test('aggregate output over 1 MiB and invalid UTF-8 fail closed', async () => {
  // Diffs are exempt from the retained-evidence budget (they are hashed and dropped),
  // so the budget case has to be driven by a non-diff command.
  const big = harness(({ key }) => key === 'status' ? ok('x'.repeat(1024 * 1024)) : undefined);
  assert.equal((await big.collect()).error.code, 'output_limit');
  const bad = harness(({ key }) => key === 'staged' ? ok('\ufffd') : undefined);
  assert.equal((await bad.collect()).error.code, 'output_encoding');
});

test('a large diff is hashed without consuming the retained-evidence budget', async () => {
  const text = 'diff --git a/client.js b/client.js\n' + 'y'.repeat(2 * 1024 * 1024);
  const h = harness(({ key }) => key === 'worktree' ? ok(text) : undefined);
  const result = await h.collect();
  assert.equal(result.error, null);
  assert.equal(result.worktreeDiffSha256, createHash('sha256').update(text, 'utf8').digest('hex'));
  assert.notEqual(result.worktreeDiffSha256, createHash('sha256').update('', 'utf8').digest('hex'));
});

test('a diff past its own cap still fails closed instead of being hashed partially', async () => {
  const h = harness(({ key }) => key === 'worktree' ? ok('partial', { stdout: { text: 'partial', truncated: true } }) : undefined);
  assert.equal((await h.collect()).error.code, 'output_truncated');
});

test('only exact standard not-git discovery diagnostic is not_git', async () => {
  for (const [stderr, status] of [
    ['fatal: not a git repository (or any of the parent directories): .git\n', 'not_git'],
    ['fatal: detected dubious ownership in repository', 'error'], ['permission denied', 'error'],
  ]) {
    const h = harness(() => ok('', { exitCode: 128, stderr: { text: stderr, truncated: false } }));
    assert.equal((await h.collect()).status, status);
    assert.equal(h.requests.length, 1);
  }
});

test('unborn is established by symbolic branch, missing raw HEAD and absent branch ref on both passes', async () => {
  const h = harness(({ key }) => ({ head: ok('', { exitCode: 1 }), rawHead: ok('', { exitCode: 1 }),
    symbolic: ok('refs/heads/main\n'), refs: ok('refs/heads/other\n') })[key]);
  const result = await h.collect();
  assert.equal(result.status, 'ok');
  assert.equal(result.headState, 'unborn');
  assert.equal(result.head, null);
  assert.equal(h.requests.length, 20);
});

test('arbitrary HEAD failures or existing branch ref are not unborn', async () => {
  for (const patch of [ok('', { exitCode: 128 }), ok('unexpected', { exitCode: 1 })]) {
    const h = harness(({ key }) => key === 'head' ? patch : undefined);
    const result = await h.collect();
    assert.equal(result.status, 'error');
    assert.equal(result.headState, 'unknown');
  }
  const h = harness(({ key }) => ({ head: ok('', { exitCode: 1 }), rawHead: ok('', { exitCode: 1 }),
    symbolic: ok('refs/heads/main\n'), refs: ok('refs/heads/main\n') })[key]);
  assert.equal((await h.collect()).error.code, 'head_unknown');
});

test('submodules, conflicts, assume-unchanged and skip-worktree are partial', async () => {
  for (const outputs of [
    { index: `160000 ${HEAD} 0\tsubmodule\0` }, { flags: 'h file\0' }, { flags: 'S file\0' },
    { status: `u UU N... 100644 100644 100644 100644 ${HEAD} ${HEAD} ${HEAD} conflict with spaces\0` },
    { status: `1 .M S.M. 160000 160000 160000 ${HEAD} ${HEAD} module\0` },
  ]) {
    const h = harness(({ key }) => Object.hasOwn(outputs, key) ? ok(outputs[key]) : undefined);
    const result = await h.collect();
    assert.equal(result.status, 'partial');
    assert.equal(result.error, null);
    assert.ok(result.limitations.some(text => /submodules|unmerged|special-index/.test(text)));
  }
});

test('truncated NUL record and unexpected porcelain record fail closed', async () => {
  for (const text of ['? missing terminator', 'X bad\0', '1 malformed\0']) {
    const h = harness(({ key }) => key === 'status' ? ok(text) : undefined);
    assert.equal((await h.collect()).error.code, 'invalid_git_output');
  }
});

test('cancellation kills and drains published native process and removes abort listeners', async () => {
  let killed = 0, drained = false, added = 0, removed = 0;
  const controller = new AbortController();
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args) => { added++; return add(...args); };
  signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  const h = harness(({ key }) => {
    if (key !== 'staged') return undefined;
    let settle;
    const done = new Promise(resolve => { settle = resolve; });
    return { handle: { done: done.then(() => { drained = true; }), kill() { killed++; settle(); return true; },
      async result() { controller.abort(); await done; return ok('', { aborted: true }); } } };
  });
  const result = await h.collect({ signal });
  assert.equal(result.error.code, 'aborted');
  assert.ok(killed > 0);
  assert.equal(drained, true);
  assert.equal(added, removed);
  assert.equal(result.stagedDiffSha256, null);
});

test('a failing kill during cleanup is reported instead of hiding the original failure', async () => {
  const h = harness(({ key }) => {
    if (key !== 'head') return undefined;
    return { handle: { done: Promise.resolve(), kill() { throw new Error('handle already closed'); },
      async result() { throw new Error('head read failed'); } } };
  });
  const result = await h.collect();
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'cleanup_error');
  assert.match(result.error.message, /head read failed; kill failed: handle already closed/);
});

test('pre-cancelled execution and missing admission context never spawn', async () => {
  const h = harness();
  h.controller.abort();
  assert.equal((await h.collect()).error.code, 'aborted');
  assert.equal(h.requests.length, 0);
  const result = await collectGitObservation(h.ctx, {}, { workspaceRoot: ROOT });
  assert.equal(result.error.code, 'invalid_execution');
});

test('observation remainder matches the actual schema after caller metadata is attached', async () => {
  for (const override of [undefined,
    ({ key }) => key === 'root' ? ok(path.dirname(ROOT) + '\n') : undefined,
    ({ key }) => key === 'staged' ? ok('', { timedOut: true }) : undefined,
  ]) {
    const result = await harness(override).collect();
    const record = { ...result, id: '00000000-0000-0000-0000-000000000001',
      changeId: '00000000-0000-0000-0000-000000000002', planVersion: 1, sourceRevision: 1,
      actor: { kind: 'agent', id: 'agent-1' } };
    assert.deepEqual(validateGitObservation(record), record);
  }
});

test('zero exit with stderr diagnostic is not silently hashed', async () => {
  const h = harness(({ key }) => key === 'staged' ? ok('patch', {
    stderr: { text: 'warning: external condition', truncated: false },
  }) : undefined);
  const result = await h.collect();
  assert.equal(result.error.code, 'git_diagnostic');
  assert.equal(result.stagedDiffSha256, null);
});

test('infrastructure failure is returned explicitly and abort listener is cleaned', async () => {
  const h = harness(({ key }) => key === 'staged' ? new Error('native preparation failed') : undefined);
  const result = await h.collect();
  assert.equal(result.error.code, 'collection_error');
  assert.equal(result.error.message, 'native preparation failed');
  assert.equal(result.stagedDiffSha256, null);
});

test('line-ending warnings are recorded as a limitation, other diagnostics still fail', async () => {
  const warning = "warning: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it";
  const benign = harness(({ key }) => key === 'worktree'
    ? ok('diff --git a/a b/a', { stderr: { text: `${warning}\n`, truncated: false } }) : undefined);
  const result = await benign.collect();
  assert.equal(result.error, null);
  // The warning does not reduce coverage: the diff text is exact, so status stays ok.
  assert.equal(result.status, 'ok');
  assert.ok(result.limitations.some(text => text.startsWith('eol-normalization:')));

  const other = harness(({ key }) => key === 'worktree'
    ? ok('', { stderr: { text: 'warning: something else\n', truncated: false } }) : undefined);
  assert.equal((await other.collect()).error.code, 'git_diagnostic');
});
