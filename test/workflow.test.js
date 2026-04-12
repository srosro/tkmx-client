const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { parseSessionFile } = require("../reporter/workflow");

function makeAssistantLine(tools, usage = {}, opts = {}) {
  const content = tools.map((name) => ({ type: "tool_use", id: "t1", name, input: {} }));
  return JSON.stringify({
    type: "assistant",
    uuid: "u1",
    timestamp: opts.timestamp || "2026-04-10T12:00:00.000Z",
    sessionId: "s1",
    cwd: opts.cwd || "/tmp/test-repo",
    message: {
      model: "claude-opus-4-6",
      role: "assistant",
      content,
      usage: {
        input_tokens: usage.input || 0,
        cache_read_input_tokens: usage.cache_read || 0,
        cache_creation_input_tokens: usage.cache_create || 0,
        output_tokens: usage.output || 0,
      },
    },
  });
}

function makeUserLine(timestamp) {
  return JSON.stringify({
    type: "user",
    timestamp: timestamp || "2026-04-10T12:00:00.000Z",
    message: { role: "user", content: "test" },
  });
}

describe("parseSessionFile", () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-workflow-"));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("counts tool calls by name", async () => {
    const file = path.join(tmpDir, "tools.jsonl");
    fs.writeFileSync(file, [
      makeAssistantLine(["Bash"]),
      makeAssistantLine(["Read"]),
      makeAssistantLine(["Bash"]),
      makeAssistantLine(["Edit"]),
    ].join("\n"));

    const stats = await parseSessionFile(file);
    assert.equal(stats.toolCalls.Bash, 2);
    assert.equal(stats.toolCalls.Read, 1);
    assert.equal(stats.toolCalls.Edit, 1);
    assert.equal(stats.assistantTurns, 4);
  });

  it("tracks tools per turn for parallelism metric", async () => {
    const file = path.join(tmpDir, "parallel.jsonl");
    fs.writeFileSync(file, [
      makeAssistantLine(["Bash", "Read", "Grep"]),
      makeAssistantLine(["Edit"]),
      makeAssistantLine([]),  // no tools
    ].join("\n"));

    const stats = await parseSessionFile(file);
    assert.deepEqual(stats.toolTurnsToolCounts, [3, 1]);
    assert.equal(stats.assistantTurns, 3);
  });

  it("accumulates cache and token usage", async () => {
    const file = path.join(tmpDir, "cache.jsonl");
    fs.writeFileSync(file, [
      makeAssistantLine(["Bash"], { input: 10, cache_read: 5000, cache_create: 1000, output: 200 }),
      makeAssistantLine(["Read"], { input: 5, cache_read: 4000, cache_create: 500, output: 150 }),
    ].join("\n"));

    const stats = await parseSessionFile(file);
    assert.equal(stats.inputTokens, 15);
    assert.equal(stats.cacheRead, 9000);
    assert.equal(stats.cacheCreation, 1500);
    assert.equal(stats.outputTokens, 350);
  });

  it("collects cwds without leaking them as tool args", async () => {
    const file = path.join(tmpDir, "cwds.jsonl");
    fs.writeFileSync(file, [
      makeAssistantLine(["Bash"], {}, { cwd: "/home/user/secret-project" }),
      makeAssistantLine(["Read"], {}, { cwd: "/home/user/other-project" }),
      makeAssistantLine(["Edit"], {}, { cwd: "/home/user/secret-project" }),
    ].join("\n"));

    const stats = await parseSessionFile(file);
    assert.equal(stats.cwds.size, 2);
    assert.ok(stats.cwds.has("/home/user/secret-project"));
    assert.ok(stats.cwds.has("/home/user/other-project"));
  });

  it("computes session timestamps from all messages", async () => {
    const file = path.join(tmpDir, "timestamps.jsonl");
    fs.writeFileSync(file, [
      makeUserLine("2026-04-10T10:00:00.000Z"),
      makeAssistantLine(["Bash"], {}, { timestamp: "2026-04-10T10:05:00.000Z" }),
      makeUserLine("2026-04-10T10:30:00.000Z"),
      makeAssistantLine(["Read"], {}, { timestamp: "2026-04-10T10:35:00.000Z" }),
    ].join("\n"));

    const stats = await parseSessionFile(file);
    assert.equal(stats.timestamps.length, 4);
  });

  it("handles malformed lines gracefully", async () => {
    const file = path.join(tmpDir, "malformed.jsonl");
    fs.writeFileSync(file, [
      "not json at all",
      makeAssistantLine(["Bash"]),
      '{"type":"assistant"}', // missing message
    ].join("\n"));

    const stats = await parseSessionFile(file);
    assert.equal(stats.toolCalls.Bash, 1);
    assert.equal(stats.assistantTurns, 2);
  });

  it("never includes file paths or prompt content in output", async () => {
    const file = path.join(tmpDir, "privacy.jsonl");
    fs.writeFileSync(file, [
      makeAssistantLine(["Bash"], {}, { cwd: "/Users/secret/project" }),
    ].join("\n"));

    const stats = await parseSessionFile(file);
    // The stats object should contain tool names and counts, not paths
    const serialized = JSON.stringify(stats.toolCalls);
    assert.ok(!serialized.includes("/Users/secret"));
    assert.ok(!serialized.includes("project"));
    // cwds are collected separately for outcomes, not in the reported stats
    assert.equal(typeof stats.toolCalls, "object");
    assert.equal(stats.toolCalls.Bash, 1);
  });
});
