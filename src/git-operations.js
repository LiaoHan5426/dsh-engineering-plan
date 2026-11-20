import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EngineeringStore } from './core.js';
import { GitObservationStore } from './git-observation-store.js';
import { collectGitObservation } from './git-collector.js';
import { compareGitObservations } from './git-comparison.js';

const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
export const gitParameters = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['capture', 'compare'] },
    changeId: { type: 'string', pattern: UUID },
    expectedRevision: { type: 'integer', minimum: 1 },
    planVersion: { type: 'integer', minimum: 1 },
    requestId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$', description: 'Stable request identifier; replay returns the saved observation without collecting again.' },
    baselineId: { type: 'string', pattern: UUID, description: 'Required for compare; forbidden for capture. Observation from the same change.' },
  },
  required: ['action', 'changeId', 'expectedRevision', 'planVersion', 'requestId'],
  oneOf: [
    { properties: { action: { const: 'capture' } }, not: { required: ['baselineId'] } },
    { properties: { action: { const: 'compare' } }, required: ['baselineId'] },
  ],
};
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function validate(input) {
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('INVALID_INPUT', 'Expected plain Git request');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (!Object.hasOwn(gitParameters.properties, key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable) fail('INVALID_INPUT', 'Unexpected Git request field');
  }
  if (gitParameters.required.some(key => !Object.hasOwn(descriptors, key))) fail('INVALID_INPUT', 'Missing Git request field');
  const value = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  if (!['capture', 'compare'].includes(value.action) || (value.action === 'compare') !== Object.hasOwn(value, 'baselineId')) fail('INVALID_INPUT', 'compare requires baselineId; capture forbids it');
  for (const key of ['changeId', ...(value.action === 'compare' ? ['baselineId'] : [])]) {
    if (typeof value[key] !== 'string' || !new RegExp(UUID).test(value[key])) fail('INVALID_ID', `Invalid ${key}`);
    value[key] = value[key].toLowerCase();
  }
  for (const key of ['expectedRevision', 'planVersion']) if (!Number.isSafeInteger(value[key]) || value[key] < 1) fail('INVALID_INPUT', `Invalid ${key}`);
  if (typeof value.requestId !== 'string' || !new RegExp(gitParameters.properties.requestId.pattern).test(value.requestId)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value.requestId)) fail('INVALID_ID', 'Invalid requestId');
  return value;
}
const requestBinding = args => args.action === 'capture' ? { action: 'capture' } : { action: 'compare', baselineId: args.baselineId };
function assertReplay(envelope, args, ownerSessionId) {
  const observation = envelope.observation;
  if (envelope.ownerSessionId !== ownerSessionId || observation.changeId !== args.changeId
    || observation.planVersion !== args.planVersion || observation.sourceRevision !== args.expectedRevision
    || envelope.request?.action !== args.action || envelope.request?.baselineId !== args.baselineId) {
    fail('REQUEST_CONFLICT', 'Request id already has different ownership, revision or parameters');
  }
}

/** One apply-local coordinator; storage is the final cross-instance deduplication boundary.
 * Separate hosts may collect concurrently. This does not promise exactly-once execution.
 */
export function createGitOperations(ctx, admitted) {
  // The host owns workspace admission. A local fallback here would be a second implementation of
  // the same rule — exactly what let this path drift from the other three tools before — so a
  // missing injection is a programming error rather than something to paper over.
  if (typeof admitted !== 'function') {
    throw new TypeError('createGitOperations requires the host admission function');
  }
  const admit = admitted;
  const inflight = new Map();
  return async (input, exec) => {
    const args = validate(input);
    if (typeof exec?.agent?.id !== 'string' || !exec.agent.id.trim() || !exec.agent.session
      || !exec.callId || !exec.rootCallId || !exec.signal) fail('ENGINEERING_TOOL_EXECUTION_REQUIRED', 'Admitted model execution required');
    exec.signal.throwIfAborted();
    const root = await admit(exec.agent, exec.signal);
    exec.signal.throwIfAborted();
    const ownerSessionId = exec.agent.id;
    const key = JSON.stringify([path.resolve(root), args.changeId, args.requestId]);
    const fingerprint = JSON.stringify([ownerSessionId, args.action, args.expectedRevision, args.planVersion, args.baselineId ?? null]);
    const existing = inflight.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) fail('REQUEST_CONFLICT', 'In-flight request has different ownership, revision or parameters');
      return existing.promise;
    }
    const promise = (async () => {
      const core = new EngineeringStore(root), store = new GitObservationStore(root);
      const actor = { kind: 'agent', id: ownerSessionId };
      const getChange = async () => (await core.execute({ action: 'get', changeId: args.changeId }, actor)).change;
      const change = await getChange();
      exec.signal.throwIfAborted();
      const replay = await store.findRequest(args.changeId, args.requestId);
      if (replay) assertReplay(replay, args, ownerSessionId);
      else {
        if (change.revision !== args.expectedRevision) fail('REVISION_CONFLICT', 'State revision changed');
        if (change.planVersion !== args.planVersion) fail('PLAN_VERSION_CONFLICT', 'Plan version changed');
      }
      const baseline = args.action === 'compare' ? (await store.get(args.changeId, args.baselineId)).observation : null;
      let observation, created = false;
      if (replay) observation = replay.observation;
      else {
        exec.signal.throwIfAborted();
        const facts = await collectGitObservation(ctx, exec, { workspaceRoot: root, signal: exec.signal });
        // Once collection starts, retain even an aborted/error observation as a historical fact.
        const saved = await store.create(args.changeId, { ...facts, id: randomUUID(), changeId: args.changeId,
          planVersion: change.planVersion, sourceRevision: change.revision, actor },
        { requestId: args.requestId, ownerSessionId, request: requestBinding(args) });
        observation = saved.observation; created = saved.created;
      }
      const current = await getChange();
      const result = { observation, created,
        bindingCurrent: current.revision === observation.sourceRevision && current.planVersion === observation.planVersion };
      if (baseline) result.comparison = compareGitObservations(baseline, observation);
      return result;
    })();
    inflight.set(key, { fingerprint, promise });
    try { return await promise; }
    finally { if (inflight.get(key)?.promise === promise) inflight.delete(key); }
  };
}
