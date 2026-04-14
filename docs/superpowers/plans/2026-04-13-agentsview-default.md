# Agentsview as Hard Dependency (v2.0.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship tkmx-client v2.0.0 with agentsview as a hard dependency for all Claude + Codex token collection — local and `EXTRA_CLAUDE_CONFIGS`. Delete ccusage from the codebase entirely, including the codex-sqlite reader. Tag the current `main` HEAD as `v1.2.0` so users who can't or don't want to install agentsview can pin to the last pre-breaking release with `git checkout v1.2.0`.

**Architecture:** Build on top of PR #11 (`feat/agentsview-collector`). Replace that PR's `USE_AGENTSVIEW=true` opt-in flag with a detection-driven hard dependency — `resolveAgentsview()` returns `string | null`, and missing → throw with a clear install-or-pin error message. Route `EXTRA_CLAUDE_CONFIGS` through agentsview by composing `AGENT_VIEWER_DATA_DIR` (per-config-dir isolation) + `CLAUDE_PROJECTS_DIR` (source path) per invocation, which agentsview already supports end-to-end (verified at `internal/parser/types.go:66`, `internal/config/config.go:466`, `internal/sync/engine.go:1051`, and `scripts/e2e-server.sh:43-45`). Each extra config dir gets its own `~/.agentsview-tkmx/<sha256-of-path>/sessions.db` for isolation + incremental sync. Delete `reporter/claude-collect.js` and `collectCodexUsage` from `reporter/codex.js`. Delete `docs/specs/agentsview-claude-home.md` — no upstream feature request needed.

**Tech Stack:** Node.js, `node:test` + `node:assert/strict`, `execFileSync`, launchd/systemd installers.

