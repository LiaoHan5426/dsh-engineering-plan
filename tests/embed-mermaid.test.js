import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const scriptURL = new URL('../scripts/embed-mermaid.mjs', import.meta.url);
const vendorURL = new URL('../assets/mermaid-11.17.2.min.js', import.meta.url);
const clientURL = new URL('../client.js', import.meta.url);
const sha256 = '581ed7d74bd9048d0e3a91363927d72ef22942d7722546b27f7cc29e35390eb8';
const startMarker = '    /* BEGIN EMBEDDED MERMAID 11.17.2 */';
const endMarker = '    /* END EMBEDDED MERMAID */';
const placeholderClient = '(() => {\n    const mermaidAsset = "__EP_MERMAID_VENDOR_SOURCE__";\n})();\n';

function fixture(t, client = placeholderClient) {
  const root = mkdtempSync(join(tmpdir(), 'ep-embed-mermaid-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'assets'));
  const script = join(root, 'scripts', 'embed-mermaid.mjs');
  const vendor = join(root, 'assets', 'mermaid-11.17.2.min.js');
  const file = join(root, 'client.js');
  copyFileSync(scriptURL, script);
  copyFileSync(vendorURL, vendor);
  if (client === null) copyFileSync(clientURL, file);
  else writeFileSync(file, client);
  return { root, script, vendor, file };
}

function node(f, ...args) {
  const result = spawnSync(process.execPath, args, { cwd: f.root, encoding: 'utf8', timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function build(f) {
  const result = node(f, f.script);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const bytes = readFileSync(f.file);
  assert.equal(report.vendorVersion, '11.17.2');
  assert.equal(report.sha256, createHash('sha256').update(readFileSync(f.vendor)).digest('hex'));
  assert.equal(report.clientBytes, bytes.length);
  const check = node(f, '--check', f.file);
  assert.equal(check.status, 0, check.stderr);
  return bytes;
}

function embeddedValue(bytes) {
  const source = bytes.toString('utf8');
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'complete marker pair');
  const block = source.slice(start + startMarker.length, end);
  // Evaluate only the generated declaration, never the vendor program itself.
  return runInNewContext(`${block}\nmermaidAsset`, Object.create(null), { timeout: 5_000 });
}

for (const [label, client] of [['placeholder', placeholderClient], ['existing client', null]]) {
  test(`embed Mermaid rebuilds ${label} with exact vendor bytes and identical second output`, t => {
    const f = fixture(t, client);
    const vendor = readFileSync(f.vendor);
    assert.equal(createHash('sha256').update(vendor).digest('hex'), sha256);
    const first = build(f);
    assert.deepEqual(Buffer.from(embeddedValue(first), 'utf8'), vendor);
    const second = build(f);
    assert.deepEqual(second, first);
  });
}

test('embed Mermaid preserves actual Unicode separators, literal escapes and newlines', t => {
  const f = fixture(t);
  const vendor = 'globalThis.fixture = "line\u2028paragraph\u2029literal\\u2028\\u2029";\n// CRLF follows\r\n// quotes " and slash \\ and replacement $& $` $\'\n';
  writeFileSync(f.vendor, vendor);
  // Repin only the copied script so this fixture exercises otherwise rare bytes.
  const script = readFileSync(f.script, 'utf8');
  assert.equal(script.split(sha256).length, 2);
  writeFileSync(f.script, script.replace(sha256, createHash('sha256').update(vendor).digest('hex')));
  const first = build(f);
  assert.equal(embeddedValue(first), vendor);
  assert.ok(!first.toString('utf8').includes('\u2028'));
  assert.ok(!first.toString('utf8').includes('\u2029'));
  assert.deepEqual(build(f), first);
});

test('embed Mermaid rejects bad SHA without changing client bytes', t => {
  const f = fixture(t);
  const before = readFileSync(f.file);
  writeFileSync(f.vendor, Buffer.concat([readFileSync(f.vendor), Buffer.from('\n// altered')]));
  const result = node(f, f.script);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected Mermaid vendor checksum/);
  assert.deepEqual(readFileSync(f.file), before);
});

for (const [label, client, error] of [
  ['missing end marker', `(() => {\n${startMarker}\n    const mermaidAsset = "old";\n})();\n`, /Missing embedded end marker/],
  ['missing start marker', `(() => {\n    const mermaidAsset = "old";\n${endMarker}\n})();\n`, /Missing embedding placeholder/],
  ['missing markers and placeholder', '(() => { const untouched = true; })();\n', /Missing embedding placeholder/],
]) {
  test(`embed Mermaid rejects ${label} without changing client bytes`, t => {
    const f = fixture(t, client);
    const before = readFileSync(f.file);
    const result = node(f, f.script);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.deepEqual(readFileSync(f.file), before);
  });
}
