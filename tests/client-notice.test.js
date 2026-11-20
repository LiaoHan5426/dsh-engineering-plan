import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const toolBlock = source.slice(source.indexOf("/* BEGIN TOOL ROWS */"), source.indexOf("/* END TOOL ROWS */"));
const commandBlock = source.slice(source.indexOf("/* BEGIN COMMAND ROW */"), source.indexOf("/* END COMMAND ROW */"));

test("a routine call stays quiet and an actionable one becomes a notification", () => {
  const toolSeverity = toolBlock.slice(toolBlock.indexOf("function toolSeverity(block)"), toolBlock.indexOf("function toolAlert(block)"));
  assert.match(toolSeverity, /block\.isError === true\) return "alert"/);
  assert.match(toolSeverity, /view\.warnings\.length\) return "alert"/);
  assert.match(toolSeverity, /alertBlockers\(view\)\.length\) return "alert"/);
  assert.match(toolSeverity, /run\.state === "unknown"\)\) return "alert"/);
  assert.match(toolSeverity, /return "quiet";/);
  const commandSeverity = commandBlock.slice(commandBlock.indexOf("function commandSeverity(node)"), commandBlock.indexOf("function commandAlert(node)"));
  assert.match(commandSeverity, /node\.outcome\.kind === "error"\) return "alert"/);
  assert.match(commandSeverity, /payload\.warnings\.length\) return "alert"/);
  assert.match(commandSeverity, /alertBlockers\(payload\)\.length\) return "alert"/);
  assert.match(commandSeverity, /return "quiet";/);
  // "Work in progress" is not a notification: only a blocker a human must resolve is.
  assert.match(source, /const ALERT_BLOCKER_CODES = new Set\(\["UNRESOLVED_UNKNOWN", "MISSING_EVIDENCE", "APPROVAL_REQUIRED"\]\);/);
  assert.match(source, /function alertBlockers\(view\) \{/);
});

test("only a notification opens itself and carries the raw payload", () => {
  assert.match(toolBlock, /open: severity === "alert"/);
  // A command row is a record, not a dialog: it never opens itself and never prints the raw answer,
  // so a stray alert cannot dump JSON into the chat flow.
  assert.doesNotMatch(commandBlock, /open: severity === "alert"/);
  assert.doesNotMatch(commandBlock, /commandRaw\(node\)/);
  assert.match(commandBlock, /detail \? h\("pre", \{ className: "ep-command-detail"/);
  assert.match(toolBlock, /const raw = settled && severity === "alert" \? toolRaw\(props\.block\) : "";/);
  assert.match(toolBlock, /raw && severity === "alert" \? h\("pre"/);
});

test("a command row titles itself by the answer's shape", () => {
  // The command is registered with recordInput:false, so args never reach the transcript and every
  // row used to read "list"; the action is inferred from the payload instead.
  assert.match(commandBlock, /function inferAction\(payload\) \{/);
  assert.match(commandBlock, /if \(Array\.isArray\(payload\.changes\)\) return "list";/);
  assert.match(commandBlock, /if \(Array\.isArray\(payload\.blockers\)\) return "gateStatus";/);
  assert.match(commandBlock, /if \(payload\.change && typeof payload\.change === "object"\) return "get";/);
  assert.match(commandBlock, /return inferAction\(commandPayload\(node\)\);/);
  assert.match(commandBlock, /function commandCountParts\(node\) \{/);
  // Zero is not information: an empty run list stays out of the summary.
  assert.match(commandBlock, /Array\.isArray\(payload\.runs\) && payload\.runs\.length\) parts\.push/);
});

test("the workbench lists only what needs a human decision", () => {
  assert.match(source, /const openItems = \[\];/);
  assert.match(source, /change\.status === "draft" && !approved\) openItems\.push\(\{ key: "review"/);
  // The strip is a call to action, not a status banner: a plan that is merely unfinished stays out.
  assert.match(source, /const needsHuman = running \? alertBlockers\(gate\) : \[\];/);
  assert.match(source, /if \(needsHuman\.length > 0\) openItems\.push\(\{ key: "blockers"/);
  assert.match(source, /needsHuman\.some\(\(blocker\) => blocker && blocker\.code === "UNRESOLVED_UNKNOWN"\)\) openItems\.push\(\{ key: "unknown"/);
  assert.match(source, /const noticesView = openItems\.length === 0 \? null : h\(/);
  assert.match(source, /className: "ep-notices", role: "status"/);
});

test("the notification strings are bilingual and declared once", () => {
  for (const key of ["noticeTitle", "noticeReview", "noticeBlockers", "noticeUnknown"]) {
    const matches = source.match(new RegExp("^\\s+" + key + ": \\[", "gm")) || [];
    assert.equal(matches.length, 1, key + " must be declared once in the client word table");
  }
  assert.match(source, /noticeTitle: \["需要你处理", "Needs your action"\]/);
  assert.match(source, /noticeReview: \["计划待你评审：在工作台确认方案", "Plan awaits your review in the workbench"\]/);
});

test("quiet rows are dimmed and notifications are marked in the stylesheet", () => {
  assert.match(source, /\.ep-command-quiet,\.ep-tool-quiet\{opacity:0\.55;font-size:12px\}/);
  assert.match(source, /\.ep-command-alert,\.ep-tool-alert\{border-left:2px solid/);
  assert.match(source, /\.ep-notices\{display:grid/);
  assert.match(source, /\.ep-notice-item\{text-align:left/);
});
