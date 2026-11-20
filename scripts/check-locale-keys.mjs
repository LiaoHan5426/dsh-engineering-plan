#!/usr/bin/env node
// Duplicate keys in an object literal are legal JavaScript: the last one silently wins.
// Round 57 removed six such keys from `words` by hand, which meant the workbench had been
// showing the wrong labels (and everyone had been editing the shadowed copies). This check
// makes the class of bug visible instead of relying on someone noticing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const clientPath = fileURLToPath(new URL('../client.js', import.meta.url));

/** Extract a `const NAME = {` … `};` block, anchored on the declaration and its nearest closing brace. */
export function objectBlock(source, declaration) {
  const start = source.indexOf(declaration);
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  if (open < 0) return null;
  // The closing brace sits at one of a few indents depending on where the object is declared.
  // Take the earliest candidate, otherwise a shallow declaration swallows everything after it.
  const closers = ['\n  };', '\n    };', '\n      };']
    .map((marker) => source.indexOf(marker, open))
    .filter((at) => at > open);
  if (!closers.length) return null;
  const end = Math.min(...closers);
  return { text: source.slice(open, end), offset: open };
}

/** Keys declared at a fixed indentation inside a block, in source order. */
export function declaredKeys(blockText, indent) {
  const pattern = new RegExp(`^ {${indent}}([A-Za-z_$][\\w$]*):`, 'gm');
  const keys = [];
  for (const match of blockText.matchAll(pattern)) keys.push(match[1]);
  return keys;
}

/** Keys that appear more than once — the later declaration silently wins at runtime. */
export function duplicateKeys(keys) {
  const seen = new Map();
  const duplicates = [];
  for (const key of keys) {
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 2) duplicates.push(key);
  }
  return duplicates;
}

export function checkSource(source) {
  const problems = [];
  const blocks = [
    { name: 'words', indent: 6, declaration: 'const words = {' },
    { name: 'ERROR_KEYS', indent: 4, declaration: 'ERROR_KEYS = {' },
    { name: 'READY_REASON_KEYS', indent: 4, declaration: 'READY_REASON_KEYS = {' },
  ];
  for (const { name, indent, declaration } of blocks) {
    const block = objectBlock(source, declaration);
    if (!block) {
      problems.push(`${name}: block not found (${declaration})`);
      continue;
    }
    const duplicates = duplicateKeys(declaredKeys(block.text, indent));
    for (const key of duplicates) problems.push(`${name}: duplicate key "${key}" (the later declaration wins)`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkSource(readFileSync(clientPath, 'utf8'));
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log('locale keys ok: no duplicate declarations');
}
