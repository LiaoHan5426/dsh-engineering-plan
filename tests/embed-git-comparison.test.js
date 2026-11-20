import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../scripts/embed-git-comparison.mjs', import.meta.url);
const realClientFile = new URL('../client.js', import.meta.url);
const realClient = readFileSync(realClientFile, 'utf8');
const canonical = readFileSync(new URL('../src/git-comparison.js', import.meta.url), 'utf8');
const beginMarker = '/* BEGIN SHARED GIT COMPARISON */';
const endMarker = '/* END SHARED GIT COMPARISON */';
const begin = `    ${beginMarker}\n    const gitComparison = (() => {\n`;
const end = `\nreturn { compareGitObservations };\n    })();\n    ${endMarker}`;
const stripped = canonical.replace(/^export /gm, '');
const fixtureClient = body => `// prefix remains byte-for-byte\n${begin}${body}${end}\n// suffix remains byte-for-byte\n`;

function fixture(t, client = fixtureClient('/* stale */\n'), source = canonical) {
  const root = mkdtempSync(join(tmpdir(), 'git-comparison-embed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'src'));
  const file = join(root, 'client.js');
  const moduleFile = join(root, 'src', 'git-comparison.js');
  const copiedScript = join(root, 'scripts', 'embed-git-comparison.mjs');
  copyFileSync(script, copiedScript);
  writeFileSync(file, client);
  writeFileSync(moduleFile, source);
  return {
    file, moduleFile,
    read: () => readFileSync(file, 'utf8'),
    // An unrelated cwd proves that all input/output paths follow the script.
    run: (...args) => spawnSync(process.execPath, [copiedScript, ...args], {
      cwd: tmpdir(), encoding: 'utf8', maxBuffer: 1024 * 1024,
    }),
  };
}
function success(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function failureUnchanged(f, pattern, ...args) {
  const before = readFileSync(f.file);
  const mtime = statSync(f.file).mtimeMs;
  const result = f.run(...args);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, pattern);
  assert.deepEqual(readFileSync(f.file), before);
  assert.equal(statSync(f.file).mtimeMs, mtime);
}

test('real embedding is exact canonical source and rebuilding its temporary copy changes no bytes', t => {
  assert.equal(realClient.split(beginMarker).length, 2);
  assert.equal(realClient.split(endMarker).length, 2);
  const start = realClient.indexOf(begin), finish = realClient.indexOf(end);
  assert.ok(start >= 0 && finish > start);
  assert.equal(realClient.slice(start + begin.length, finish), stripped);
  const f = fixture(t, realClient);
  assert.equal(success(f.run('--check')).changed, false);
  const mtime = statSync(f.file).mtimeMs;
  assert.equal(success(f.run()).changed, false);
  assert.equal(f.read(), realClient);
  assert.equal(statSync(f.file).mtimeMs, mtime);
  assert.equal(readFileSync(realClientFile, 'utf8'), realClient);
});

test('rebuild uses only source, preserves surrounding bytes and is idempotent from unrelated cwd', t => {
  const f = fixture(t);
  failureUnchanged(f, /differs from canonical/, '--check');
  assert.equal(success(f.run()).changed, true);
  assert.equal(f.read(), fixtureClient(stripped));
  const mtime = statSync(f.file).mtimeMs;
  assert.equal(success(f.run()).changed, false);
  assert.equal(statSync(f.file).mtimeMs, mtime);
  assert.equal(success(f.run('--check')).check, true);
  const changedSource = canonical + '\n// deterministic source update\n';
  writeFileSync(f.moduleFile, changedSource);
  assert.equal(success(f.run()).changed, true);
  assert.equal(f.read(), fixtureClient(changedSource.replace(/^export /gm, '')));
  const other = fixture(t, fixtureClient('// different stale body\n'), changedSource);
  success(other.run());
  assert.equal(other.read(), f.read());
});

for (const [name, client] of [
  ['missing begin', fixtureClient('').replace(beginMarker, '')],
  ['missing end', fixtureClient('').replace(endMarker, '')],
  ['duplicate begin', fixtureClient('') + `\n${beginMarker}`],
  ['duplicate end', `${endMarker}\n` + fixtureClient('')],
  ['reversed markers', `    ${endMarker}\n    ${beginMarker}`],
  ['changed wrapper', fixtureClient('').replace('const gitComparison', 'let gitComparison')],
]) {
  test(`invalid marker layout leaves target untouched: ${name}`, t => {
    failureUnchanged(fixture(t, client), /marker|closure format/);
  });
}

for (const [name, extra] of [
  ['static import', "import value from './other.js';"],
  ['side effect import', "import './other.js';"],
  ['multiline import', "import\n './other.js';"],
  ['dynamic import', "const lazy = import('./other.js');"],
  ['import meta', 'const url = import.meta.url;'],
  ['default export', 'export default 1;'],
  ['export list', 'export { compareGitObservations };'],
  ['re-export', "export * from './other.js';"],
  ['new function export', 'export function another() {}'],
  ['indented export', '  export const another = 1;'],
  ['export word in string', "const word = 'export';"],
]) {
  test(`unsupported module form leaves target untouched: ${name}`, t => {
    failureUnchanged(fixture(t, undefined, canonical + '\n' + extra), /Unsupported imports\/exports/);
  });
}

test('missing required export fails before writing', t => {
  failureUnchanged(fixture(t, undefined, canonical.replace('export function compareGitObservations', 'function compareGitObservations')),
    /Unsupported imports\/exports/);
});

test('invalid source, invalid output and unknown arguments leave target untouched', t => {
  failureUnchanged(fixture(t, undefined, canonical + '\nconst broken = ;'), /syntax check failed/);
  failureUnchanged(fixture(t, fixtureClient('') + '\nconst broken = ;'), /syntax check failed/);
  failureUnchanged(fixture(t), /Usage:/, '--unknown');
});

test('top-level await is not supported inside the synchronous closure', t => {
  failureUnchanged(fixture(t, undefined, canonical + '\nawait Promise.resolve();'), /await|valid/);
});
