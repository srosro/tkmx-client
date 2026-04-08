const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { mergeDailyUsage } = require("../reporter/merge");

describe("mergeDailyUsage", () => {
  it("merges two sources with overlapping dates", () => {
    const claude = [
      { date: "2026-04-05", modelBreakdowns: [{ modelName: "opus", totalTokens: 100 }] },
      { date: "2026-04-06", modelBreakdowns: [{ modelName: "opus", totalTokens: 200 }] },
    ];
    const codex = [
      { date: "2026-04-05", modelBreakdowns: [{ modelName: "o3", totalTokens: 50 }] },
      { date: "2026-04-07", modelBreakdowns: [{ modelName: "o3", totalTokens: 300 }] },
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
      { date: "2026-04-05", modelBreakdowns: [{ modelName: "opus", totalTokens: 100 }] },
    ];
    const result = mergeDailyUsage(source);
    assert.equal(result.length, 1);
    assert.equal(result[0].modelBreakdowns[0].totalTokens, 100);
  });
});
