import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

test('the workbench watches the state directory instead of polling the host', () => {
  // A poll ran one /engineering command every five seconds, and every execution is written into
  // the transcript: that is the looping output the panel has to stop producing.
  assert.equal(source.includes('setInterval(synchronize, 5000)'), false, 'the five-second poll must be gone');
  assert.match(source, /const STATE_DIRECTORY = "\.dsh\/engineering\/changes";/);
  assert.match(source, /ctx\.remote\.workspaceFiles\.changes\(props\.sessionId, STATE_DIRECTORY, controller\.signal\)/);
  assert.match(source, /for await \(const frame of frames\)/);
  for (const kind of ['changed', 'refresh', 'ready'])
    assert.ok(source.includes(`frame.kind === "${kind}"`), `the watch must accept ${kind} frames`);
});

test('a burst of writes collapses into one query and the fallback is rare', () => {
  assert.match(source, /settle = window\.setTimeout\(\(\) => \{\s*settle = 0;\s*void synchronize\(\);\s*\}, 700\)/);
  assert.match(source, /const fallback = window\.setInterval\(\(\) => \{\s*if \(document\.visibilityState === "visible"\) queue\(\);\s*\}, 120000\)/);
  // Focus and a tab switch are not evidence that the plan changed, so they only nudge a read when
  // the snapshot has actually gone stale; a mere refocus must not append a transcript line.
  assert.match(source, /const wake = \(\) => \{\s*if \(Date\.now\(\) - lastRead > 30000\) queue\(\);\s*\}/);
  assert.match(source, /window\.addEventListener\("focus", wake\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", wake\)/);
});

test('routine panel reads do not each cost a command', () => {
  // The workbench mounts twice at once (conversation view plus sidebar tab) and each mount read the
  // same state, so one human click produced duplicate transcript lines.
  assert.match(source, /const readCache = new Map\(\);/);
  assert.match(source, /function sharedRead\(key, ttl, produce\)/);
  assert.match(source, /if \(hit\?\.inflight\) return hit\.inflight;/);
  // A read this panel just made is reflected locally instead of re-read.
  assert.match(source, /if \(!available\(\) \|\| reading \|\| wroteRecently\(props\.sessionId\)\) return;/);
  // And a routine read is not a conversation event: it earns a line only when a human must act.
  assert.match(source, /const QUIET_ACTIONS = new Set\(\[/);
  assert.match(source, /if \(QUIET_ACTIONS\.has\(commandAction\(node\)\) && commandSeverity\(node\) === "quiet"\) return null;/);
});

test('the watch owns its lifetime and the effect no longer restarts on every render', () => {
  assert.match(source, /\}, \[props\.sessionId\]\);\s*\n\s*async function get\(id\)/);
  assert.match(source, /controller\.abort\(\);/);
  assert.match(source, /window\.clearInterval\(fallback\)/);
  // The guard reads the live busy flag through a ref, because the effect is no longer recreated
  // when it changes.
  assert.match(source, /const available = \(\) => !disposed && !lock\.current && !busyRef\.current/);
  assert.match(source, /const busyRef = React\.useRef\(busy\);/);
});
