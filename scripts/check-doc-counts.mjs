#!/usr/bin/env node
// 文档里的测试数量很容易过期：README 写一个数、docs/VERIFICATION.md 每轮又写一个。
// 这个脚本把「文档声明的当前套件数」与「真实跑出来的数量」对齐，避免再出现 197/242/513/534 之类的漂移。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** 从 README 的「当前完整套件为 N 项」抽取声明数量；找不到返回 null。 */
export function readmeClaim(text) {
  const match = /当前完整套件为\s*(\d+)\s*项/.exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * README 同一句里还写着通过数与跳过数。只比对总数时，通过数会独自漂移
 * （第 135 轮实测：总数 814 对，但写成「681 通过」）。
 */
export function readmeTally(text) {
  const match = /当前完整套件为\s*(\d+)\s*项（(\d+)\s*通过[、,]\s*(\d+)\s*项[^）]*跳过）/.exec(text);
  if (!match) return null;
  return { total: Number(match[1]), pass: Number(match[2]), skip: Number(match[3]) };
}

/** docs/VERIFICATION.md 是逐轮追加的，历史数字保留；当前值取最大值（只会单调增长）。 */
export function verificationClaim(text) {
  const values = [...text.matchAll(/全套件\s*(\d+)\s*项/g)].map((match) => Number(match[1]));
  return values.length ? Math.max(...values) : null;
}

/** docs/DELIVERY-STATUS.md 顶部同时声明套件数与「更新：…（第 N 轮）」；两处都会漂移。 */
export function deliveryStatusClaim(text) {
  const match = /套件\s*(\d+)\s*项/.exec(text);
  return match ? Number(match[1]) : null;
}

export function deliveryStatusRound(text) {
  const match = /更新：[\s\S]{0,40}?第\s*(\d+)\s*轮/.exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * 顶部那行同时给出 pass 与 skip 数；它们相加必须等于套件总数，
 * 否则读者会拿到一组自相矛盾的数字（第 126 轮实测：总 803、pass 778、skip 1）。
 */
export function deliveryStatusTally(text) {
  const match = /套件\s*(\d+)\s*项（(\d+)\s*pass\s*\/\s*(\d+)[^）]*）/.exec(text);
  if (!match) return null;
  return { total: Number(match[1]), pass: Number(match[2]), skip: Number(match[3]) };
}

/** docs/VERIFICATION.md 按轮追加，最新一轮就是文件里出现过的最大轮号。 */
export function latestVerificationRound(text) {
  const values = [...text.matchAll(/^## 第\s*(\d+)\s*轮/mg)].map((match) => Number(match[1]));
  return values.length ? Math.max(...values) : null;
}

/** 返回人类可读的差异列表；空数组表示一致。 */
export function compareClaims(claims, actual) {
  const problems = [];
  if (!Number.isSafeInteger(actual) || actual <= 0) problems.push(`actual count is unusable: ${actual}`);
  for (const [label, value] of Object.entries(claims)) {
    if (value === null) problems.push(`${label} has no suite-count claim`);
    else if (value !== actual) problems.push(`${label} claims ${value}, actual is ${actual}`);
  }
  return problems;
}

export function runSuite() {
  return runSuiteCounts().total;
}

/** TAP 计划行给总数，末尾汇总给 pass/skip；两者一起用来核对「N 项（P 通过 / S 跳过）」。 */
export function runSuiteCounts() {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const plan = /^1\.\.(\d+)$/m.exec(result.stdout ?? '');
  if (!plan) throw new Error(`could not read the TAP plan; exit ${result.status}`);
  // TAP 里每个测试文件会各打一次 `# pass`，全局汇总在最后一份；取最后一个匹配。
  const lastOf = (pattern) => [...(result.stdout ?? '').matchAll(pattern)].at(-1)?.[1];
  const passed = lastOf(/^# pass (\d+)$/gm);
  const skipped = lastOf(/^# skipped (\d+)$/gm);
  return {
    total: Number(plan[1]),
    pass: passed === undefined ? null : Number(passed),
    skip: skipped === undefined ? null : Number(skipped),
  };
}

if (process.argv[1] && process.argv[1].endsWith('check-doc-counts.mjs')) {
  const counts = runSuiteCounts();
  const actual = counts.total;
  const verification = readFileSync(join(root, 'docs/VERIFICATION.md'), 'utf8');
  const status = readFileSync(join(root, 'docs/DELIVERY-STATUS.md'), 'utf8');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const claims = {
    'README.md': readmeClaim(readme),
    'docs/VERIFICATION.md': verificationClaim(verification),
    'docs/DELIVERY-STATUS.md': deliveryStatusClaim(status),
  };
  const problems = compareClaims(claims, actual);
  const readmeNumbers = readmeTally(readme);
  if (readmeNumbers === null) problems.push('README.md has no 套件 N 项（P 通过、S 项跳过） tally');
  else {
    if (readmeNumbers.pass + readmeNumbers.skip !== readmeNumbers.total) {
      problems.push('README.md tally ' + readmeNumbers.pass + ' pass + ' + readmeNumbers.skip + ' skip != ' + readmeNumbers.total + ' total');
    }
    if (readmeNumbers.total !== actual) problems.push('README.md tally total ' + readmeNumbers.total + ', actual is ' + actual);
    if (counts.pass !== null && readmeNumbers.pass !== counts.pass) {
      problems.push('README.md tally says ' + readmeNumbers.pass + ' pass, actual is ' + counts.pass);
    }
  }
  const tally = deliveryStatusTally(status);
  if (tally === null) problems.push('docs/DELIVERY-STATUS.md has no 套件 N 项（P pass / S skip） tally');
  else {
    if (tally.pass + tally.skip !== tally.total) {
      problems.push('docs/DELIVERY-STATUS.md tally ' + tally.pass + ' pass + ' + tally.skip + ' skip != ' + tally.total + ' total');
    }
    if (tally.total !== actual) problems.push('docs/DELIVERY-STATUS.md tally total ' + tally.total + ', actual is ' + actual);
  }
  const statedRound = deliveryStatusRound(status);
  const latestRound = latestVerificationRound(verification);
  if (statedRound === null) problems.push('docs/DELIVERY-STATUS.md has no 更新 round');
  else if (latestRound === null) problems.push('docs/VERIFICATION.md has no round sections');
  else if (statedRound !== latestRound) {
    problems.push(`docs/DELIVERY-STATUS.md says round ${statedRound}, latest round in VERIFICATION.md is ${latestRound}`);
  }
  if (problems.length) {
    for (const problem of problems) console.error(`doc-count: ${problem}`);
    process.exit(1);
  }
  console.log(`doc counts ok: ${actual} tests, round ${latestRound}`);
}
