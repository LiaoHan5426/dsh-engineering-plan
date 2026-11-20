import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const CLIENT = path.join(ROOT, "client.js");

const source = await readFile(CLIENT, "utf8");

function slice(from, to) {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `missing anchor: ${from}`);
  const end = to ? source.indexOf(to, start) : source.length;
  assert.notEqual(end, -1, `missing anchor: ${to}`);
  return source.slice(start, end);
}

test("task detail drawer keeps its own open state", () => {
  assert.match(source, /const \[taskDrawer, setTaskDrawer\] = React\.useState\(null\);/);
});

test("the drawer resolves its task from the plan instead of trusting a stale card", () => {
  const block = slice("function taskDrawerCard() {", "function tasksView()");
  assert.match(block, /if \(!taskDrawer\) return null;/);
  assert.match(block, /\(draft\?\.tasks \|\| \[\]\)\.find\(\(item\) => item\.id === taskDrawer\)/);
  assert.match(block, /if \(!task\) return null;/);
});

test("the drawer is an accessible dialog with a single close button", () => {
  const block = slice("function taskDrawerCard() {", "function tasksView()");
  assert.match(block, /role: "dialog"/);
  assert.match(block, /button\("taskClose", \(\) => setTaskDrawer\(null\)\)/);
});

test("the drawer only offers completion for tasks waiting on a human", () => {
  const block = slice("function taskDrawerCard() {", "function tasksView()");
  assert.match(block, /task\.status === "awaiting-review" &&\s*button\("confirmTask"/);
});

test("the drawer shows why a task cannot start yet", () => {
  const block = slice("function taskDrawerCard() {", "function tasksView()");
  assert.match(block, /t\("readyBlockedReasons"\)/);
  assert.match(block, /readyReasons\(ready, task\.id\)/);
});

test("criterion rows put the result on the same line, right aligned", () => {
  const block = slice("function taskDrawerCard() {", "function tasksView()");
  assert.match(block, /className: "ep-criterion-row"/);
  assert.match(block, /className: "ep-criterion-outcome"/);
});

test("task cards open the drawer but ignore clicks on their own controls", () => {
  const block = slice('className: "ep-card ep-task-open"', 'h(\n                            "div",\n                            { className: "ep-row ep-between ep-task-card-head" }');
  assert.match(block, /onClick: \(event\) => \{/);
  assert.match(block, /closest\("button, a, summary, details, input, select, textarea"\)/);
  assert.match(block, /setTaskDrawer\(task\.id\)/);
});

test("the drawer never reaches for state owned by the board view", () => {
  const block = slice("function taskDrawerCard() {", "function tasksView()");
  assert.doesNotMatch(block, /\breadyFresh\b/);
  assert.doesNotMatch(block, /\btaskFilter\b/);
  assert.doesNotMatch(block, /\bgrouped\b/);
});
