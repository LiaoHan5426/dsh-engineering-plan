import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSource } from "../scripts/check-declaration-order.mjs";

const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");

test("the shipped client has no initializer that reads a later sibling declaration", () => {
  assert.deepEqual(checkSource(client), []);
});

test("the checker reports the exact defect that shipped once", () => {
  const source = [
    "function resourcesView() {",
    "  const postMortem = !!selectedTask && selectedTask.status === 'failed';",
    "  const selectedTask = change.tasks.find((task) => task.id === evidence.taskId);",
    "  return postMortem;",
    "}",
  ].join("\n");
  assert.deepEqual(checkSource(source), [{ function: "resourcesView", name: "selectedTask", line: 2, declarationLine: 3 }]);
});

test("a declaration that only reads earlier siblings is accepted", () => {
  const source = ["function view() {", "  const task = 1;", "  const label = task + 1;", "  return label;", "}"].join("\n");
  assert.deepEqual(checkSource(source), []);
});

test("a read inside a callback body is not a temporal dead zone hit", () => {
  const source = [
    "function view() {",
    "  const load = () => format(task);",
    "  const task = 1;",
    "  return load;",
    "}",
  ].join("\n");
  assert.deepEqual(checkSource(source), []);
});

test("property keys in an object literal are not reads", () => {
  const source = [
    "function view() {",
    "  const live = React.useRef({ change: null, unsettled: false });",
    "  const [unsettled, setUnsettled] = React.useState(false);",
    "  return [live, unsettled];",
    "}",
  ].join("\n");
  assert.deepEqual(checkSource(source), []);
});
