import path from 'node:path';
import { buildDispatchPrompt } from './dispatch-request.js';
import { MAX_OUTPUT_BYTES } from './dispatch-store.js';

const message = error => error instanceof Error ? error.message : String(error);
// A cancellation must stay a cancellation. Wrapping an AbortError in a fresh
// Error loses the name and the (numeric) DOMException code, so the tool layer
// would report the call as failed instead of cancelled. Persist the detail
// first, then rethrow the original whenever it is an abort.
const persistThenRethrow = (error, detail) => {
  if (error?.name === 'AbortError') {
    throw error;
  }
  throw Object.assign(new Error(detail), { cause: error, code: error?.code });
};
const STOP_REASONS = new Set(['completed', 'aborted', 'error', 'max-tokens', 'refusal']);
function bounded(text) {
  const bytes = Buffer.from(text);
  let end = Math.min(bytes.length, MAX_OUTPUT_BYTES);
  if (end < bytes.length) while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString('utf8'), truncated: end < bytes.length };
}
function resultSnapshot(result) {
  if (!result || !Array.isArray(result.output) || !STOP_REASONS.has(result.stopReason)
      || (result.diagnostic !== undefined && typeof result.diagnostic !== 'string')) {
    throw new Error('Invalid native subagent result');
  }
  const rendered = result.output.map(block => {
    if (!block || typeof block.type !== 'string') throw new Error('Invalid native content block');
    if (block.type === 'text' || block.type === 'reasoning') {
      if (typeof block.text !== 'string') throw new Error('Invalid native text block');
      return block.text;
    }
    return JSON.stringify(block);
  }).join('\n');
  const text = bounded(rendered), diagnostic = bounded(result.diagnostic ?? '');
  return {
    result: { text: text.text, stopReason: result.stopReason,
      diagnostic: result.diagnostic === undefined ? null : diagnostic.text },
    truncated: text.truncated || diagnostic.truncated,
  };
}

// Matches the installed subagents' parentAgentOptionsForDelegation: the live
// request route overrides construction-time options, including cleared effort.
function currentOptions(parent) {
  const config = parent.session.requestHeader()?.config;
  if (!config) return { ...parent.options };
  const { provider, model, reasoningEffort, ...rest } = parent.options ?? {};
  return { ...rest, provider: config.provider, model: config.model,
    ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }) };
}

/**
 * Internal adapter, called ONLY for created=true after normal tools-pipeline
 * admission and atomic core reservation. No tool registration or plan mutation.
 * Publication means durable job linkage, never task completion or evidence.
 */