**Branch base:** `pr-11` (Wes's `feat/agentsview-collector`). We build on top of his PR rather than main; his three commits stay in the history.

**Branch name:** `srosro/agentsview-hard-dep`

**Version bump:** `1.2.0` → `2.0.0`. Semver major because users relying on ccusage will see a hard failure until they install agentsview or pin to `v1.2.0`.

**Server compat:** Verified. `tkmx-server/server/db.js:51,62,399,411` handles both `{totalTokens only}` and `{input/output/cw/cr split}` codex shapes via `totalTokens > 0 ? totalTokens : sum`, and codex `estimateCost` uses the blended-rate fallback regardless of split. No server work needed.

---

## File Structure

- **Modify** `package.json` — bump `version` from `1.2.0` to `2.0.0`.
- **Modify** `reporter/agentsview.js`:
  - `resolveAgentsview()` → `string | null` (drop bare `"agentsview"` fallback; compute candidates lazily so tests can swap `HOME`).
  - `collectAgentsviewUsage(bin, sinceStr, opts?)` where `opts` optionally carries `{ env }` — caller passes an object with `AGENT_VIEWER_DATA_DIR` + `CLAUDE_PROJECTS_DIR` for `EXTRA_CLAUDE_CONFIGS` invocations, or omits `opts` for the default local run.
  - Add `collectAgentsviewClaudeOnly(bin, sinceStr, env)` — thin helper that runs a single `--agent claude` call with the given env, for `EXTRA_CLAUDE_CONFIGS` paths (we don't need codex for remote dirs).
- **Modify** `reporter/report.js`:
  - Delete the `USE_AGENTSVIEW` env branch introduced by PR #11.
  - Delete `const CCUSAGE_CANDIDATES`, `const CCUSAGE`, the `CCUSAGE_TIMEOUT_MS` config.
  - Delete imports of `collectCodexUsage`, `collectCcusage`, `aggregateClaudeResults`.
  - Call `resolveAgentsview()` once at startup; hard-fail with a clear install/pin message if `null`.
  - For each `EXTRA_CLAUDE_CONFIGS` entry: derive `AGENT_VIEWER_DATA_DIR` (sha256 of abs path, rooted at `~/.agentsview-tkmx/<hash>`), derive `CLAUDE_PROJECTS_DIR` (absPath + `/projects`), validate the `projects/` subdir exists, invoke `collectAgentsviewClaudeOnly`. Concat daily arrays directly; `mergeDailyUsage` handles same-day deduping.
- **Delete** `reporter/claude-collect.js` — all ccusage wrapping.
- **Modify** `reporter/codex.js` — remove `collectCodexUsage`. Keep `collectCodexStats` and `getCodexDbPath` (`report.js:260` still uses them under `REPORT_DEV_STATS=true`).
- **Delete** `docs/specs/agentsview-claude-home.md` — upstream feature request is obsolete.
- **Modify** `.env.example` — remove the `USE_AGENTSVIEW` block (from PR #11) and the `CCUSAGE_TIMEOUT_MS` block.
- **Modify** `README.md`:
  - Quick Start uses agentsview only.
  - New "Upgrading from v1.x" section with `git checkout v1.2.0` escape hatch.
  - Drop the config-table row for `CCUSAGE_TIMEOUT_MS`.
  - Rewrite "How It Works" and the PR #11 "Agentsview collector" section to reflect the single-collector reality.
  - Update `EXTRA_CLAUDE_CONFIGS` section to explain the per-dir sqlite that gets created under `~/.agentsview-tkmx/`.
- **Modify** `test/agentsview.test.js` — add resolver-returns-null test; keep PR #11's parser tests unchanged.
- **Delete** `test/ccusage.test.js` if one exists for `claude-collect.js`; otherwise n/a.

---

## Task 0: Branch setup

**Files:** git state only.

- [ ] **Step 1: Confirm `pr-11` is present locally**

Run:
```bash
cd /Users/so/Hacking/tokenmaxxing/tkmx-client
git branch --list pr-11
```
Expected: `pr-11` listed. If missing, run `git fetch origin pull/11/head:pr-11`.

- [ ] **Step 2: Create the working branch off pr-11**

Run:
```bash
git checkout -b srosro/agentsview-hard-dep pr-11
git log --oneline -5
```
Expected: last three commits are Wes's (`docs: point install link…`, `docs: link agentsview website…`, `feat: add agentsview as opt-in local usage collector`).

- [ ] **Step 3: Confirm baseline tests pass on the new branch**

Run:
```bash
npm install && npm test
```
Expected: 74/74 pass (PR #11's 18 new tests + existing suites).

---

## Task 1: Tag `v1.2.0` on `main` — the escape hatch

Rationale: users who can't install agentsview need a pinnable ref for the last ccusage-based release. Tag it from `main` (not the feature branch) so anyone cloning can `git checkout v1.2.0` and get the exact current state.

**Files:** none; git ref only.

- [ ] **Step 1: Confirm main is at the intended "last pre-v2" commit**

Run:
```bash
git log main --oneline -1
```
Expected: prints the current `main` HEAD. Note the SHA. At plan write time this was `c86a21a docs: add HN verification spec and implementation plan`, but re-check — if `main` has moved, re-read the diff to make sure you're not tagging something unexpected.

- [ ] **Step 2: Confirm `package.json` on main still says `1.2.0`**

Run:
```bash
git show main:package.json | grep '"version"'
```
Expected: `"version": "1.2.0",`. If not, stop and sanity-check with the user before tagging — the version field drives the release semantics.

- [ ] **Step 3: Check whether `v1.2.0` tag already exists**

Run:
```bash
git tag --list 'v1.2.0' && git ls-remote --tags origin v1.2.0
```
If both are empty, the tag doesn't exist locally or remotely — proceed to Step 4. If it exists locally but not remotely, skip `git tag` in Step 4 and just push. If it exists on the remote, STOP — someone tagged it already; ask the user what to do.

- [ ] **Step 4: Create and push the tag**

Run:
```bash
git tag -a v1.2.0 main -m "tkmx-client v1.2.0 — last ccusage-based release

Pinned for users who prefer the ccusage + codex-sqlite flow and don't
want to install agentsview. v2.0.0 introduces agentsview as a hard
dependency."
git push origin v1.2.0
```
Expected: tag created and pushed. The push requires write access to `srosro/tkmx-client` — the user has it.

- [ ] **Step 5: Verify the tag is reachable**

Run:
```bash
git ls-remote --tags origin v1.2.0
```
Expected: one line, `<sha> refs/tags/v1.2.0`.

No commit in this task — the tag itself is the artifact. Return to the feature branch:

```bash
git checkout srosro/agentsview-hard-dep
```

---

## Task 2: Bump `package.json` to `2.0.0`

**Files:**
- Modify: `package.json:3` (the `version` field)

- [ ] **Step 1: Bump the version**

Edit `package.json`: change

```json
  "version": "1.2.0",
```

to

```json
  "version": "2.0.0",
```

- [ ] **Step 2: Run tests (lockfile unaffected, but confirm nothing regressed)**

Run:
```bash
npm test
```
Expected: 74/74 pass.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
chore: bump to 2.0.0 — agentsview hard dependency

Breaking: previously ccusage was the default Claude collector with
agentsview opt-in behind USE_AGENTSVIEW=true. Starting with 2.0.0
agentsview is required; users who prefer the ccusage flow can pin to
the v1.2.0 tag.
EOF
)"
```

---

## Task 3: `resolveAgentsview()` returns `null` on miss

Rationale: PR #11's resolver falls back to the bare string `"agentsview"` so `execFileSync` fails later with ENOENT. We need a clean `null` sentinel so `report.js` can hard-fail at startup with a useful message instead of a stack trace.

**Files:**
- Modify: `reporter/agentsview.js` — replace `AGENTSVIEW_CANDIDATES` const with `agentsviewCandidates()` function; change `resolveAgentsview()` fallback to `null`.
- Test: `test/agentsview.test.js` — add two resolver tests.

- [ ] **Step 1: Add the failing test**

Append to `test/agentsview.test.js`. Add these three imports near the existing `require` block if not already present:

```javascript
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
```

Then append this `describe` block at the bottom of the file:

```javascript
describe("resolveAgentsview", () => {
  it("returns null when no candidate path exists", () => {
    const origHome = process.env.HOME;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-resolve-"));
    process.env.HOME = tmp;
    try {
      const { resolveAgentsview } = require("../reporter/agentsview");
      assert.equal(resolveAgentsview(), null);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns the first existing candidate when one is present", () => {
    const origHome = process.env.HOME;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-resolve-"));
    fs.mkdirSync(path.join(tmp, ".local", "bin"), { recursive: true });
    const fake = path.join(tmp, ".local", "bin", "agentsview");
    fs.writeFileSync(fake, "#!/bin/sh\n");
    process.env.HOME = tmp;
    try {
      const { resolveAgentsview } = require("../reporter/agentsview");
      assert.equal(resolveAgentsview(), fake);
    } finally {
      process.env.HOME = origHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests — confirm the first new test fails**

Run:
```bash
npm test -- --test-name-pattern="returns null when no candidate"
```
Expected: FAIL — the current resolver returns `"agentsview"`, not `null`. Note: the `/opt/homebrew/bin/agentsview` and `/usr/local/bin/agentsview` candidates in the module live outside `HOME`, so overriding `HOME` alone isn't sufficient to make them miss. If the test passes on your machine because *none* of those paths exist, that's fine; if it fails because one of them exists, read the error carefully — it proves the resolver works for a present binary but our new test needs more isolation. In that case, add a check to skip the test if `/opt/homebrew/bin/agentsview` or `/usr/local/bin/agentsview` exists on the host, and note it in a comment.

- [ ] **Step 3: Update `resolveAgentsview()` and make candidates lazy**

Edit `reporter/agentsview.js`. Replace:

```javascript
// Resolve agentsview binary — launchd/systemd don't inherit user shell PATH.
const AGENTSVIEW_CANDIDATES = [
  `${process.env.HOME}/.local/bin/agentsview`,
  "/opt/homebrew/bin/agentsview",
  "/usr/local/bin/agentsview",
];

function resolveAgentsview() {
  return AGENTSVIEW_CANDIDATES.find((p) => fs.existsSync(p)) || "agentsview";
}
```

with:

```javascript
// Resolve agentsview binary — launchd/systemd don't inherit user shell PATH.
// Lazy so tests can swap HOME per-case.
function agentsviewCandidates() {
  return [
    `${process.env.HOME}/.local/bin/agentsview`,
    "/opt/homebrew/bin/agentsview",
    "/usr/local/bin/agentsview",
  ];
}

function resolveAgentsview() {
  return agentsviewCandidates().find((p) => fs.existsSync(p)) || null;
}
```

- [ ] **Step 4: Run the resolver tests**

Run:
```bash
npm test -- --test-name-pattern="resolveAgentsview"
```
Expected: both resolver tests PASS.

- [ ] **Step 5: Run the whole suite**

Run:
```bash
npm test
```
Expected: 76/76 pass (74 existing + 2 new resolver tests).

- [ ] **Step 6: Commit**

```bash
git add reporter/agentsview.js test/agentsview.test.js
git commit -m "$(cat <<'EOF'
refactor(agentsview): lazy candidates, null on miss

Let the resolver return null when no binary is found instead of a bare
\"agentsview\" string — unblocks a clear startup error in the next
commit. Candidates computed lazily so tests can swap HOME per case.
EOF
)"
```

---

## Task 4: Extend `collectAgentsviewUsage` for `EXTRA_CLAUDE_CONFIGS`

Rationale: the default local invocation runs two agents (claude + codex) against agentsview's default data dir. `EXTRA_CLAUDE_CONFIGS` entries need: (a) one `--agent claude` call per dir (no codex — the config is Claude-only), (b) an isolated `AGENT_VIEWER_DATA_DIR` so remote sync doesn't contaminate local state, (c) `CLAUDE_PROJECTS_DIR` pointing at the remote `.claude/projects`. Exposing an `env` override on the existing `queryAgent` lets us reuse the parsing path for both.

**Files:**
- Modify: `reporter/agentsview.js` — thread an optional `env` into `queryAgent`; add `collectAgentsviewClaudeOnly`.

- [ ] **Step 1: Thread `env` through `queryAgent`**

Edit `reporter/agentsview.js`. Replace:

```javascript
function queryAgent(bin, since, agent, noSync, timeoutMs) {
  const args = ["usage", "daily", "--json", "--breakdown", "--agent", agent, "--since", since];
  if (noSync) args.push("--no-sync");
  const raw = execFileSync(bin, args, { encoding: "utf-8", timeout: timeoutMs });
  return parseAgentsviewOutput(JSON.parse(raw), agent);
}
```

with:

```javascript
function queryAgent(bin, since, agent, noSync, timeoutMs, extraEnv) {
  const args = ["usage", "daily", "--json", "--breakdown", "--agent", agent, "--since", since];
  if (noSync) args.push("--no-sync");
  const execOpts = { encoding: "utf-8", timeout: timeoutMs };
  if (extraEnv) execOpts.env = { ...process.env, ...extraEnv };
  const raw = execFileSync(bin, args, execOpts);
  return parseAgentsviewOutput(JSON.parse(raw), agent);
}
```

- [ ] **Step 2: Add `collectAgentsviewClaudeOnly` as a new export**

Still in `reporter/agentsview.js`, add this function after `collectAgentsviewUsage`:

```javascript
// Single-agent (Claude) collection against an isolated agentsview data
// dir + projects dir. Used for EXTRA_CLAUDE_CONFIGS entries where we
// want per-remote-dir incremental sync without contaminating the local
// machine's ~/.agentsview/sessions.db.
function collectAgentsviewClaudeOnly(bin, sinceStr, env, timeoutMs = 180000) {
  const since = toIsoDate(sinceStr);
  return queryAgent(bin, since, "claude", false, timeoutMs, env);
}
```

Update the `module.exports` line:

```javascript
module.exports = {
  collectAgentsviewUsage,
  collectAgentsviewClaudeOnly,
  parseAgentsviewOutput,
  toIsoDate,
  resolveAgentsview,
};
```

- [ ] **Step 3: Run tests**

Run:
```bash
npm test
```
Expected: 76/76 still pass. Nothing tests `collectAgentsviewClaudeOnly` yet (it shells out), so this just confirms we didn't break the parser tests or the resolver tests.

- [ ] **Step 4: Commit**

```bash
git add reporter/agentsview.js
git commit -m "$(cat <<'EOF'
feat(agentsview): support per-invocation env override

Thread an optional env object into queryAgent and expose
collectAgentsviewClaudeOnly(bin, since, env) for callers that need to
run agentsview against an isolated AGENT_VIEWER_DATA_DIR +
CLAUDE_PROJECTS_DIR. Unblocks routing EXTRA_CLAUDE_CONFIGS through
agentsview in the next commit.
EOF
)"
```

---

## Task 5: Rewrite `report.js` — hard-dep + route `EXTRA_CLAUDE_CONFIGS` through agentsview

This is the core behavioral change. No ccusage. No opt-in flag. Missing agentsview → clear install-or-pin error. `EXTRA_CLAUDE_CONFIGS` goes through agentsview with per-dir isolated sqlite.

**Files:**
- Modify: `reporter/report.js`

- [ ] **Step 1: Update imports**

Edit `reporter/report.js`. Replace the block:

```javascript
const { collectCodexUsage, collectCodexStats } = require("./codex");
const { collectAgentsviewUsage } = require("./agentsview");
const { collectOpenAIUsage } = require("./openai");
const { mergeDailyUsage } = require("./merge");
const { parseExtraConfigs, aggregateClaudeResults, collectCcusage } = require("./claude-collect");
```

with:

```javascript
const { collectCodexStats } = require("./codex");
const {
  collectAgentsviewUsage,
  collectAgentsviewClaudeOnly,
  resolveAgentsview,
} = require("./agentsview");
const { collectOpenAIUsage } = require("./openai");
const { mergeDailyUsage } = require("./merge");
```

(Drops `collectCodexUsage`, `collectCcusage`, `aggregateClaudeResults`, and `parseExtraConfigs`. We'll reintroduce a minimal `parseExtraConfigs` inline in Step 3.)

- [ ] **Step 2: Delete ccusage resolution and the timeout config**

Delete the `CCUSAGE_CANDIDATES` and `CCUSAGE` block at `reporter/report.js:41-46`:

```javascript
// Resolve ccusage binary — launchd/systemd don't inherit the user's shell PATH
const CCUSAGE_CANDIDATES = [
  "/opt/homebrew/bin/ccusage",
  "/usr/local/bin/ccusage",
  `${process.env.HOME}/.npm-global/bin/ccusage`,
];
const CCUSAGE = CCUSAGE_CANDIDATES.find((p) => fs.existsSync(p)) || "ccusage";
```

And delete the `CCUSAGE_TIMEOUT_MS` read inside `main()`:

```javascript
  const CCUSAGE_TIMEOUT_MS = parseInt(process.env.CCUSAGE_TIMEOUT_MS) || 180000;
```

(also remove the comment above it about ccusage scanning JSONLs.)

- [ ] **Step 3: Add `parseExtraConfigs` + per-config-dir helpers inline**

Because we deleted `claude-collect.js`, reintroduce the bit we still need as private helpers in `report.js`. After the `CLIENT_ID` block (around line 92), add:

```javascript
function parseExtraConfigs(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Deterministic per-config-dir data directory so agentsview can
// maintain a separate incrementally-synced sqlite for each remote
// mirror without contaminating the local machine's
// ~/.agentsview/sessions.db. Keyed by sha256 of the absolute path so
// multiple tkmx-clients pointing at the same mirror share one db.
function agentsviewDataDirFor(absConfigDir) {
  const hash = crypto.createHash("sha256").update(absConfigDir).digest("hex").slice(0, 16);
  return path.join(os.homedir(), ".agentsview-tkmx", hash);
}
```

Note: `crypto`, `path`, `os` are already imported at the top of the file (`reporter/report.js:2-4`). If any are missing after Step 1, add them.

- [ ] **Step 4: Replace the Claude + codex collection block**

Locate the block starting with `// Collect Claude usage` (around `reporter/report.js:176` on the current pr-11 branch — it's the block introduced by PR #11 containing `useAgentsview`) and going through `const claudeResults = [localClaudeResult];` + the `for (const configDir of parseExtraConfigs(...))` loop + `aggregateClaudeResults` + `codexDaily = collectCodexUsage(sinceStr)`.

Replace that entire block with:

```javascript
  // Require agentsview — v2.0.0 dropped ccusage as a supported collector.
  // Users who want the old flow can pin to the v1.2.0 tag.
  const agentsviewBin = resolveAgentsview();
  if (!agentsviewBin) {
    console.error("");
    console.error("agentsview not found on PATH.");
    console.error("");
    console.error("tkmx-client v2.0.0 requires agentsview for local token usage collection.");
    console.error("Install: https://agentsview.io/quickstart/");
    console.error("");
    console.error("Prefer the previous ccusage-based flow? Pin to v1.2.0:");
    console.error("  cd tkmx-client && git checkout v1.2.0 && npm install");
    console.error("");
    process.exit(1);
  }
  console.log(`  Using agentsview at ${agentsviewBin}`);

  // Local machine: agentsview's default data dir + default claude/codex dirs.
  const { claudeDaily: localClaudeDaily, codexDaily } = collectAgentsviewUsage(
    agentsviewBin,
    sinceStr,
  );
  console.log(`  Claude (local): ${localClaudeDaily.length} days`);
  console.log(`  Codex (local): ${codexDaily.length} days`);

  // EXTRA_CLAUDE_CONFIGS: one agentsview invocation per remote dir, each
  // with its own AGENT_VIEWER_DATA_DIR so incremental sync stays partitioned.
  // CLAUDE_PROJECTS_DIR points at the .claude/projects subdir of each entry
  // (tkmx-client's EXTRA_CLAUDE_CONFIGS semantic is still ".claude" roots —
  // we append /projects internally to match agentsview's CLAUDE_PROJECTS_DIR
  // convention).
  let claudeDaily = [...localClaudeDaily];
  for (const entry of parseExtraConfigs(EXTRA_CLAUDE_CONFIGS)) {
    const absEntry = path.resolve(entry);
    const label = path.basename(absEntry) || absEntry;
    const projectsDir = path.join(absEntry, "projects");
    if (!fs.existsSync(projectsDir)) {
      console.error(`  Claude (${label}) skipped: missing projects/ subdir at ${absEntry}`);
      continue;
    }
    const dataDir = agentsviewDataDirFor(absEntry);
    fs.mkdirSync(dataDir, { recursive: true });
    const remoteDaily = collectAgentsviewClaudeOnly(agentsviewBin, sinceStr, {
      AGENT_VIEWER_DATA_DIR: dataDir,
      CLAUDE_PROJECTS_DIR: projectsDir,
    });
    console.log(`  Claude (${label}): ${remoteDaily.length} days`);
    claudeDaily = claudeDaily.concat(remoteDaily);
  }
```

A few things to note about this block:
- `claudeDaily` is the name `mergeDailyUsage` expects later in `main()`. Don't rename it.
- `codexDaily` also still needs to be defined when we reach `mergeDailyUsage(claudeDaily, codexDaily, openaiDaily)` — the destructure above handles that.
- We no longer call `aggregateClaudeResults` — the rationale that existed for it was "one collector failure shouldn't kill the run, but only if total-days == 0 AND ≥1 errored." That only made sense for `ccusage` which swallowed errors. Agentsview paths throw directly, so we just let them throw. That's fail-fast, consistent with the rest of the codebase.
- The `EXTRA_CLAUDE_CONFIGS` loop no longer needs `NODE_OPTIONS: "--max-old-space-size=8192"` — that was ccusage heap headroom for large JSONL walks. Agentsview reads an indexed sqlite and doesn't need it.

- [ ] **Step 5: Run tests**

Run:
```bash
npm test
```
Expected: 76/76 still pass. `report.js:main()` isn't unit-tested, so this just confirms the other modules still compile after our imports changed.

- [ ] **Step 6: Smoke test the happy path (only if agentsview is installed)**

Run:
```bash
which agentsview && npm run report
```
Expected: output begins with `Using agentsview at <path>`, then `Claude (local): N days` and `Codex (local): N days`, then posts to the server. If you have `EXTRA_CLAUDE_CONFIGS` set, you'll also see a line per remote config.

Watch for the per-dir data dir being created:

```bash
ls ~/.agentsview-tkmx/ 2>/dev/null
```
Expected: one directory per `EXTRA_CLAUDE_CONFIGS` entry (if any). On first run each one does a full sync; subsequent runs are incremental.

- [ ] **Step 7: Smoke test the hard-fail path**

Run:
```bash
HOME=/tmp/empty-home-$$ PATH=/usr/bin:/bin npm run report
```
Expected: exit 1 with the install-or-pin message (`tkmx-client v2.0.0 requires agentsview…`). If your `/opt/homebrew/bin/agentsview` or `/usr/local/bin/agentsview` exists, the test won't miss (the resolver finds it regardless of HOME/PATH) — in that case, temporarily move or rename the binary to exercise the miss path, or trust the resolver unit test and skip this step.

- [ ] **Step 8: Commit**

```bash
git add reporter/report.js
git commit -m "$(cat <<'EOF'
feat(reporter)!: agentsview as hard dependency

Replace the USE_AGENTSVIEW=true opt-in flag with detection-driven
requirement: agentsview missing is a fatal startup error with a clear
install-or-pin message. Route EXTRA_CLAUDE_CONFIGS through agentsview
via per-config-dir AGENT_VIEWER_DATA_DIR + CLAUDE_PROJECTS_DIR
overrides, so each remote mirror gets its own incrementally-synced
sqlite under ~/.agentsview-tkmx/<hash>/. Remote config semantic is
still ".claude" roots; we append /projects internally.

BREAKING: users who can't or don't want to install agentsview must
pin to the v1.2.0 tag (git checkout v1.2.0 && npm install).
EOF
)"
```

---

## Task 6: Delete `reporter/claude-collect.js`

**Files:**
- Delete: `reporter/claude-collect.js`

- [ ] **Step 1: Verify no remaining imports**

Run:
```bash
grep -rn "claude-collect" reporter/ test/ 2>/dev/null
```
Expected: no matches. If any, find and remove them before deleting the file.

- [ ] **Step 2: Delete the file**

Run:
```bash
git rm reporter/claude-collect.js
```

- [ ] **Step 3: Run tests**

Run:
```bash
npm test
```
Expected: 76/76 pass. (No test in PR #11 imports `claude-collect.js`.)

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(reporter): delete claude-collect.js

Agentsview replaces ccusage for both local and EXTRA_CLAUDE_CONFIGS
paths as of v2.0.0. No remaining callers.
EOF
)"
```

---

## Task 7: Strip `collectCodexUsage` from `reporter/codex.js`

Rationale: agentsview now handles codex usage. `collectCodexStats` + `getCodexDbPath` stay because `report.js:260` still reads the codex sqlite directly under `REPORT_DEV_STATS=true` — that's per-session duration/avg-tokens data, not per-day token totals, and agentsview doesn't expose an equivalent.

**Files:**
- Modify: `reporter/codex.js` — remove the `collectCodexUsage` function and drop it from `module.exports`.

- [ ] **Step 1: Verify no remaining callers**

Run:
```bash
grep -rn "collectCodexUsage" reporter/ test/ 2>/dev/null
```
Expected: only a match inside `reporter/codex.js` (the definition itself). If `report.js` or a test still references it, go back to Task 5 and finish.

- [ ] **Step 2: Delete `collectCodexUsage` from `reporter/codex.js`**

Edit `reporter/codex.js`. Delete the `collectCodexUsage` function (lines 20-74 on the current branch). Update the `module.exports` to remove `collectCodexUsage`:

Before:
```javascript
module.exports = { collectCodexUsage, collectCodexStats, getCodexDbPath };
```

After:
```javascript
module.exports = { collectCodexStats, getCodexDbPath };
```

The `Database` import is still used by `collectCodexStats`. Leave `const Database = require("better-sqlite3");` in place.

- [ ] **Step 3: Run tests**

Run:
```bash
npm test
```
Expected: 76/76 pass.

- [ ] **Step 4: Commit**

```bash
git add reporter/codex.js
git commit -m "$(cat <<'EOF'
refactor(codex): drop collectCodexUsage, keep stats helpers

Daily codex token collection now goes through agentsview. The codex
sqlite reader is still needed for per-session stats (collectCodexStats)
under REPORT_DEV_STATS=true — agentsview has no equivalent view of
duration/avg-tokens per session.
EOF
)"
```

---

## Task 8: Purge `USE_AGENTSVIEW` and `CCUSAGE_TIMEOUT_MS` from `.env.example`

**Files:**
- Modify: `.env.example` — delete two blocks.

- [ ] **Step 1: Delete the `USE_AGENTSVIEW` block**

Open `.env.example` and remove the 9-line block starting with `# Use \`agentsview usage daily\`` and ending with `# USE_AGENTSVIEW=true` (added by PR #11, around lines 39-47).

- [ ] **Step 2: Delete the `CCUSAGE_TIMEOUT_MS` block**

In the same file, remove the 3-line block:

```
# Timeout in milliseconds for each ccusage invocation (default: 180000 = 3 min).
# Bump this if you have a large ~/.claude/projects tree and see "ccusage ETIMEDOUT".
# CCUSAGE_TIMEOUT_MS=300000
```

- [ ] **Step 3: Verify `EXTRA_CLAUDE_CONFIGS` entry still exists and still makes sense**

Look for the `EXTRA_CLAUDE_CONFIGS` comment block in `.env.example` (it existed pre-PR-#11). The semantic hasn't changed — users still point at `.claude` root paths — so the comment block should still be accurate. If it specifically mentions ccusage, loosen that language to "the reporter" (single-line edit). Otherwise leave it alone.

- [ ] **Step 4: Check the whole diff before committing**

Run:
```bash
git diff .env.example
```
Expected: two deletion blocks, maybe one tiny wording tweak to EXTRA_CLAUDE_CONFIGS. No additions.

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "docs(env): drop USE_AGENTSVIEW and CCUSAGE_TIMEOUT_MS"
```

---

## Task 9: Rewrite `README.md` for the single-install story

**Files:**
- Modify: `README.md` — Quick Start, dependencies section, config table, Agentsview collector section, How It Works, plus a new "Upgrading from v1.x" block.

- [ ] **Step 1: Rewrite the Quick Start code block**

Locate the Quick Start at `README.md:7-14`:

```bash
npm install -g ccusage            # Claude Code usage reader
git clone git@github.com:srosro/tkmx-client.git
cd tkmx-client && npm install
cp .env.example .env              # then edit .env (see below)
npm run report                    # test it
npm run install-service           # auto-report every 2 hours
```

Replace with:

```bash
# Install agentsview (required). See https://agentsview.io/quickstart/ for
# platform-specific install; the canonical one-liner is:
curl -fsSL https://agentsview.io/install.sh | bash

git clone git@github.com:srosro/tkmx-client.git
cd tkmx-client && npm install
cp .env.example .env              # then edit .env (see below)
npm run report                    # test it
npm run install-service           # auto-report every 2 hours
```

**Verify the agentsview install one-liner is correct** before committing — check `https://agentsview.io/quickstart/` to confirm the canonical command. Don't ship a wrong curl URL.

- [ ] **Step 2: Rewrite "### 1. Install dependencies" section**

Replace the section body (lines 18-24 on current branch) with:

```markdown
### 1. Install dependencies

[agentsview](https://www.agentsview.io/token-usage/) is required — it reads your local Claude Code and Codex usage data from an incrementally-synced SQLite index, which is dramatically faster than walking every JSONL transcript. See https://agentsview.io/quickstart/ for install instructions. Codex CLI usage is auto-detected from `~/.codex/` — no extra setup beyond agentsview.

> **Previously using ccusage?** v1.x of this client used `ccusage`. If you prefer the old flow and don't want to install agentsview, pin to the v1.2.0 tag:
>
> ```bash
> cd tkmx-client
> git checkout v1.2.0
> npm install
> ```
>
> See [Upgrading from v1.x](#upgrading-from-v1x) for details.
```

- [ ] **Step 3: Add a new "Upgrading from v1.x" section**

Add this section right after the current "Updating" section (around `README.md:105-113`):

```markdown
## Upgrading from v1.x

v2.0.0 replaces `ccusage` + the direct codex sqlite reader with [agentsview](https://www.agentsview.io/token-usage/) for all local Claude and Codex token collection. `EXTRA_CLAUDE_CONFIGS` — the feature for aggregating usage from synced remote `~/.claude` directories — also goes through agentsview (it creates a per-config-dir sqlite under `~/.agentsview-tkmx/<hash>/` for isolated incremental sync).

**If you can install agentsview:** `git pull`, install agentsview, run `npm run report`. That's it — existing `.env` settings are unchanged. The `USE_AGENTSVIEW` flag and `CCUSAGE_TIMEOUT_MS` are gone (delete them from your `.env` if present — they're ignored).

**If you can't or don't want to install agentsview:** pin to the last ccusage-based release. This is a real-working-version, not a frozen snapshot — it will stay reachable:

```bash
cd tkmx-client
git checkout v1.2.0
npm install
npm run report
```

You lose access to future improvements, but the v1.2.0 flow (ccusage + codex sqlite) continues to work against the server.
```

- [ ] **Step 4: Drop the `CCUSAGE_TIMEOUT_MS` row from the config table**

Find the table row starting with `| \`CCUSAGE_TIMEOUT_MS\` |` (around `README.md:68`) and delete the entire row. Similarly drop the `USE_AGENTSVIEW` row introduced by PR #11 (around `README.md:69`).

- [ ] **Step 5: Rewrite the PR #11 "Agentsview collector" section**

Locate the section PR #11 added (around `README.md:276-284`). Replace it with a "How It Works" rewrite that covers the single collector:

```markdown
## How It Works

[`agentsview`](https://www.agentsview.io/token-usage/) is the required local usage collector. It maintains its own sqlite database synced from `~/.claude` and `~/.codex`, and the reporter queries it via `agentsview usage daily --json --breakdown --agent <claude|codex>`. On large histories this is dramatically faster than walking every JSONL transcript — the sync is incremental and queries hit an indexed database.

When `EXTRA_CLAUDE_CONFIGS` is set, the reporter runs one agentsview invocation per remote dir, each with its own `AGENT_VIEWER_DATA_DIR` (under `~/.agentsview-tkmx/<hash>/`) and `CLAUDE_PROJECTS_DIR` (pointing at the remote `.claude/projects`). This keeps each remote mirror in its own isolated sqlite — incremental sync works per-dir and the local machine's `~/.agentsview/sessions.db` stays clean.

The reporter merges Claude + Codex daily usage client-side and POSTs it to the Tokenmaxxing server. Each report replaces previous data for the same machine and date range, so re-syncs are safe and idempotent.
```

Delete the original "How It Works" section (around lines 278-285) if it wasn't already the block you just replaced.

- [ ] **Step 6: Update "Aggregating from synced remote machines" section**

Find the `### Aggregating from synced remote machines` subsection (around `README.md:153-160`). The current wording says:

> The reporter runs `ccusage` once per directory (using `CLAUDE_CONFIG_DIR`) and merges the results with the local machine's usage before submitting.

Replace with:

> The reporter runs `agentsview` once per directory (each with its own `AGENT_VIEWER_DATA_DIR` under `~/.agentsview-tkmx/<hash>/` and `CLAUDE_PROJECTS_DIR` pointing at `<dir>/projects`) and merges the results with the local machine's usage before submitting. Each remote mirror gets its own incrementally-synced sqlite, so re-runs are cheap.

- [ ] **Step 7: Review the rendered diff**

Run:
```bash
git diff README.md | head -200
```
Expected: coherent doc changes, no merge-conflict markers, no duplicate sections. Skim it once end-to-end.

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): single-install story + v1.2.0 escape hatch

Quick Start installs agentsview only. New "Upgrading from v1.x" section
explains the breaking change and points users to git checkout v1.2.0
if they can't or don't want to install agentsview. Drop ccusage from
"How It Works" and the EXTRA_CLAUDE_CONFIGS aggregation blurb.
EOF
)"
```

---

## Task 10: Delete the obsolete agentsview feature-request spec

Rationale: the earlier plan generated `docs/specs/agentsview-claude-home.md` as a feature request to send to @wesm. We verified agentsview already supports everything we need via `CLAUDE_PROJECTS_DIR` + `AGENT_VIEWER_DATA_DIR`, so the spec is obsolete.

**Files:**
- Delete: `docs/specs/agentsview-claude-home.md`

- [ ] **Step 1: Delete the spec file**

Run:
```bash
git rm docs/specs/agentsview-claude-home.md
```

If the `docs/specs/` directory is now empty, leave it alone — git doesn't track empty directories, and we may add specs later. No need to `rmdir`.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: remove obsolete agentsview feature-request spec

Agentsview already supports CLAUDE_PROJECTS_DIR + AGENT_VIEWER_DATA_DIR
end-to-end (verified in internal/parser/types.go, config.go, and
scripts/e2e-server.sh). No upstream PR needed — the feature we were
going to ask for is already shipped.
EOF
)"
```

---

## Task 11: Final test + smoke pass

- [ ] **Step 1: Full test suite**

Run:
```bash
npm test
```
Expected: 76/76 pass.

- [ ] **Step 2: `git log` sanity check**

Run:
```bash
git log --oneline pr-11..srosro/agentsview-hard-dep
git diff pr-11...srosro/agentsview-hard-dep --stat
```
Expected: 10 commits (Tasks 2-10), concentrated in `reporter/`, `README.md`, `.env.example`, and `package.json`. No surprise files.

- [ ] **Step 3: Diff against main**

Run:
```bash
git diff main...srosro/agentsview-hard-dep --stat
```
Expected: the 10 commits above *plus* PR #11's 3 commits. The total file set should be small and coherent.

- [ ] **Step 4: Confirm `claude-collect.js` really is gone and imports are clean**

Run:
```bash
grep -rn "claude-collect\|USE_AGENTSVIEW\|CCUSAGE_TIMEOUT_MS\|collectCcusage\|collectCodexUsage\|aggregateClaudeResults" reporter/ test/ 2>/dev/null
```
Expected: no matches.

- [ ] **Step 5: Confirm `package.json` is at 2.0.0**

Run:
```bash
grep '"version"' package.json
```
Expected: `"version": "2.0.0",`.

- [ ] **Step 6: Confirm `v1.2.0` tag is pushed**

Run:
```bash
git ls-remote --tags origin v1.2.0
```
Expected: one line, `<sha> refs/tags/v1.2.0`.

---

## Task 12: Push branch + open PR (user approval required)

- [ ] **Step 1: Ask the user before pushing**

Don't push silently. Report the branch state and ask:

> Branch `srosro/agentsview-hard-dep` is ready locally. 10 new commits on top of PR #11, all tests passing, `v1.2.0` tag already pushed. Want me to `git push -u origin srosro/agentsview-hard-dep` and open it as a PR against `main`?

- [ ] **Step 2: On approval, push and open the PR**

```bash
git push -u origin srosro/agentsview-hard-dep
gh pr create --title "feat!: agentsview as hard dependency (v2.0.0)" --body "$(cat <<'EOF'
## Summary

Builds on #11. Ships tkmx-client v2.0.0 with agentsview as a hard
dependency for all local Claude + Codex token collection, including
`EXTRA_CLAUDE_CONFIGS`. Deletes `ccusage` support entirely. Users who
prefer the old flow can `git checkout v1.2.0` — that tag is now pushed
and represents the last ccusage-based release.

## Why

- Agentsview is dramatically faster on large histories (~200×) and provides a richer codex breakdown than the direct sqlite reader could.
- Pre-launch is the right window to pick the single best default and commit to it. Maintaining two collectors forever is dead weight.
- The server already handles agentsview's richer codex shape (`server/db.js:51,62,399,411` — `totalTokens > 0 ? totalTokens : sum` fallbacks, blended-rate codex cost).
- `EXTRA_CLAUDE_CONFIGS` routes through agentsview via per-remote-dir `AGENT_VIEWER_DATA_DIR` + `CLAUDE_PROJECTS_DIR` overrides. Each remote mirror gets its own incrementally-synced sqlite under `~/.agentsview-tkmx/<hash>/`. Verified agentsview supports this shape end-to-end (`internal/parser/types.go`, `internal/config/config.go:466`, `internal/sync/engine.go:1051`, `scripts/e2e-server.sh:43-45`).

## Breaking changes

- `ccusage` is no longer used or recommended. Missing `agentsview` is a fatal startup error with a clear install-or-pin message.
- `USE_AGENTSVIEW` and `CCUSAGE_TIMEOUT_MS` env vars are removed. They're ignored if present in `.env`.
- `reporter/claude-collect.js` is deleted. `collectCodexUsage` is removed from `reporter/codex.js` (the stats helpers used by `REPORT_DEV_STATS=true` are preserved).

## Escape hatch

```bash
cd tkmx-client
git checkout v1.2.0
npm install
```

This pins to the last ccusage-based release. The v1.2.0 flow continues to work against the server.

## Test plan

- [x] `npm test` — 76/76 pass (74 original + 2 new resolver tests)
- [ ] Smoke test with agentsview installed: `npm run report` shows `Using agentsview at <path>` and non-zero Claude + Codex days
- [ ] Smoke test without agentsview (rename binary temporarily): `npm run report` exits 1 with the install-or-pin message
- [ ] Smoke test with `EXTRA_CLAUDE_CONFIGS` set: one line per remote dir, `~/.agentsview-tkmx/<hash>/` created per entry, re-run is incremental (fast)
- [ ] Run `npm run install-service` and confirm launchd picks up the new `report.js`
EOF
)"
```

- [ ] **Step 3: Report the PR URL back**

After `gh pr create` returns, print the URL to the user.

---

## Self-Review

**Spec coverage:**
- ✅ Bump client version → Task 2 (1.2.0 → 2.0.0)
- ✅ Agentsview as hard dependency → Task 5 (startup hard-fail, no fallback)
- ✅ Commit hash / pinnable ref for prior version → Task 1 (v1.2.0 tag pushed to origin, referenced in README Upgrading section and in the startup error message)
- ✅ `EXTRA_CLAUDE_CONFIGS` routed through agentsview → Task 5 Step 4
- ✅ Remove ccusage entirely → Task 6 (claude-collect.js deleted) + Task 7 (collectCodexUsage deleted)
- ✅ Delete obsolete agentsview feature-request spec → Task 10

**Placeholder scan:**
- One explicit placeholder called out at Task 9 Step 1: the agentsview install one-liner (`curl | bash`) must be verified against https://agentsview.io/quickstart/ before committing. Flagged inline so it's not missed.
- No TBDs, TODOs, or "similar to above" deferrals elsewhere.

**Type consistency:**
- `resolveAgentsview(): string | null` — consistent across Tasks 3 and 5.
- `collectAgentsviewUsage(bin, sinceStr)` — unchanged signature (Task 5 calls it for local).
- `collectAgentsviewClaudeOnly(bin, sinceStr, env, timeoutMs?)` — introduced in Task 4, called in Task 5 Step 4. Signature matches at both sites.
- `claudeDaily` / `codexDaily` names preserved so the existing `mergeDailyUsage(claudeDaily, codexDaily, openaiDaily)` call at the bottom of `main()` keeps working.

**Escape hatch sanity check:**
- `v1.2.0` tag is pushed to `origin` before `main` is touched by this branch (Task 1 runs before any code changes).
- README Upgrading section and the startup error message both reference the exact command (`git checkout v1.2.0 && npm install`).
- The tag points at `main` HEAD as of plan-write time; the intent is "last pre-v2 working state", not a frozen snapshot of any particular file.

**Branch hygiene:** commits are scoped (chore → refactor → feat → refactor → refactor → docs → docs → docs → tests), independently revertable, and the `feat!:` marker on the core commit flags the breaking change in the log.
