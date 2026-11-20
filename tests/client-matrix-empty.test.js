import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function outcomeCell() {
  const start = source.indexOf('criterion || t("noCriteria")');
  assert.ok(start > 0, 'matrix row must render the no-criteria label');
  return source.slice(start, start + 800);
}

test('a task without acceptance criteria does not also claim missing evidence', () => {
  // 质量门禁 matrix renders one row per criterion. A task with no criteria gets a
  // single row whose criterion cell shows "尚未配置验收标准"; that row must show a
  // dash in the result cell instead of "缺少当前版本证据", which would contradict it.
  const cell = outcomeCell();
  const noCriterionBranch = cell.indexOf('!criterion');
  const missingEvidence = cell.indexOf('t("missingEvidence")');
  assert.ok(noCriterionBranch > -1, 'outcome cell short-circuits on a missing criterion');
  assert.ok(missingEvidence > noCriterionBranch, 'missing-evidence text is only reachable when a criterion exists');
  assert.match(cell.slice(noCriterionBranch, missingEvidence), /"—"/);
});

test('tasks with criteria still report missing current-version evidence', () => {
  assert.match(
    source,
    /latest\s*\n\s*\? badge\(latest\.outcome\)\s*\n\s*: h\("span", \{ className: "ep-warn" \}, t\("missingEvidence"\)\)/,
  );
});
