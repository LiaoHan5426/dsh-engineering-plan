import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

const source = fs.readFileSync('J:/Code/Engineering Planner/client.js', 'utf8');

test('the tab strip is a tablist, not a row of toggle buttons', () => {
  assert.match(source, /role: "tablist"/);
  assert.doesNotMatch(source, /"aria-pressed": tab === value/);
});

test('each tab carries the ARIA tab contract', () => {
  for (const attr of ['role: "tab"', '"aria-selected": tab === value ? "true" : "false"', '"aria-controls": "ep-tabpanel"', 'tabIndex: tab === value ? 0 : -1']) {
    assert.ok(source.includes(attr), `missing ${attr}`);
  }
  assert.match(source, /id: "ep-tab-" \+ value/);
});

test('both panel states are labelled by the owning tab', () => {
  const panels = [...source.matchAll(/id: "ep-tabpanel",\s*\n\s*role: "tabpanel",\s*\n\s*"aria-labelledby": "ep-tab-" \+ tab,/g)];
  assert.equal(panels.length, 2, 'empty and populated panels both need the role');
});

test('arrow, Home and End keys move the roving focus', () => {
  assert.match(source, /event\.key === "ArrowRight"/);
  assert.match(source, /event\.key === "ArrowLeft"/);
  assert.match(source, /event\.key === "Home"/);
  assert.match(source, /event\.key === "End"/);
  assert.match(source, /document\.getElementById\("ep-tab-" \+ value\)/);
});

test('the tab order constant matches the four views in the original specification', () => {
  assert.match(source, /const TABS = \["overview", "plan", "tasks", "resources"\];/);
});

test('a disabled button says why through aria-disabled and title', () => {
  assert.match(source, /"aria-disabled": locked \? "true" : undefined/);
  assert.match(source, /title: locked && reason \? reason : undefined/);
  assert.match(source, /const locked =/);
});
