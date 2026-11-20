import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

// Round 115 replaced the hostInstanceId gate with a registry decision, but three documents
// kept describing the old behaviour: the README, the exit table and the cancelRun bullet in
// DESIGN.md still said a run from "another host instance" is rejected. That is exactly the
// kind of drift a reader trusts and acts on, so it is asserted rather than remembered.
test('the README describes handle-based termination, not host rejection', () => {
  const readme = read('README.md');
  assert.match(readme, /该 job 句柄仍在当前进程的注册表里/, 'the actual condition must be stated');
  assert.match(readme, /ENGINEERING_RUN_EXECUTOR_GONE/, 'the missing-handle outcome must be named');
  assert.match(readme, /already-finished/, 'the already-finished outcome must be named');
  assert.doesNotMatch(readme, /属于另一个宿主实例的运行会返回 `ENGINEERING_RUN_FOREIGN_HOST`/, 'the old rejection must be gone');
});

test('the DESIGN exit table does not require a matching apply id', () => {
  const design = read('docs/DESIGN.md');
  assert.doesNotMatch(design, /有 `jobId` 且 `hostInstanceId` 等于当前 apply 实例/, 'the table must not gate on the apply id');
  assert.match(design, /该句柄仍在当前进程的 jobs 注册表里/, 'the table must describe the registry condition');
  assert.match(design, /ENGINEERING_RUN_EXECUTOR_GONE/, 'the remaining gap must be the missing handle');
  assert.doesNotMatch(design, /属于别的宿主实例\*\*。此时代码拒绝终止/, 'the old gap description must be gone');
});

test('the cancelRun bullet explains sameHost as a warning and keeps FOREIGN_HOST as legacy', () => {
  const design = read('docs/DESIGN.md');
  assert.match(design, /`sameHost: false` 的告警/, 'hostInstanceId is a warning now');
  assert.match(design, /`ownerSessionId`/, 'the caller must come from the persisted owner');
  assert.match(design, /历史兼容/, 'FOREIGN_HOST is kept only for older hosts');
});

test('the host really implements what the documents now claim', () => {
  const host = read('index.js');
  assert.match(host, /const sameHost = record\.hostInstanceId === hostInstanceId;/, 'sameHost is computed, not enforced');
  assert.match(host, /ENGINEERING_RUN_EXECUTOR_GONE/, 'JOB_NOT_FOUND maps to the executor-gone code');
  assert.doesNotMatch(host, /fail\('ENGINEERING_RUN_FOREIGN_HOST'\)/, 'the host no longer rejects on apply identity');
  assert.match(host, /outcome: kill === 'requested' \? 'terminating' : 'already-finished'/, 'already-finished is reported separately');
});
