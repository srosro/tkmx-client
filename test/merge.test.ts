import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mergeDailyUsage } from "../reporter/merge";

// Single test factory for ModelBreakdown rows. Fills in zeros for any
// counter the test doesn't pin so call sites stay readable, while still
// producing a row that satisfies the strict ModelBreakdown contract
// (every counter required, totalTokens included).
const breakdown = (
  modelName: string,
  overrides: { in?: number; out?: number; cw?: number; cr?: number; total?: number; cost?: number; source?: string } = {},
) => ({
  modelName,
  source: overrides.source,
  inputTokens: overrides.in || 0,
  outputTokens: overrides.out || 0,
  cacheCreationTokens: overrides.cw || 0,
  cacheReadTokens: overrides.cr || 0,
  totalTokens: overrides.total || 0,
  cost: overrides.cost,
});

describe("mergeDailyUsage", () => {
  it("merges two sources with overlapping dates", () => {
    const claude = [
      { date: "2026-04-05", modelBreakdowns: [breakdown("opus", { total: 100 })] },
      { date: "2026-04-06", modelBreakdowns: [breakdown("opus", { total: 200 })] },
    ];
    const codex = [
      { date: "2026-04-05", modelBreakdowns: [breakdown("o3", { total: 50 })] },
      { date: "2026-04-07", modelBreakdowns: [breakdown("o3", { total: 300 })] },
    ];

    const result = mergeDailyUsage(claude, codex);
    assert.equal(result.length, 3);
    // April 5 has both sources merged
    assert.equal(result[0].date, "2026-04-05");
    assert.equal(result[0].modelBreakdowns.length, 2);
    // April 6 has only claude
    assert.equal(result[1].date, "2026-04-06");
    assert.equal(result[1].modelBreakdowns.length, 1);
    // April 7 has only codex
    assert.equal(result[2].date, "2026-04-07");
    assert.equal(result[2].modelBreakdowns.length, 1);
  });

  it("returns sorted by date", () => {
    const source = [
      { date: "2026-04-07", modelBreakdowns: [] },
      { date: "2026-04-05", modelBreakdowns: [] },
      { date: "2026-04-06", modelBreakdowns: [] },
    ];
    const result = mergeDailyUsage(source);
    assert.deepEqual(result.map((d) => d.date), ["2026-04-05", "2026-04-06", "2026-04-07"]);
  });

  it("returns empty array for empty inputs", () => {
    assert.deepEqual(mergeDailyUsage([], []), []);
  });

  it("handles a single source", () => {
    const source = [
      { date: "2026-04-05", modelBreakdowns: [breakdown("opus", { total: 100 })] },
    ];
    const result = mergeDailyUsage(source);
    assert.equal(result.length, 1);
    assert.equal(result[0].modelBreakdowns[0].totalTokens, 100);
  });

  // The following tests cover the PR #5 EXTRA_CLAUDE_CONFIGS case: one reporter
  // aggregates ccusage output from multiple machines, each of which may have
  // used the same claude model on the same day. Without summation, the server's
  // INSERT OR REPLACE (keyed on user/date/model/client_id) would silently drop
  // all but one of the colliding rows.

  it("sums tokens and cost when the same (date, model, source) appears in two sources", () => {
    const local = [{
      date: "2026-04-09",
      modelBreakdowns: [breakdown("claude-opus-4-6", { in: 100, out: 200, cw: 10, cr: 50, total: 360, cost: 1.25, source: "claude" })],
    }];
    const remote = [{
      date: "2026-04-09",
      modelBreakdowns: [breakdown("claude-opus-4-6", { in: 400, out: 800, cw: 40, cr: 150, total: 1390, cost: 4.75, source: "claude" })],
    }];

    const result = mergeDailyUsage(local, remote);
    assert.equal(result.length, 1);
    assert.equal(result[0].modelBreakdowns.length, 1);
    const merged = result[0].modelBreakdowns[0];
    assert.equal(merged.modelName, "claude-opus-4-6");
    assert.equal(merged.source, "claude");
    assert.equal(merged.inputTokens, 500);
    assert.equal(merged.outputTokens, 1000);
    assert.equal(merged.cacheCreationTokens, 50);
    assert.equal(merged.cacheReadTokens, 200);
    assert.equal(merged.totalTokens, 1750);
    assert.equal(merged.cost, 6);
  });

  it("keeps different models separate on the same day", () => {
    const local = [{
      date: "2026-04-09",
      modelBreakdowns: [breakdown("claude-opus-4-6", { total: 100 })],
    }];
    const remote = [{
      date: "2026-04-09",
      modelBreakdowns: [breakdown("claude-haiku-4-5", { total: 200 })],
    }];
    const result = mergeDailyUsage(local, remote);
    assert.equal(result[0].modelBreakdowns.length, 2);
    const names = result[0].modelBreakdowns.map((b) => b.modelName).sort();
    assert.deepEqual(names, ["claude-haiku-4-5", "claude-opus-4-6"]);
  });

  it("keeps same model but different source separate", () => {
    const claude = [{
      date: "2026-04-09",
      modelBreakdowns: [breakdown("shared-model", { total: 100, source: "claude" })],
    }];
    const codex = [{
      date: "2026-04-09",
      modelBreakdowns: [breakdown("shared-model", { total: 200, source: "codex" })],
    }];
    const result = mergeDailyUsage(claude, codex);
    assert.equal(result[0].modelBreakdowns.length, 2);
    const bySource = Object.fromEntries(
      result[0].modelBreakdowns.map((b) => [b.source, b.totalTokens]),
    );
    assert.deepEqual(bySource, { claude: 100, codex: 200 });
  });

  it("sums across three or more sources", () => {
    const mk = (n: number) => [{ date: "2026-04-09", modelBreakdowns: [breakdown("opus", { total: n })] }];
    const result = mergeDailyUsage(mk(100), mk(200), mk(300));
    assert.equal(result[0].modelBreakdowns.length, 1);
    assert.equal(result[0].modelBreakdowns[0].totalTokens, 600);
  });

  it("does not mutate the input source arrays", () => {
    const original = breakdown("opus", { in: 10, total: 10 });
    const local = [{ date: "2026-04-09", modelBreakdowns: [original] }];
    const remote = [{ date: "2026-04-09", modelBreakdowns: [breakdown("opus", { in: 5, total: 5 })] }];
    mergeDailyUsage(local, remote);
    assert.equal(original.inputTokens, 10);
    assert.equal(original.totalTokens, 10);
  });
});
