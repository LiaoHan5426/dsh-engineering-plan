// Process facts only. This classification never changes task acceptance evidence.
export function classifyVerificationResult(result) {
  if (!result || typeof result !== 'object') return 'unknown';
  if (result.sandbox?.denied || result.sandbox?.runnerFailed) return 'error';
  if (result.timedOut === true) return 'timed_out';
  if (result.aborted === true) return 'cancelled';
  if (result.signal) return 'failed';
  if (!Number.isInteger(result.exitCode)) return 'unknown';
  // Missing lifecycle flags are incomplete evidence, even with exitCode 0.
  if (typeof result.timedOut !== 'boolean' || typeof result.aborted !== 'boolean') return 'unknown';
  return result.exitCode === 0 ? 'succeeded' : 'failed';
}

export function verificationResultSnapshot(result) {
  const output = value => ({
    text: typeof value?.text === 'string' ? value.text.slice(0, 65536) : '',
    truncated: value?.truncated === true || (typeof value?.text === 'string' && value.text.length > 65536),
    ...(typeof value?.spillPath === 'string' ? { spillPath: value.spillPath } : {}),
  });
  return {
    state: classifyVerificationResult(result),
    exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
    signal: typeof result?.signal === 'string' ? result.signal : null,
    timedOut: typeof result?.timedOut === 'boolean' ? result.timedOut : null,
    aborted: typeof result?.aborted === 'boolean' ? result.aborted : null,
    stdout: output(result?.stdout),
    stderr: output(result?.stderr),
    ...(result?.sandbox ? { sandbox: {
      ...(result.sandbox.mode !== undefined ? { mode: result.sandbox.mode } : {}),
      denied: result.sandbox.denied === true,
      runnerFailed: result.sandbox.runnerFailed === true,
      ...(result.sandbox.enforcement !== undefined ? { enforcement: result.sandbox.enforcement } : {}),
    } } : {}),
  };
}
