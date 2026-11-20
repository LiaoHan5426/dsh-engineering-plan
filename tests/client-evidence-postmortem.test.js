import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'client.js'), 'utf8');

test('the evidence task picker accepts post-mortem states', () => {
  assert.match(source, /const EVIDENCE_TASK_STATES = \["verifying", "failed", "blocked"\];/);
  assert.match(source, /filter\(\(task\) => approved && EVIDENCE_TASK_STATES\.includes\(task\.status\)\)/);
  assert.equal(
    /filter\(\(task\) => approved && task\.status === "verifying"\)/.test(source),
    false,
    'the old verifying-only filter must be gone',
  );
});

test('a failed or blocked task only offers failure evidence', () => {
  assert.match(source, /const postMortem = !!selectedTask && \(selectedTask\.status === "failed" \|\| selectedTask\.status === "blocked"\);/);
  assert.match(source, /choices: \(postMortem \? \["failed"\] : \["passed", "failed"\]\)/);
  assert.match(source, /postMortem && evidence\.outcome !== "failed"/);
});

test('the post-mortem hint is bilingual and next to the evidence hint', () => {
  const match = /evidencePostMortem: \["([^"]+)", "([^"]+)"\]/.exec(source);
  assert.ok(match, 'locale entry must exist');
  assert.match(match[1], /只能补记失败证据/);
  assert.match(match[2], /only failure evidence/);
  assert.match(source, /postMortem && h\("p", \{ className: "ep-warn" \}, t\("evidencePostMortem"\)\)/);
});
