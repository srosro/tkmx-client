const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

test("collectSessionStats returns parsed JSON from agentsview", () => {
  process.env.AGENTSVIEW_BIN = path.join(__dirname, "fixtures", "fake-agentsview");
  // Force re-require so AGENTSVIEW_BIN env override is read fresh.
  delete require.cache[require.resolve("../reporter/session-stats")];
  delete require.cache[require.resolve("../reporter/agentsview")];
  const { collectSessionStats } = require("../reporter/session-stats");
  const out = collectSessionStats({ sinceDays: 28 });
  assert.ok(out);
  assert.equal(out.schema_version, 1);
  assert.equal(out.totals.sessions_all, 10);
});

test("collectSessionStats returns null when binary missing", () => {
  process.env.AGENTSVIEW_BIN = "/definitely/not/here";
  delete require.cache[require.resolve("../reporter/session-stats")];
  delete require.cache[require.resolve("../reporter/agentsview")];
  const { collectSessionStats } = require("../reporter/session-stats");
  const out = collectSessionStats({ sinceDays: 28 });
  assert.equal(out, null);
});

test("collectSessionStats returns null on non-JSON output", () => {
  const brokenPath = path.join(__dirname, "fixtures", "broken-agentsview");
  require("node:fs").writeFileSync(brokenPath,
    "#!/usr/bin/env bash\necho 'garbage' && exit 0\n", { mode: 0o755 });
  process.env.AGENTSVIEW_BIN = brokenPath;
  delete require.cache[require.resolve("../reporter/session-stats")];
  delete require.cache[require.resolve("../reporter/agentsview")];
  const { collectSessionStats } = require("../reporter/session-stats");
  const out = collectSessionStats({ sinceDays: 28 });
  assert.equal(out, null);
});
