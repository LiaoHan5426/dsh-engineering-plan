import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));

test('the architecture diagram is derived from the task graph', () => {
  const body = slice('          // The architecture picture is a fact about the plan', '          function architectureView()');
  assert.match(body, /function autoArchitectureDiagram\(view\)/);
  assert.match(body, /const lines = \["flowchart LR"\]/);
  assert.match(body, /subgraph g/);
  assert.match(body, /ids\.get\(dependency\) \+ " --> " \+ ids\.get\(task\.id\)/);
  assert.match(body, /task\.status === "awaiting-review"/);
  assert.match(body, /classDef done/);
  assert.match(body, /classDef review/);
  assert.match(body, /affectedModules/);
});

test('the preview falls back to the derived diagram and says where it came from', () => {
  const view = slice('          function architectureView()', '          function evidenceMatrix()');
  assert.match(view, /source: draft\.diagrams\[diagram\] \|\| \(diagram === "architecture" \? autoArchitectureDiagram\(draft\) : ""\)/);
  assert.match(view, /!draft\.diagrams\.architecture &&/);
  assert.match(view, /t\("autoDiagramHint"\)/);
});

test('awaiting-review is a first-class task state in the workbench', () => {
  assert.match(source, /"awaiting-review": \["待人工审核", "Awaiting review"\]/);
  const statuses = slice('    const statuses = [', '    const clone =');
  assert.match(statuses, /"verifying",\s*"awaiting-review",/);
  const graph = slice('        const graph = {', '        // Deliberately not cryptographic');
  assert.match(graph, /verifying: \[[^\]]*"awaiting-review"/);
  assert.match(graph, /"awaiting-review": \["running", "blocked", "cancelled", "completed"\]/);
});

test('a gated task offers exactly one human confirmation', () => {
  assert.match(source, /task\.status === "awaiting-review" &&\s*button\(\s*"confirmTask",/);
  assert.match(source, /mutate\("transition", \{ taskId: task\.id, status: "completed" \}\)/);
  assert.match(source, /confirmTask: \["确认完成", "Confirm done"\]/);
});

test('readiness is display-only so nobody has to tick it by hand', () => {
  const checklist = slice('          function planningChecklist()', '          function revealTask(');
  assert.doesNotMatch(checklist, /updateSection/);
  assert.doesNotMatch(checklist, /field\("reviewRequirements"/);
  assert.match(checklist, /planning\.sections\[key\]\.status === "ready" \? "readinessReady" : "readinessPending"/);
  assert.match(checklist, /documentEditor\(key\)/);
});

test('the notice strip counts the tasks waiting for a human', () => {
  const panel = slice('          const openItems = [];', '          const noticesView =');
  assert.match(panel, /filter\(\(task\) => task\.status === "awaiting-review"\)\.length/);
  assert.match(panel, /key: "reviewTasks"/);
  assert.match(panel, /tab: "tasks"/);
  assert.match(source, /noticeReviewTasks: \["\{count\} 项待你确认完成"/);
});
