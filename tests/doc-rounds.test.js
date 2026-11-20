import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  deliveryStatusClaim,
  deliveryStatusRound,
  latestVerificationRound,
} from '../scripts/check-doc-counts.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const statusDoc = readFileSync(join(root, 'docs/DELIVERY-STATUS.md'), 'utf8');
const verificationDoc = readFileSync(join(root, 'docs/VERIFICATION.md'), 'utf8');

test('the delivery status header declares both a suite count and a round', () => {
  assert.equal(typeof deliveryStatusClaim(statusDoc), 'number');
  assert.equal(typeof deliveryStatusRound(statusDoc), 'number');
  assert.ok(deliveryStatusRound(statusDoc) > 90, 'round must be a real round number');
});

test('the round claim is read from the 更新 line, not from an evidence bullet', () => {
  const text = '更新：2026-11-20（第 42 轮）。套件 7 项。\n\n- **第 99 轮（x）**：…';
  assert.equal(deliveryStatusRound(text), 42);
  assert.equal(deliveryStatusClaim(text), 7);
  assert.equal(deliveryStatusRound('no header here'), null);
  assert.equal(deliveryStatusClaim('no count here'), null);
});

test('the latest verification round is the maximum heading round', () => {
  const text = '## 第 9 轮：a\n\n## 第 12 轮：b\n\n## 第 11 轮：c\n';
  assert.equal(latestVerificationRound(text), 12);
  assert.equal(latestVerificationRound('no headings'), null);
});

test('the real documents agree on the round', () => {
  assert.equal(deliveryStatusRound(statusDoc), latestVerificationRound(verificationDoc));
});

test('the gate reports both drifts it was written for', async () => {
  const { compareClaims } = await import('../scripts/check-doc-counts.mjs');
  const problems = compareClaims({ 'a.md': 694, 'b.md': null }, 715);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /claims 694, actual is 715/);
  assert.match(problems[1], /no suite-count claim/);
});

test('the delivery-status tally must add up and match the suite', async () => {
  const { deliveryStatusTally } = await import('../scripts/check-doc-counts.mjs');
  assert.deepEqual(deliveryStatusTally('套件 803 项（802 pass / 1 可选 Chromium skip）'), { total: 803, pass: 802, skip: 1 });
  assert.equal(deliveryStatusTally('套件 803 项'), null);

  const text = readFileSync(new URL('../docs/DELIVERY-STATUS.md', import.meta.url), 'utf8');
  const tally = deliveryStatusTally(text);
  assert.ok(tally, 'the header must state total, pass and skip');
  assert.equal(tally.pass + tally.skip, tally.total, `${tally.pass} pass + ${tally.skip} skip must equal ${tally.total}`);
});
