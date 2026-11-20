import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Script } from 'node:vm';

// Deliberately a mechanical embedder, not a general JavaScript transpiler.
// Paths are anchored here so invocation does not depend on the working directory.
const moduleFile = new URL('../src/git-comparison.js', import.meta.url);
const clientFile = new URL('../client.js', import.meta.url);
const beginMarker = '/* BEGIN SHARED GIT COMPARISON */';
const endMarker = '/* END SHARED GIT COMPARISON */';
const begin = `    ${beginMarker}\n    const gitComparison = (() => {\n`;
const end = `\nreturn { compareGitObservations };\n    })();\n    ${endMarker}`;

function checkModule(source, label) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source, encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} syntax check failed: ${result.stderr}`);
}

function rebuild(client, canonical) {
  for (const marker of [beginMarker, endMarker]) {
    if (client.split(marker).length !== 2) throw new Error(`Expected exactly one marker: ${marker}`);
  }
  const start = client.indexOf(begin);
  const finish = client.indexOf(end);
  if (start < 0 || finish < start + begin.length) {
    throw new Error('Unexpected Git comparison closure format or marker order');
  }

  // Only the two current, unindented named function exports are supported.
  // Fail closed on any remaining import/export word (even in comments/strings),
  // including dynamic imports; do not silently transform unfamiliar module syntax.
  const names = [];
  const body = canonical.replace(/^export (?=function (validateGitObservation|compareGitObservations)\()/gm,
    (prefix, name) => { names.push(name); return ''; });
  if (names.length !== 2 || new Set(names).size !== 2 || /\b(?:import|export)\b/.test(body)) {
    throw new Error('Unsupported imports/exports: expected only validateGitObservation and compareGitObservations function exports');
  }
  checkModule(canonical, 'Canonical module');
  // Compile only: never execute the canonical module or generated client.
  new Script(`(() => {\n${body}\nreturn { compareGitObservations };\n})()`, { filename: 'git-comparison-embedded.js' });
  const output = client.slice(0, start + begin.length) + body + client.slice(finish);
  checkModule(output, 'Generated client');
  return output;
}

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/embed-git-comparison.mjs [--check]');
  }
  const canonical = readFileSync(moduleFile, 'utf8');
  const client = readFileSync(clientFile, 'utf8');
  const output = rebuild(client, canonical);
  const changed = output !== client;
  if (args[0] === '--check' && changed) throw new Error('Embedded Git comparison differs from canonical source');
  if (args[0] !== '--check' && changed) writeFileSync(clientFile, output);
  console.log(JSON.stringify({ check: args[0] === '--check', changed, clientBytes: Buffer.byteLength(output) }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
