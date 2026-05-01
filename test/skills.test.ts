import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { collectClaudeSkills } from "../reporter/skills";

describe("collectClaudeSkills", () => {
  let tmpDir;
  let manifestPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-skills-"));
    manifestPath = path.join(tmpDir, "installed_plugins.json");
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
  });

  it("returns [] when the manifest file is missing", () => {
    assert.deepEqual(collectClaudeSkills(manifestPath), []);
  });

  it("returns [] when the manifest is malformed JSON", () => {
    fs.writeFileSync(manifestPath, "{ not valid json");
    assert.deepEqual(collectClaudeSkills(manifestPath), []);
  });

  it("returns [] when the manifest has no plugins field", () => {
    fs.writeFileSync(manifestPath, JSON.stringify({}));
    assert.deepEqual(collectClaudeSkills(manifestPath), []);
  });

  it("extracts plugin names and strips the @marketplace suffix", () => {
    fs.writeFileSync(manifestPath, JSON.stringify({
      plugins: {
        "superpowers@claude-plugins-official": {},
        "swift-lsp@claude-plugins-official": {},
      },
    }));
    assert.deepEqual(collectClaudeSkills(manifestPath), ["superpowers", "swift-lsp"]);
  });

  it("returns results sorted alphabetically for a stable config hash", () => {
    fs.writeFileSync(manifestPath, JSON.stringify({
      plugins: {
        "zebra@marketplace": {},
        "alpha@marketplace": {},
        "mango@marketplace": {},
      },
    }));
    assert.deepEqual(collectClaudeSkills(manifestPath), ["alpha", "mango", "zebra"]);
  });

  it("deduplicates plugins with the same name from different marketplaces", () => {
    fs.writeFileSync(manifestPath, JSON.stringify({
      plugins: {
        "superpowers@official": {},
        "superpowers@fork": {},
      },
    }));
    assert.deepEqual(collectClaudeSkills(manifestPath), ["superpowers"]);
  });
});
