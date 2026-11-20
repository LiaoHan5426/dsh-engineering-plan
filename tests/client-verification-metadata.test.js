import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Only evaluate the application functions and locale table, never the embedded vendor asset.
const file = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const source = file.slice(file.indexOf('    /* END EMBEDDED MERMAID */'));
function actual(name, bindings = {}, indent = '          ') {
  const start = source.indexOf(`${indent}function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf(`\n${indent}}`, start);
  assert.ok(end > start, name);
  return Function(...Object.keys(bindings), `return (${source.slice(start, end + indent.length + 2)});`)(...Object.values(bindings));
}
const wordsStart = source.indexOf('    const words = {');
const wordsEnd = source.indexOf('\n    };', wordsStart);
const words = Function(`return (${source.slice(wordsStart + '    const words = '.length, wordsEnd + 6)});`)();
const extraWordsStart = source.indexOf('    Object.assign(words, {', wordsEnd);
const extraWordsEnd = source.indexOf('\n    });', extraWordsStart);
assert.ok(extraWordsStart >= 0 && extraWordsEnd > extraWordsStart);
Function('words', source.slice(extraWordsStart, extraWordsEnd + '\n    });'.length))(words);
const element = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x != null && x !== false) });
function nodes(tree) { return typeof tree === 'object' && tree ? [tree, ...tree.children.flatMap(nodes)] : []; }
function text(tree) { return typeof tree === 'object' && tree ? tree.children.map(text).join(' ') : String(tree); }
const base = () => ({ runId: 'run-1', taskId: 'task', changeId: 'change', command: 'node --test', state: 'succeeded', revision: 2, planVersion: 1,
  exitCode: 0, timedOut: false, aborted: false, jobId: 'job-1', truncated: true,
  stdout: { text: 'bounded stdout', truncated: true }, stderr: { text: 'bounded stderr', truncated: false } });
function render(records, language = 0) {
  const t = key => words[key]?.[language] || key;
  return actual('verificationRunsView', {
    approved: false, change: { id: 'change', tasks: [], planVersion: 1, history: [] }, commandChoice: '', verificationRuns: records,
    resolution: {}, bindVerificationResolution: actual('bindVerificationResolution', {}, '    '),
    h: element, t, button: (label, onClick, disabled) => element('button', { onClick, disabled }, t(label)),
    busy: false, unsettled: false,
  })();
}
function article(tree) { return nodes(tree).find(n => n.type === 'article'); }
function fields(tree) {
  return nodes(tree).filter(n => n.type === 'dl').flatMap(dl => dl.children.map(row => {
    assert.equal(row.type, 'div');
    assert.deepEqual(row.children.map(n => n.type), ['dt', 'dd']);
    assert.equal(row.children[1].props.style.overflowWrap, 'anywhere');
    return [text(row.children[0]), text(row.children[1])];
  }));
}

test('new run renders the four recorded resolved values with dl semantics in both languages', () => {
  for (const language of [0, 1]) for (const onExpiry of ['kill', 'none']) {
    const record = { ...base(), execution: { resolved: { workdir: 'J:/recorded/<workdir>', timeoutMs: 12345, onExpiry, stdoutMaxBytes: 76543 } } };
    const before = structuredClone(record);
    const view = article(render([record], language));
    const entries = fields(view);
    assert.deepEqual(entries.slice(-4), [
      [words.executionWorkdir[language], 'J:/recorded/<workdir>'],
      [words.executionTimeout[language], '12345'],
      [words.executionOnExpiry[language], onExpiry],
      [words.executionStdoutMaxBytes[language], '76543'],
    ]);
    assert.ok(text(view).includes(words.shellNotRecorded[language]));
    assert.ok(!text(view).includes(words.executionNotRecorded[language]));
    assert.equal(nodes(view).filter(n => n.type === 'dl').at(-1).props.className, 'ep-grid');
    assert.equal(nodes(view).some(n => n.props.dangerouslySetInnerHTML), false);
    assert.deepEqual(record, before);
  }
});

test('legacy runs explicitly report absent parameters and never infer a shell from job, platform or stderr', () => {
  for (const language of [0, 1]) {
    const record = { ...base(), kind: 'bash', job: { kind: 'bash' }, platform: 'win32', executable: '/guessed/bash',
      stderr: { text: 'powershell.exe: command failed', truncated: false } };
    const view = article(render([record], language));
    assert.ok(text(view).includes(words.executionNotRecorded[language]));
    assert.ok(text(view).includes(words.shellNotRecorded[language]));
    const entries = fields(view);
    assert.equal(entries.length, 10);
    assert.ok(!JSON.stringify(entries).includes('bash'));
    assert.ok(!JSON.stringify(entries).includes('powershell'));
    assert.ok(!JSON.stringify(entries).includes('win32'));
    assert.ok(!text(view).includes('/guessed/bash'));
    assert.ok(nodes(view).some(n => n.type === 'pre' && text(n) === record.stderr.text));
  }
});

test('empty or partial metadata uses only recorded values without defaults or future shell fields', () => {
  for (const execution of [undefined, null, {}, { resolved: {} }, { resolved: { timeoutMs: '900', onExpiry: 'guess' } }]) {
    const view = article(render([{ ...base(), execution }]));
    assert.ok(text(view).includes(words.executionNotRecorded[0]));
    assert.equal(fields(view).length, 10);
  }
  const view = article(render([{ ...base(), execution: {
    requested: { workdir: '/requested', timeoutMs: 999 },
    resolved: { timeoutMs: 0, stdoutMaxBytes: 0, executable: '/future/shell', shell: 'future-shell' },
  } }]));
  assert.deepEqual(fields(view).slice(10), [[words.executionTimeout[0], '0'], [words.executionStdoutMaxBytes[0], '0']]);
  assert.ok(!text(view).includes('/requested'));
  assert.ok(!text(view).includes('future-shell'));
  assert.ok(!text(view).includes('/future/shell'));
});

test('new metadata preserves output text, truncation flags and independent per-run rendering', () => {
  const first = { ...base(), execution: { resolved: { workdir: '/recorded', timeoutMs: 2000, onExpiry: 'kill', stdoutMaxBytes: 64 } } };
  const second = { ...base(), runId: 'legacy' };
  const articles = nodes(render([first, second])).filter(n => n.type === 'article');
  assert.equal(articles.length, 2);
  assert.ok(!text(articles[1]).includes('/recorded'));
  for (const view of articles) {
    const entries = Object.fromEntries(fields(view));
    assert.equal(entries.truncated, 'true');
    assert.equal(entries.stdoutTruncated, 'true');
    assert.equal(entries.stderrTruncated, 'false');
    assert.equal(entries.exitCode, '0');
    assert.equal(entries.timedOut, 'false');
    const details = nodes(view).filter(n => n.type === 'details');
    assert.deepEqual(details.map(n => text(n.children[0])), ['stdout', 'stderr']);
    assert.deepEqual(details.map(n => text(n.children[1])), ['bounded stdout', 'bounded stderr']);
  }
});
