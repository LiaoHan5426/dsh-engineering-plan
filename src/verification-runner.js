import path from 'node:path';
import { verificationResultSnapshot } from './verification-result.js';

const message = error => error instanceof Error ? error.message : String(error);

/**
 * Internal adapter for an ALREADY ADMITTED tool execution and reserved run.
 * The caller must perform tools-pipeline admission, plan-version validation and
 * reservation. Never call this directly from a human command to bypass tools.
 * No tool registration, plan/task/criterion mutation, or caller-selected cwd.
 * Resolves after durable job linkage, not after process completion. Completion
 * and cancellation belong to ctx.jobs; persistence failures remain job failures.
 */
export async function launchVerification(ctx, exec, run, store) {
  // Reject incompatible identities before touching somebody else's run.
  if (run?.state !== 'reserved') throw new Error('Verification run must be reserved');
  if (!exec.agent?.id || !exec.agent.session || !exec.callId || !exec.rootCallId)
    throw new Error('Verification requires an admitted agent tool execution');
  if (run.ownerSessionId !== exec.agent.id) throw new Error('Verification owner mismatch');
  let current = structuredClone(run);
  let queue = Promise.resolve();
  const update = patch => {
    const pending = queue.then(async () => {
      current = await store.update(current.changeId, current.runId, current.hostInstanceId,
        { ...patch, expectedRevision: current.revision });
      return current;
    });
    queue = pending.catch(() => {});
    return pending;
  };
  const recordError = async error => {
    try {
      // The store deliberately permits reserved -> starting only.
      if (current.state === 'reserved') await update({ state: 'starting' });
      await update({ state: 'error', error: message(error) });
    } catch (persistenceError) {
      return `${message(error)}; error persistence failed: ${message(persistenceError)}`;
    }
    return message(error);
  };

  let spec, execution;
  const controller = new AbortController();
  try {
    exec.signal.throwIfAborted();
    const sandboxPolicy = ctx.sandboxPolicy.resolve({ session: exec.agent.session });
    // Reservation pins the workspace via its store, even if the session cwd
    // changes while the caller awaits plan validation or run reservation.
    const workspaceRoot = store.workspaceRoot;
    if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)
        || path.resolve(sandboxPolicy.workspaceRoot) !== path.resolve(workspaceRoot)) {
      throw Object.assign(new Error('Verification workspace root changed since reservation'),
        { code: 'VERIFICATION_WORKSPACE_CHANGED' });
    }
    spec = ctx.shell.resolve({
      command: current.command,
      workdir: workspaceRoot,
      sandboxPolicy,
      dshEnv: ctx.shellEnv.collect(exec),
      signal: controller.signal,
      onExpiry: 'kill',
    });
    // Copy only public resolved values; defaults and caps belong to shell.resolve.
    execution = { resolved: {
      workdir: spec.workdir,
      timeoutMs: spec.timeoutMs,
      onExpiry: spec.onExpiry,
      stdoutMaxBytes: spec.stdoutMaxBytes,
    } };
    exec.signal.throwIfAborted();
  } catch (error) {
    await recordError(error);
    throw error;
  }

  let proc;
  let resultPromise;
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // A synchronous admission throw occurs before anyone awaits ready.
  ready.catch(() => {});
  const cancel = reason => {
    controller.abort(reason);
    proc?.kill();
  };
  // Caller cancellation (tool abort, parent session teardown) must reach the
  // runner's own controller; otherwise the pre-spawn check below can never fire
  // and the approved command still executes after the call was abandoned.
  const onCallerAbort = () => cancel(exec.signal.reason);
  exec.signal.addEventListener('abort', onCallerAbort, { once: true });
  if (exec.signal.aborted) onCallerAbort();
  const detachCaller = () => exec.signal.removeEventListener('abort', onCallerAbort);
  const drain = async () => {
    controller.abort();
    try { proc?.kill(); } catch { /* Still drain the published handle. */ }
    if (proc) await Promise.allSettled([proc.done, resultPromise]);
  };
  let jobId;
  try {
    jobId = ctx.jobs.start({
      kind: 'bash',
      label: `Verification ${current.taskId}: ${current.command}`,
      owner: exec.agent.id,
      toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },
      output: ['stdout', 'stderr'].map(channel => ({
        channel,
        read: fromByte => proc ? proc.observed[channel].readFrom(fromByte)
          : { text: '', nextOffset: fromByte, lossy: false },
      })),
      run(job) {
        // Deliberately synchronous: jobs.start requires JobHooks, not a Promise.
        const done = (async () => {
          try {
            await update({ state: 'starting', jobId: job.id, execution });
            readyResolve();
            if (controller.signal.aborted) {
              await update({ state: 'cancelled', aborted: true, reason: 'Cancelled before spawn' });
              return { status: 'killed', detail: 'Cancelled before spawn' };
            }
            proc = await ctx.shell.execute(spec);
            // Attach a rejection handler before the next persistence await.
            resultPromise = Promise.resolve().then(() => proc.result());
            resultPromise.catch(() => {});
            if (controller.signal.aborted) proc.kill();
            await update({ state: 'running' });
            const result = await resultPromise;
            await proc.done;
            const snapshot = verificationResultSnapshot(result);
            await update(snapshot);
            const status = ['cancelled', 'timed_out'].includes(snapshot.state) ? 'killed'
              : snapshot.state === 'succeeded' ? 'completed' : 'failed';
            return { status, detail: `Verification ${snapshot.state}; exit code: ${snapshot.exitCode}`,
              result: JSON.stringify({ runId: current.runId, ...snapshot }) };
          } catch (error) {
            readyReject(error);
            const cancelledPreparation = controller.signal.aborted && !proc && current.state === 'starting';
            await drain();
            if (cancelledPreparation) {
              try {
                await update({ state: 'cancelled', aborted: true, reason: message(error) });
                return { status: 'killed', detail: message(error) };
              } catch (persistenceError) {
                return { status: 'failed', detail: await recordError(persistenceError) };
              }
            }
            return { status: 'failed', detail: await recordError(error) };
          } finally {
            detachCaller();
          }
        })();
        return { cancel, done };
      },
    });
  } catch (error) {
    detachCaller();
    await recordError(error);
    throw error;
  }
  await ready;
  return { jobId, runId: current.runId };
}
