import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const SCRIPT = 'scripts/embed-mermaid.mjs';
const VENDOR = 'assets/mermaid-11.17.2.min.js';
const sha = (text) => createHash('sha256').update(text).digest('hex');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ep-embed-mermaid-check-'));
  cpSync(new URL('scripts', ROOT), join(dir, 'scripts'), { recursive: true });
  cpSync(new URL('assets', ROOT), join(dir, 'assets'), { recursive: true });
  cpSync(new URL('client.js', ROOT), join(dir, 'client.js'));
  return dir;
}

const run = (cwd, args) => spawnSync(process.execPath, [join('scripts', 'embed-mermaid.mjs'), ...args], {
  cwd,
  encoding: 'utf8'
});

test('the real tree passes --check without touching client.js', () => {
  const file = new URL('client.js', ROOT);
  const before = sha(readFileSync(file, 'utf8'));
  const out = execFileSync(process.execPath, ['scripts/embed-mermaid.mjs', '--check'], {
    cwd: new URL('.', ROOT),
    encoding: 'utf8'
  });
  const payload = JSON.parse(out.trim().split('\n').pop());
  assert.equal(payload.check, true);
  assert.equal(payload.changed, false);
  assert.equal(sha(readFileSync(file, 'utf8')), before, 'check must not rewrite client.js');
});

test('a tampered embedding is reported and left untouched', () => {
  const dir = fixture();
  try {
    const file = join(dir, 'client.js');
    const original = readFileSync(file, 'utf8');
    const startMarker = '    /* BEGIN EMBEDDED MERMAID 11.17.2 */';
    const endMarker = '    /* END EMBEDDED MERMAID */';
    const start = original.indexOf(startMarker);
    const end = original.indexOf(endMarker, start);
    const literal = original.slice(start, end).match(/const mermaidAsset = (".*");\n?$/s)[1];
    const tampered = JSON.parse(literal).replace('mermaid', 'mermAid');
    const block = `${startMarker}\n    const mermaidAsset = ${JSON.stringify(tampered)};\n${endMarker}`;
    const edited = original.slice(0, start) + block + original.slice(end + endMarker.length);
    writeFileSync(file, edited, 'utf8');
    const before = sha(edited);

    const result = run(dir, ['--check']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /differs from the vendor asset/);
    assert.match(result.stderr, /to rebuild/);
    assert.equal(sha(readFileSync(file, 'utf8')), before, 'a failed check must not rewrite client.js');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing embedding fails --check but a plain run rebuilds it', () => {
  const dir = fixture();
  try {
    const file = join(dir, 'client.js');
    const original = readFileSync(file, 'utf8');
    const startMarker = '    /* BEGIN EMBEDDED MERMAID 11.17.2 */';
    const endMarker = '    /* END EMBEDDED MERMAID */';
    const start = original.indexOf(startMarker);
    const end = original.indexOf(endMarker, start);
    const placeholder = '    const mermaidAsset = "__EP_MERMAID_VENDOR_SOURCE__";';
    const stripped = original.slice(0, start) + placeholder + original.slice(end + endMarker.length);
    writeFileSync(file, stripped, 'utf8');

    const checked = run(dir, ['--check']);
    assert.notEqual(checked.status, 0);
    assert.equal(readFileSync(file, 'utf8'), stripped, 'a failed check must not write the placeholder back');

    const rebuilt = run(dir, []);
    assert.equal(rebuilt.status, 0);
    const payload = JSON.parse(rebuilt.stdout.trim().split('\n').pop());
    assert.equal(payload.changed, true);
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes(startMarker) && text.includes(endMarker));
    const literal = text.slice(text.indexOf(startMarker), text.indexOf(endMarker)).match(/const mermaidAsset = (".*");\n?$/s)[1];
    assert.equal(JSON.parse(literal), readFileSync(join(dir, VENDOR), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