export async function launchDispatch(ctx, exec, run, store) {
  if (run?.state !== 'reserved') throw new Error('Dispatch run must be reserved');
  if (!exec.agent?.id || !exec.agent.session || !exec.callId || !exec.rootCallId)
    throw new Error('Dispatch requires an admitted agent tool execution');
  if (run.ownerSessionId !== exec.agent.id) throw new Error('Dispatch owner mismatch');
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
  // Sticky: failed cleanup leaves a possibly live child. Never release the
  // core's dispatch blocker, even if recording unknown also fails.
  let cleanupFailed = false;
  const recordError = async error => {
    const detail = bounded(message(error)).text;
    const state = cleanupFailed ? 'unknown' : 'error';
    try {
      if (current.state === 'reserved') await update({ state: 'starting' });
      await update({ state, error: detail });
    } catch (persistenceError) {
      return bounded(`${detail}; ${state} persistence failed: ${message(persistenceError)}`).text;
    }
    return detail;
  };
  const checkWorkspace = () => {
    const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session });
    const root = store.workspaceRoot;
    if (typeof root !== 'string' || !path.isAbsolute(root)
        || typeof policy.workspaceRoot !== 'string'
        || path.resolve(policy.workspaceRoot) !== path.resolve(root)) {
      throw Object.assign(new Error('Dispatch workspace root changed since reservation'),
        { code: 'DISPATCH_WORKSPACE_CHANGED' });
    }
    return root;
  };
  const controller = new AbortController();
  let spec;
  try {
    exec.signal.throwIfAborted();
    const cwd = checkWorkspace();
    if (!ctx.subagents?.getProvider('spawn')) throw new Error('Native spawn provider is unavailable');
    const agentPreset = exec.agent.ctx.get('agentPresets')?.composedPreset(exec.agent.ctx);
    const maxDepth = ctx.subagents.resolveMaxDepth();
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || Object.is(maxDepth, -0))
      throw new Error('Native subagent depth limit is unavailable or invalid');
    spec = { provider: 'spawn', childId: current.childId, parent: exec.agent, cwd,
      label: `Dispatch ${current.taskId}`, delivery: 'caller',
      ...(agentPreset === undefined ? {} : { agentPreset }),
      agentOptions: currentOptions(exec.agent), maxDepth,
      prompt: [{ type: 'text', text: buildDispatchPrompt(current) }], signal: controller.signal };
    exec.signal.throwIfAborted();
  } catch (error) {
    const detail = await recordError(error);
    throw persistThenRethrow(error, detail);
  }

  let activation, resultPromise, disposal;
  let readyResolve, readyReject, cancelResolve;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => {});
  const cancelled = new Promise(resolve => { cancelResolve = resolve; });
  const cancel = reason => { controller.abort(reason); cancelResolve(); };
  const onCallerAbort = () => cancel(exec.signal.reason);
  // Tool cancellation applies until publication. A published background job
  // then has its own native jobs cancellation lifetime.
  exec.signal.addEventListener('abort', onCallerAbort, { once: true });
  if (exec.signal.aborted) onCallerAbort();
  const detachCaller = () => exec.signal.removeEventListener('abort', onCallerAbort);
  const dispose = () => {
    if (!activation) return Promise.resolve();
    disposal ??= Promise.resolve().then(() => activation.dispose()).catch(error => {
      cleanupFailed = true;
      throw error;
    });
    disposal.catch(() => {});
    return disposal;
  };
  const finishCancelled = async () => {
    await dispose();
    await update({ state: 'cancelled', reason: bounded(message(controller.signal.reason ?? 'Cancelled')).text });
    return { status: 'killed', detail: 'Dispatch cancelled after cleanup' };
  };
  let jobId;
  try {
    jobId = ctx.jobs.start({
      // Installed JobKindMap permits only bash. This is a native jobs category,
      // not shell execution; no shell or shellEnv service is involved.
      kind: 'bash', label: `Dispatch ${current.taskId}`, owner: exec.agent.id,
      toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },
      run(job) {
        const done = (async () => {
          try {
            await update({ state: 'starting', jobId: job.id });
            if (controller.signal.aborted) {
              readyReject(new Error('Dispatch cancelled before publication'));
              return await finishCancelled();
            }
            // Resolve once again after the asynchronous durable linkage write.
            checkWorkspace();
            detachCaller();
            readyResolve();
            activation = await ctx.subagents.startActivation(spec);
            // Observe rejection immediately, before any persistence/cleanup await.
            resultPromise = Promise.resolve(activation.result);
            resultPromise.catch(() => {});
            if (activation.childId !== current.childId) throw new Error('Native child identity mismatch');
            if (controller.signal.aborted) return await finishCancelled();
            await update({ state: 'running' });
            const outcome = await Promise.race([
              resultPromise.then(value => ({ value })),
              cancelled.then(() => ({ cancelled: true })),
            ]);
            if (outcome.cancelled || controller.signal.aborted) return await finishCancelled();
            const snapshot = resultSnapshot(outcome.value);
            await dispose();
            if (controller.signal.aborted) return await finishCancelled();
            const state = outcome.value.stopReason === 'completed' ? 'returned' : 'failed';
            // Completion commits after cleanup. A cancellation arriving during
            // this terminal write cannot roll back an already durable return.
            await update({ ...snapshot, state });
            return { status: state === 'returned' ? 'completed' : 'failed',
              detail: `Dispatch ${state}; stop reason: ${current.result.stopReason}`,
              result: JSON.stringify({ runId: current.runId, state, result: current.result, truncated: current.truncated }) };
          } catch (error) {
            readyReject(error);
            controller.abort(error);
            let detail = message(error);
            try { await dispose(); } catch (cleanupError) { detail += `; cleanup failed: ${message(cleanupError)}`; }
            return { status: 'failed', detail: await recordError(detail) };
          } finally { detachCaller(); }
        })();
        // Native jobs requires synchronous hooks, not an async run callback.
        return { cancel, done };
      },
    });
  } catch (error) {
    detachCaller();
    const detail = await recordError(error);
    throw persistThenRethrow(error, detail);
  }
  await ready;
  return { jobId, runId: current.runId };
}
