import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const block = source.slice(source.indexOf("/* BEGIN COMMAND ROW */"), source.indexOf("/* END COMMAND ROW */"));

test("the engineering command claims its own transcript row", () => {
  assert.notEqual(block.length, 0, "command row block must exist");
  assert.match(block, /name: "conversation\.chat\.commandview", key: "engineering"/);
  assert.equal((source.match(/"conversation\.chat\.commandview"/g) || []).length, 2, "one inject and one register reference");
});

test("the recorded outcome text is parsed instead of printed", () => {
  assert.match(block, /function commandPayload\(node\) \{/);
  assert.match(block, /typeof node\.outcome\.text === "string"/);
  assert.match(block, /JSON\.parse\(text\)/);
  assert.match(block, /catch \(cause\) \{\n\s+return null;/);
  // The row never materialises the raw answer: that was the JSON wall in the chat flow.
  assert.doesNotMatch(block, /COMMAND_RAW_LIMIT|commandRaw/);
});

test("the detail folds the payload into bounded human lines", () => {
  const start = block.indexOf("function commandDetail(node)");
  const body = block.slice(start, block.indexOf("function commandSeverity(node)"));
  assert.match(body, /Array\.isArray\(payload\.changes\)/);
  assert.match(body, /changes\.slice\(0, 8\)/);
  assert.match(body, /t\("cmdMore", \{ count: changes\.length - 8 \}\)/);
  assert.match(body, /Array\.isArray\(payload\.runs\) && payload\.runs\.length\)/);
  assert.match(body, /alertBlockers\(payload\)\.slice\(0, 6\)/);
});

test("a failed or running command still renders a row", () => {
  const start = block.indexOf("function EngineeringCommandRow(props)");
  const body = block.slice(start);
  assert.match(body, /const running = !node \|\| !node\.outcome;/);
  assert.match(body, /node\.outcome\.kind === "error"/);
  assert.match(body, /h\("details", \{ className: "ep-command ep-command-" \+ severity/);
  assert.match(body, /h\("summary"/);
  assert.doesNotMatch(body, /useState|useEffect/, "the row must render without hook context");
});

test("the command row strings are bilingual and declared once", () => {
  for (const key of ["cmdChanges", "cmdRuns", "cmdTasks", "cmdTasksDone", "cmdBlockers", "cmdWarnings", "cmdMore"]) {
    const matches = source.match(new RegExp("^\\s+" + key + ": \\[", "gm")) || [];
    assert.equal(matches.length, 1, key + " must be declared once in the client word table");
  }
  assert.match(source, /cmdChanges: \["\{count\} 个变更", "\{count\} changes"\]/);
  assert.match(source, /cmdMore: \["另有 \{count\} 项，见工作台", "\{count\} more in the workbench"\]/);
});
