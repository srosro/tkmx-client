const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { collectOutcomeStats } = require("../reporter/outcomes");

describe("collectOutcomeStats", () => {
  let tmpRepo;

  before(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-outcomes-"));
    execFileSync("git", ["init"], { cwd: tmpRepo });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpRepo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpRepo });
    fs.writeFileSync(path.join(tmpRepo, "file.txt"), "hello\nworld\n");
    execFileSync("git", ["add", "file.txt"], { cwd: tmpRepo });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: tmpRepo });
    fs.writeFileSync(path.join(tmpRepo, "file.txt"), "hello\nworld\nfoo\nbar\n");
    execFileSync("git", ["add", "file.txt"], { cwd: tmpRepo });
    execFileSync("git", ["commit", "-m", "add lines"], { cwd: tmpRepo });
  });

  after(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it("returns null for empty cwds", () => {
    assert.equal(collectOutcomeStats([], "20260101"), null);
  });

  it("returns null for non-existent directories", () => {
    assert.equal(collectOutcomeStats(["/tmp/nonexistent-xyzzy-12345"], "20260101"), null);
  });

  it("counts commits, LOC, and files from a real repo", () => {
    const result = collectOutcomeStats([tmpRepo], "20260101");
    assert.ok(result);
    assert.equal(result.repos_active, 1);
    assert.equal(result.commits, 2);
    assert.ok(result.loc_added >= 4); // "hello\nworld\n" + "foo\nbar\n"
    assert.ok(result.files_changed >= 1);
  });

  it("never includes repo names in output", () => {
    const result = collectOutcomeStats([tmpRepo], "20260101");
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(tmpRepo));
    assert.ok(!serialized.includes("file.txt"));
  });

  it("deduplicates repos from multiple cwds in same repo", () => {
    const subdir = path.join(tmpRepo, "sub");
    fs.mkdirSync(subdir, { recursive: true });
    const result = collectOutcomeStats([tmpRepo, subdir], "20260101");
    assert.equal(result.repos_active, 1);
  });
});
