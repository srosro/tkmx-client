const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

// Each case runs with HOME + PATH reset so `resolveAgentsview` can't fall
// through to a real agentsview install at ~/.local/bin/agentsview (a
// candidate path) or via `which` on the host's PATH.
//
// PATH is set to /bin:/usr/bin so shebangs (`#!/usr/bin/env bash`) in the
// test fixtures can still resolve their interpreter. That's enough surface
// for the shebang but not enough for the `which agentsview` fallback to
// find anything real.
const ORIG = {
  AGENTSVIEW_BIN: process.env.AGENTSVIEW_BIN,
  HOME: process.env.HOME,
  PATH: process.env.PATH,
};
let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-ssession-"));
  process.env.HOME = tmpHome;
  process.env.PATH = "/bin:/usr/bin";
  delete process.env.AGENTSVIEW_BIN;
  delete require.cache[require.resolve("../reporter/session-stats")];
  delete require.cache[require.resolve("../reporter/agentsview")];
});

afterEach(() => {
  if (ORIG.AGENTSVIEW_BIN === undefined) delete process.env.AGENTSVIEW_BIN;
  else process.env.AGENTSVIEW_BIN = ORIG.AGENTSVIEW_BIN;
  process.env.HOME = ORIG.HOME;
  process.env.PATH = ORIG.PATH;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test("collectSessionStats returns parsed JSON from agentsview", () => {
  process.env.AGENTSVIEW_BIN = path.join(__dirname, "fixtures", "fake-agentsview");
  const { collectSessionStats } = require("../reporter/session-stats");
  const out = collectSessionStats({ sinceDays: 28 });
  assert.ok(out);
  assert.equal(out.schema_version, 1);
  assert.equal(out.totals.sessions_all, 10);
});

test("collectSessionStats returns null when binary missing", () => {
  process.env.AGENTSVIEW_BIN = "/definitely/not/here";
  const { collectSessionStats } = require("../reporter/session-stats");
  const out = collectSessionStats({ sinceDays: 28 });
  assert.equal(out, null);
});

test("collectSessionStats returns null on non-JSON output", () => {
  // broken-agentsview is a committed static fixture under test/fixtures/
  // that prints garbage and exits 0 — exercises the JSON.parse failure path.
  process.env.AGENTSVIEW_BIN = path.join(__dirname, "fixtures", "broken-agentsview");
  const { collectSessionStats } = require("../reporter/session-stats");
  const out = collectSessionStats({ sinceDays: 28 });
  assert.equal(out, null);
});
