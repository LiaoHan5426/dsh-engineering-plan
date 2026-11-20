import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

// Two human exits were built after DESIGN.md was written (abandonRun for a reserved run that
// never started, cancelRun for a live job on this host). The document kept saying the exit was
// unimplemented and that deleting runs/*.json by hand was the only way out — a reader following
// it would have reached for `rm` instead of the command that records history.
test('DESIGN.md describes the human exits that exist', () => {
  const design = read('docs/DESIGN.md');
  assert.match(design, /`reserved` \| `abandonRun`/, 'reserved runs exit through abandonRun');
  assert.match(design, /`starting` \/ `running` \| `cancelRun`/, 'live runs exit through cancelRun');
  assert.match(design, /`unknown` \| `resolveUnknown`/, 'unknown runs exit through human resolution');
  assert.doesNotMatch(design, /当前版本尚未实现/, 'the residual-run exit is no longer unimplemented');
});

test('DESIGN.md says which case still has no exit', () => {
  const design = read('docs/DESIGN.md');
  const at = design.indexOf('残留运行的人工出口');
  assert.ok(at > 0, 'the table must exist');
  const section = design.slice(at, design.indexOf('## 0.3.0 验证模块', at));
  assert.match(section, /ENGINEERING_RUN_EXECUTOR_GONE/, 'the missing-handle case must be named');
  assert.match(section, /recover/, 'auto-recovery must still be described as absent');
});

test('the obsolete UI acceptance list is marked as history, not as current state', () => {
  const ui = read('docs/UI-ACCEPTANCE.md');
  assert.doesNotMatch(ui, /^剩余UI验收：跨会话读取/m, 'the round 5-20 blob must not remain as a live claim');
  assert.match(ui, /历史状态（第 5–20 轮）已过时/, 'what remains must point at later evidence');
});
