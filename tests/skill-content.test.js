import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

const skills = ['engineering-planning', 'architecture-design', 'engineering-review'];
const read = (name) => fs.readFileSync(`J:/Code/Engineering Planner/skills/${name}/SKILL.md`, 'utf8');

test('every registered skill has a title, a purpose line and no placeholder text', () => {
  for (const name of skills) {
    const text = read(name);
    assert.ok(text.startsWith('# '), `${name} must start with a level-1 title`);
    assert.ok(text.split('\n').length > 8, `${name} is too short to guide anything`);
    for (const placeholder of ['TODO', 'TBD', 'FIXME', '待补充']) {
      assert.ok(!text.includes(placeholder), `${name} still contains ${placeholder}`);
    }
  }
});

test('the skills describe the tools that actually exist', () => {
  const planning = read('engineering-planning');
  const review = read('engineering-review');
  const architecture = read('architecture-design');
  for (const tool of ['engineering_plan', 'engineering_dispatch', 'engineering_verify']) {
    assert.ok(planning.includes(tool), `planning must mention ${tool}`);
  }
  for (const tool of ['engineering_plan', 'engineering_verify', 'engineering_dispatch']) {
    assert.ok(review.includes(tool), `review must mention ${tool}`);
  }
  assert.ok(architecture.includes('engineering_dispatch'));
  assert.ok(architecture.includes('engineering_verify'));
});

test('the delivery gate and the human-only run actions are documented where they matter', () => {
  const planning = read('engineering-planning');
  const review = read('engineering-review');
  for (const text of [planning, review]) {
    assert.ok(text.includes('gateStatus'), 'gateStatus must be discoverable');
    assert.match(text, /ready: true/);
  }
  assert.ok(planning.includes('cancelRun'));
  assert.ok(review.includes('cancelRun'));
  // Human-only boundaries must be stated, not implied.
  assert.match(planning, /Agent 不得调用 `acceptDelivery`|不得调用 `acceptDelivery`/);
  assert.match(review, /模型工具没有该动作/);
});

test('stale capability claims are gone', () => {
  const architecture = read('architecture-design');
  const review = read('engineering-review');
  assert.ok(!architecture.includes('尚无自动 executor 或独立验证能力'), 'stale opener');
  assert.ok(!review.includes('未提供自动开发调度器'), 'stale scheduler claim');
  assert.ok(architecture.includes('不替代对设计结论的独立验证'));
});

test('the Windows shell caveat is present in both execution-facing skills', () => {
  for (const name of ['engineering-planning', 'engineering-review']) {
    const text = read(name);
    assert.match(text, /PowerShell/, `${name} must warn about PowerShell`);
    assert.match(text, /printf/, `${name} must name a POSIX command that may not exist`);
  }
});

test('review and planning explain the read-only scope audit', () => {
  const review = read('engineering-review');
  const planning = read('engineering-planning');
  for (const text of [review, planning]) {
    assert.match(text, /scopeAudit/);
    assert.match(text, /expectedFiles/);
  }
  // The audit is evidence only; the guidance must not imply it blocks anything.
  assert.match(review, /不拦截/);
  assert.match(planning, /未声明/);
});
