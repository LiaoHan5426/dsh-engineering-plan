import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parameters } from '../index.js';
import { dispatchParameters, verificationParameters } from '../index.js';

// A schema that admits 0 or -1 for a revision makes the host accept a request the core will
// always refuse; the model then pays a round trip to learn nothing. All three tool schemas should
// draw the same line, and the plan tool should say out loud that read-only actions omit it.
const revisionSchemas = [
  ['engineering_plan', parameters],
  ['engineering_verify', verificationParameters],
  ['engineering_dispatch', dispatchParameters],
];

test('every tool schema bounds expectedRevision at 1', () => {
  for (const [name, schema] of revisionSchemas) {
    const field = schema.properties.expectedRevision;
    assert.ok(field, `${name} must declare expectedRevision`);
    assert.equal(field.minimum, 1, `${name} must refuse revision 0 or below in the schema, not only in the core`);
    assert.equal(field.type, 'integer');
  }
});

test('planVersion is bounded wherever it is accepted', () => {
  const withPlanVersion = [
    ['engineering_verify', verificationParameters],
    ['engineering_dispatch', dispatchParameters],
  ];
  for (const [name, schema] of withPlanVersion) {
    assert.equal(schema.properties.planVersion.minimum, 1, `${name} must bound planVersion at 1`);
  }
});

test('the plan schema tells the caller that read-only actions omit the revision', () => {
  assert.match(parameters.properties.expectedRevision.description, /read-only actions must omit it/);
});

test('the plan tool description warns that fields are action-scoped', () => {
  const source = parameters.properties.expectedRevision.description;
  assert.match(source, /Required by mutating actions/);
});
