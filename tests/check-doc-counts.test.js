import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readmeClaim, readmeTally, verificationClaim, compareClaims } from '../scripts/check-doc-counts.mjs';

const read = (path) => readFileSync(`J:/Code/Engineering Planner/${path}`, 'utf8');

test('README keeps a single current-suite claim', () => {
  assert.ok(readmeClaim(read('README.md')) > 0);
  assert.equal(readmeClaim('当前完整套件为 513 项（512 通过…）'), 513);
  assert.equal(readmeClaim('没有声明'), null);
});

// 文件是从顶部追加的，所以第一条就是最新一轮。曾经取最大值，第 149 轮套件从 863 降到 836
// 之后最大值指向历史条目，脚本一直误报 863。
test('the newest verification entry is the first claim in the file', () => {
  assert.equal(verificationClaim('- 全套件 540 项\n- 全套件 537 项\n- 全套件 528 项'), 540);
  assert.equal(verificationClaim('- 全套件 836 项\n- 全套件 863 项'), 836);
  assert.equal(verificationClaim('无'), null);
});

test('mismatches are reported with both sides', () => {
  const problems = compareClaims({ 'README.md': 537 }, 540);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /claims 537, actual is 540/);
  assert.deepEqual(compareClaims({ 'README.md': 540 }, 540), []);
});

test('missing claims and unusable actuals are reported instead of passing silently', () => {
  assert.match(compareClaims({ 'README.md': null }, 540)[0], /has no suite-count claim/);
  assert.match(compareClaims({ 'README.md': 540 }, 0)[0], /actual count is unusable/);
});

test('the two documents currently agree with each other', () => {
  assert.equal(readmeClaim(read('README.md')), verificationClaim(read('docs/VERIFICATION.md')));
});

// 总数对、通过数错，是同一类漂移的两个面：第 127 轮交付状态头部出现过（总 803 / pass 778），
// 第 135 轮 README 又出现一次（总 814 / 通过 681）。只比总数时它不会被发现。
test('the README tally carries a pass count that must add up', () => {
  assert.deepEqual(readmeTally('当前完整套件为 814 项（813 通过、1 项可选真实 Chromium Mermaid 跳过）'),
    { total: 814, pass: 813, skip: 1 });
  assert.equal(readmeTally('当前完整套件为 814 项'), null);
  const real = readmeTally(read('README.md'));
  assert.ok(real, 'README must state N 项（P 通过、S 项…跳过）');
  assert.equal(real.pass + real.skip, real.total, 'the README tally must add up');
});
