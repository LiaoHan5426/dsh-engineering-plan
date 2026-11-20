import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function extract(name, indent = '          ') {
  const marker = `${indent}function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf(`\n${indent}}`, start);
  assert.ok(end > start, `unterminated ${name}`);
  return source.slice(start, end + indent.length + 2);
}

const previewNonceSource = extract('previewNonce', '        ');
const nonceWith = (crypto) => Function('window', `return (${previewNonceSource});`)({ crypto });

test('a secure context keeps the platform UUID', () => {
  const nonce = nonceWith({ randomUUID: () => '11111111-2222-3333-4444-555555555555' });
  assert.equal(nonce(), '11111111-2222-3333-4444-555555555555');
});

test('a page without crypto.randomUUID still gets a usable nonce', () => {
  for (const crypto of [undefined, null, {}, { getRandomValues: () => {} }, { randomUUID: 'nope' }]) {
    const nonce = nonceWith(crypto)();
    assert.match(nonce, /^[a-zA-Z0-9-]+$/, JSON.stringify(crypto));
    assert.ok(nonce.length > 8, 'long enough to correlate messages');
  }
});

test('a crypto object that throws does not blank the panel', () => {
  const nonce = nonceWith({ randomUUID: () => { throw new Error('Operation is insecure'); } })();
  assert.match(nonce, /^[a-zA-Z0-9-]+$/);
});

test('the fallback stays unique across calls', () => {
  const nonce = nonceWith(undefined);
  const values = new Set(Array.from({ length: 50 }, () => nonce()));
  assert.equal(values.size, 50);
});

function frameDocument(base) {
  const runtimeText = source.slice(source.indexOf('    function mermaidFrameRuntime('), source.indexOf('    function mermaidFrameDocument('));
  const documentText = source.slice(source.indexOf('    function mermaidFrameDocument('), source.indexOf('    const words ='));
  const runtime = Function(`return (${runtimeText})`)();
  return Function('window', 'mermaidFrameRuntime', `return (${documentText})`)({ location: { href: base } }, runtime);
}

test('the frame accepts the fallback nonce and still refuses a forged one', () => {
  const nonce = nonceWith(undefined)();
  const html = frameDocument('http://localhost/')(asset(), nonce);
  assert.match(html, new RegExp(`script-src 'nonce-${nonce}'`));
  assert.throws(() => frameDocument('http://localhost/')(asset(), 'bad"nonce'), /Invalid preview nonce/);

  function asset() {
    return 'http://localhost/mermaid.js';
  }
});

test('the preview uses the safe nonce helper instead of the raw platform call', () => {
  const component = source.slice(source.indexOf('        function MermaidPreview('),
    source.indexOf('        function BaselineStatusPanel('));
  assert.match(component, /if \(!nonce\.current\) nonce\.current = previewNonce\(\);/);
  assert.doesNotMatch(component, /window\.crypto\.randomUUID\(\)/);
  assert.match(component, /mermaidFrameDocument\(mermaidAsset, nonce\.current\)/);
});

test('the render timeout is armed before the frame can keep the panel on loading', () => {
  const component = source.slice(source.indexOf('        function MermaidPreview('),
    source.indexOf('        function BaselineStatusPanel('));
  const armed = component.indexOf('const timeout = setTimeout(');
  const empty = component.indexOf('if (!source?.trim()) return;');
  const notLoaded = component.indexOf('if (!loaded) return () => clearTimeout(timeout);');
  const post = component.indexOf('const timer = setTimeout(');
  assert.ok(empty > 0 && armed > empty, 'the timeout must be armed even for an empty source');
  assert.ok(notLoaded > armed, 'an iframe that never loads must still time out');
  assert.ok(post > notLoaded);
  assert.match(component, /t\("diagramTimeout"\)/);
  assert.match(component, /return \(\) => clearTimeout\(timeout\);/);
  assert.match(component, /return \(\) => \{ clearTimeout\(timer\); clearTimeout\(timeout\); \};/);
});

test('the timeout message is defined in both languages', () => {
  const entry = /^ {6}diagramTimeout: \[([^\]]*)\],$/m.exec(source);
  assert.ok(entry, 'diagramTimeout is undefined');
  const strings = [...entry[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
  assert.equal(strings.length, 2);
  assert.ok(strings.every((value) => value.trim().length > 0));
});
