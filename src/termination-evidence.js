// Human attestation that a dispatched child agent (and its descendants/processes) is gone.
//
// This module exists because three places need the same reading: the plan core (which records the
// attestation in change history), and the two run stores (which must reject any patch that claims a
// termination without it). Keeping one reader avoids the situation where a run store accepts a shape
// that the core would refuse, or vice versa.
//
// The attestation is a record of what a human checked, not a proof produced by the plugin: nothing here
// observes processes. Callers that can observe more (the Host can ask the jobs registry) must do that
// first and only then ask a human for this statement.

const FIELDS = ['confirmed', 'checkedAt', 'scope', 'basis', 'references'];
const SCOPE = 'child-and-descendants-and-processes';
const MAX_TEXT = 4000;
const MAX_REFERENCES = 200;

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_INPUT';
  return error;
}

function failIf(condition, message) {
  if (condition) throw invalid(message);
}

function plain(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function describe(value) {
  return Object.getOwnPropertyDescriptors(value);
}

// Strict, side-effect free read. Returns a plain deep copy so callers can store it without sharing
// descriptors with the caller's object.
export function readTerminationEvidence(value) {
  failIf(!plain(value), 'Invalid termination evidence fields');
  const descriptors = describe(value);
  failIf(Reflect.ownKeys(descriptors).length !== FIELDS.length
    || FIELDS.some(key => !Object.hasOwn(descriptors, key)
      || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable),
  'Invalid termination evidence fields');

  const confirmed = descriptors.confirmed.value;
  const checkedAt = descriptors.checkedAt.value;
  const scope = descriptors.scope.value;
  const basis = descriptors.basis.value;
  const references = descriptors.references.value;

  failIf(confirmed !== true || scope !== SCOPE, 'Invalid termination confirmation or scope');
  failIf(typeof checkedAt !== 'string' || !Number.isFinite(Date.parse(checkedAt))
    || new Date(checkedAt).toISOString() !== checkedAt, 'Invalid checkedAt timestamp');
  failIf(typeof basis !== 'string' || !basis.trim() || basis.length > MAX_TEXT || basis.includes('\u0000'),
    'Invalid termination basis');

  failIf(!Array.isArray(references) || Object.getPrototypeOf(references) !== Array.prototype
    || references.length > MAX_REFERENCES
    || Reflect.ownKeys(references).length !== references.length + 1, 'Invalid termination references');

  const copy = [];
  for (let index = 0; index < references.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(references, String(index));
    failIf(!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable,
      'Invalid termination reference');
    const reference = descriptor.value;
    failIf(typeof reference !== 'string' || !reference.trim() || reference.length > MAX_TEXT
      || reference.includes('\u0000'), 'Invalid termination reference');
    copy.push(reference);
  }

  return { confirmed: true, checkedAt, scope: SCOPE, basis, references: copy };
}
