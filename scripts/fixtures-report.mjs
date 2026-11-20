#!/usr/bin/env node
// 夹具摘要：一条只读命令，把 .dsh/engineering/changes 里三个夹具的读数打成几行。
// 与 scripts/test-history.mjs --mode check 的区别：check 做 21 项断言（会失败退出 1），
// 这里只打印人类可读摘要，用于日常回归的第一步和 RUNBOOK 引用。
//
//   node scripts/fixtures-report.mjs [--root DIR]
//
// 只读：只用 store 的 list/get/gateStatus，不写任何文件、不碰 git。
import path from 'node:path';
import { EngineeringStore } from '../src/core.js';

const AGENT = { kind: 'agent', id: 'fixtures-report' };
const FIXTURES = [
  ['A', 'c1000000-0000-4000-8000-000000000001', '自动闭环 + 自动架构图'],
  ['B', 'c2000000-0000-4000-8000-000000000002', '人工审核停在待人工审核'],
  ['C', 'c3000000-0000-4000-8000-000000000003', '待批准的对话规划'],
];

function argValue(flag) {
  const at = process.argv.indexOf(flag);
  if (at > 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--')) return process.argv[at + 1];
  return null;
}

const root = path.resolve(argValue('--root') || process.cwd());
const store = new EngineeringStore(root);

const list = await store.execute({ action: 'list' }, AGENT);
const byId = new Map(list.changes.map(c => [c.id, c]));

let ok = true;
const lines = [];
for (const [label, id, purpose] of FIXTURES) {
  if (!byId.has(id)) {
    ok = false;
    lines.push(`${label} ${id}  缺失  ← ${purpose}`);
    continue;
  }
  const { change } = await store.execute({ action: 'get', changeId: id }, AGENT);
  const gate = await store.execute({ action: 'gateStatus', changeId: id }, AGENT);
  const done = change.tasks.filter(t => t.status === 'completed').length;
  const review = change.tasks.filter(t => t.status === 'awaiting-review').length;
  const evidenceCount = change.tasks.reduce((n, t) => n + t.evidence.length, 0);
  const blockers = [...new Set(gate.blockers.map(b => b.code))];
  lines.push([
    `${label} ${change.status.padEnd(15)}`,
    `任务 ${done}/${change.tasks.length}`,
    `待人工审核 ${review}`,
    `证据 ${evidenceCount}`,
    `门禁 ${gate.ready ? '就绪' : blockers.join('/') || '未就绪'}`,
    `← ${purpose}`,
  ].join('  '));
}

console.log(`夹具摘要 · ${root}`);
for (const line of lines) console.log(`  ${line}`);
if (list.warnings.length) {
  ok = false;
  console.log(`\n告警 ${list.warnings.length} 项：`);
  for (const w of list.warnings) console.log(`  - ${JSON.stringify(w)}`);
}
console.log(`\n${ok ? 'OK' : 'FAIL'}  三夹具齐全${list.warnings.length ? '但存在告警' : '且无告警'}；复测断言用 node scripts/test-history.mjs --mode check`);
process.exitCode = ok ? 0 : 1;
