import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");

test("the sidebar tab is registered with the documented descriptor", () => {
  const start = source.indexOf("service.registerTab({");
  assert.notEqual(start, -1, "registerTab must be called");
  const block = source.slice(start, start + 900);
  assert.match(block, /id: SIDEBAR_TAB,/);
  assert.match(block, /single: true,/);
  assert.match(block, /order: 60,/);
  assert.match(block, /title: \(\) => t\("entry"\)/);
  assert.match(block, /description: \(\) => t\("sidebarTabDescription"\)/);
  assert.match(block, /component: \(\{ scope \}\) => h\(Panel, \{ sessionId: scope\.sessionId, compact: true, sidebarMode: true \}\)/);
  assert.match(source, /const SIDEBAR_TAB = "engineering-planner:workbench";/);
});

test("the optional service is declared as a dynamic dependency", () => {
  // Cordis only exposes a service the plugin declared; a bare ctx.get()/ctx.x read is not a
  // declaration and the panel never registered, which is why the tab stayed missing.
  const start = source.indexOf('ctx.inject(["betterSidebar"]');
  assert.notEqual(start, -1, "the side panel must be injected dynamically");
  const block = source.slice(start, start + 1200);
  assert.match(source, /let betterSidebar = null;/);
  assert.match(block, /const service = sidebarCtx\.betterSidebar;/);
  assert.match(block, /if \(!service \|\| typeof service\.registerTab !== "function"\) return;/);
  assert.match(block, /sidebarCtx\.effect\(\(\) =>/);
  assert.doesNotMatch(source, /ctx\.betterSidebar/, "an undeclared service read throws in Cordis");
  assert.doesNotMatch(source, /ctx\.get\("betterSidebar"\)/, "a plain lookup is not a dependency declaration");
});

test("inject stays a string array so the client module keeps loading", () => {
  const start = source.indexOf("return {\n      inject:");
  assert.notEqual(start, -1);
  const block = source.slice(start, start + 200);
  assert.match(block, /inject: \["slots", "locale", "remote", "remote\.commands", "remote\.workspaceFiles", "connection"\]/);
  assert.doesNotMatch(source, /inject: \{ required:/, "the object form stopped the module from loading");
});

test("compact mode is a class on the same layout, not a second component", () => {
  assert.match(source, /const compact = !!props\.compact;/);
  assert.match(source, /className: compact \? "ep-layout ep-compact" : "ep-layout"/);
  assert.match(source, /\.ep-compact \.ep-layout\{display:block\}/);
  assert.match(source, /\.ep-compact \.ep-matrix\{min-width:0\}/);
});

test("the side panel has no composer, so insert falls back to the clipboard", () => {
  const start = source.indexOf("function insertChatText(request) {");
  assert.notEqual(start, -1);
  const block = source.slice(start, start + 400);
  assert.match(block, /if \(compact && !props\.inputActions\) \{/);
  assert.match(block, /copy\(request\);/);
  assert.match(block, /setNotice\(t\("sidebarCopied"\)\);/);
  assert.match(block, /return true;/);
});

test("the entry card is only offered in the wide view and opens the same tab", () => {
  assert.match(source, /!compact && betterSidebar\?\.openTab && h\("div", \{ className: "ep-card" \}/);
  assert.match(source, /button\("openInSidebar", \(\) => openSidebar\(\)\)/);
  assert.match(source, /betterSidebar\.openTab\(\{ type: SIDEBAR_TAB \}\)/);
});

test("both languages carry every side panel string", () => {
  for (const key of ["openInSidebar", "sidebarHint", "sidebarCopied", "sidebarTabDescription", "toolReady", "toolRunning", "toolFailed", "cmdChanges", "cmdRuns", "cmdTasks", "cmdTasksDone", "cmdBlockers", "cmdWarnings", "cmdMore"]) {
    const matches = source.match(new RegExp("^\\s+" + key + ": \\[", "gm")) || [];
    assert.equal(matches.length, 1, key + " must be declared once in the client word table");
  }
  assert.match(source, /openInSidebar: \["在侧边栏打开", "Open in side panel"\]/);
  assert.match(source, /sidebarTabDescription: \["工程研发规划、任务看板与交付门禁", "Engineering plan, task board and delivery gates"\]/);
});
