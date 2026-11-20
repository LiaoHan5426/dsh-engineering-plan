import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const rows = source.slice(source.indexOf("/* BEGIN TOOL ROWS */"), source.indexOf("/* END TOOL ROWS */"));

test("every engineering tool claims its own conversation row", () => {
  assert.notEqual(rows.length, 0, "tool rows block must exist");
  assert.match(rows, /const ENGINEERING_TOOLS = \["engineering_plan", "engineering_dispatch", "engineering_verify"\];/);
  assert.match(rows, /ctx\.slots\.inject\("tool\.call\.toolview", \(\) => ctx\.slots\.register\(\{ name: "tool\.call\.toolview", key: toolName \}, EngineeringToolRow\)\)/);
  assert.equal((source.match(/"tool\.call\.toolview"/g) || []).length, 2, "one inject and one register reference");
});

test("the settled payload is read from the content blocks, not a result field", () => {
  assert.match(rows, /function toolTexts\(block\) \{/);
  assert.match(rows, /item\.type === "text"/);
  assert.match(rows, /JSON\.parse\(text\)/);
  assert.match(rows, /const raw = block\.args \?\? block\.arguments;/);
  assert.doesNotMatch(rows, /const raw = block\.result \?\? block\.output;/, "a ToolResultNode has no result field");
});

test("the row summary reads the action, the change and the result shape", () => {
  const start = rows.indexOf("function toolSummary(block)");
  const block = rows.slice(start, rows.indexOf("function toolRaw(block)"));
  assert.match(block, /args\.action/);
  assert.match(block, /args\.changeId\.slice\(0, 8\)/);
  assert.match(block, /Array\.isArray\(view\.changes\)/);
  assert.match(block, /typeof view\.exitCode === "number"/);
  assert.match(block, /view\.blockers\.length/);
});

test("the raw payload is capped instead of printed whole", () => {
  assert.match(rows, /const TOOL_RAW_LIMIT = 1200;/);
  const start = rows.indexOf("function toolRaw(block)");
  const block = rows.slice(start, rows.indexOf("function EngineeringToolRow(props)"));
  assert.match(block, /payload\.slice\(0, TOOL_RAW_LIMIT\)/);
  assert.match(block, /catch \(error\) \{\n\s+return "";/);
});

test("the row is a plain disclosure with no hook dependency", () => {
  const start = rows.indexOf("function EngineeringToolRow(props)");
  const block = rows.slice(start, rows.indexOf("for (const toolName of ENGINEERING_TOOLS)"));
  assert.match(block, /h\("details", \{ className: "ep-tool ep-tool-" \+ severity/);
  assert.match(block, /h\("summary"/);
  assert.doesNotMatch(block, /useState|useDisclosure|useEffect/, "the row must render without hook context");
  assert.match(block, /raw && severity === "alert" \? h\("pre"/);
  assert.match(block, /props\.block\.isError === true/);
});
