# Feature request: point `agentsview` at an alternate Claude config dir

**Status:** request
**Asking of:** [@wesm](https://github.com/wesm) / [agentsview](https://github.com/wesm/agentsview)
**Asking on behalf of:** [tkmx-client](https://github.com/srosro/tkmx-client) (following up on [PR #11](https://github.com/srosro/tkmx-client/pull/11))
**TL;DR:** Let `agentsview usage daily` read a Claude config directory other than `~/.claude`, the same way `ccusage` does via its `CLAUDE_CONFIG_DIR` env var. This unblocks tkmx-client dropping ccusage as a hard dependency entirely.

---

## Context

[tkmx-client](https://github.com/srosro/tkmx-client) is a small Node CLI that collects local Claude Code + Codex token usage and POSTs a daily rollup to the Tokenmaxxing leaderboard. Historically it shelled out to `ccusage` for the Claude side and read `~/.codex/state_*.sqlite` directly for the Codex side.

[Wes's PR #11](https://github.com/srosro/tkmx-client/pull/11) added `agentsview` as an opt-in collector and showed a ~200× speedup on large session histories — a big enough win that we want to make agentsview the *default* collector and drop ccusage entirely. We've verified the server side handles agentsview's richer Codex breakdown ([server/db.js:51,62,399,411](https://github.com/srosro/tkmx-server/blob/main/server/db.js) — `totalTokens > 0 ? totalTokens : input+output+cw+cr` fallbacks and blended-rate codex cost estimation are already in place).

There is exactly **one** thing blocking that switch.

## The gap

tkmx-client supports an opt-in env var called `EXTRA_CLAUDE_CONFIGS`:

```bash
EXTRA_CLAUDE_CONFIGS=/Volumes/sync/laptop,/Volumes/sync/desktop
```

Each entry points at a directory that mirrors the shape of `~/.claude` — i.e. contains a `projects/` subdirectory of Claude Code JSONL transcripts. It's used by people who rsync / Syncthing / otherwise mirror `~/.claude` from several machines to a central spot, so a single tkmx-client install can report usage for all of them without having to run on each box. (See the [Aggregating from synced remote machines](https://github.com/srosro/tkmx-client#aggregating-from-synced-remote-machines) section of the README.)

Today this is implemented by running `ccusage` once per config dir with `CLAUDE_CONFIG_DIR=<path>` in the env. `ccusage` walks the JSONL transcripts rooted at that path instead of `~/.claude`, and emits the same daily breakdown output.

**agentsview has no equivalent.** It reads `~/.claude` and `~/.codex` directly, so we can't point it at a synced mirror. That means if we drop ccusage, anyone using `EXTRA_CLAUDE_CONFIGS` loses the ability to aggregate across machines.

Three workarounds we considered and rejected:

1. **`HOME` override hack** — run `HOME=/tmp/fake agentsview ...` with a symlinked `.claude`. Probably works, but agentsview's persistent sqlite would be rebuilt per fake-HOME on every run, killing the speed benefit that motivated the switch in the first place.
2. **Reimplement the JSONL walker in tkmx-client** — feasible (~200–500 LOC) but duplicates work agentsview already does, including the non-trivial message-ID dedup logic for session resumes, and takes on ongoing maintenance for Claude Code's evolving transcript format.
3. **Keep ccusage gated behind `EXTRA_CLAUDE_CONFIGS`** — the current plan, but it means we ship a second hard dep just for a power-user feature.

None of these are great. The cleanest path is for agentsview to grow first-class support for alternate Claude (and ideally Codex) home directories.

## Proposed interface

We only need the Claude side for tkmx-client's immediate use case, but parity with `CODEX_HOME` would be a nice symmetry.

### Option A (preferred): env-var parity with ccusage / Claude Code

Respect `CLAUDE_CONFIG_DIR` (and `CODEX_HOME`) when set, exactly the way ccusage and Claude Code do:

```bash
CLAUDE_CONFIG_DIR=/Volumes/sync/laptop \
  agentsview usage daily --json --breakdown --agent claude --since 2026-03-15
```

Semantics:
- If the env var is unset, behavior is unchanged (reads `~/.claude`).
- If set, agentsview reads transcripts rooted at that path. Everything else — `--since`, `--agent`, `--json`, `--breakdown` — behaves identically.
- Same for `CODEX_HOME` if you want to support it (tkmx-client won't hit this path in the near term, but it's nice to have).

Why this is preferred: zero flag surface, drop-in compatible with the env var Claude Code itself uses, and tkmx-client can swap `ccusage` for `agentsview` as a one-line change per invocation — same env, different binary.

### Option B: explicit flag

```bash
agentsview usage daily --claude-home /Volumes/sync/laptop --agent claude --since 2026-03-15
```

Equivalent semantics, just flag-driven. Fine if you'd rather keep the CLI self-documenting and avoid magical env-var behavior. Both options also compose — flag overrides env, env overrides default.

### Question: sqlite state location

Agentsview maintains its own incrementally-synced sqlite, and that's the whole source of its speedup. For an alternate Claude config dir, there are two reasonable choices:

1. **Per-config-dir sqlite.** Key the state file by the resolved path (e.g. hash of the absolute path, or `~/.agentsview/state-<hash>.sqlite`). Incremental sync works correctly because each remote dir has its own state. Downside: first run per remote dir pays a full-sync cost.
2. **Shared sqlite, multi-tenant schema.** Add a `source_path` column and keep everything in one DB. More flexible, more invasive.

(1) is almost certainly what we want for tkmx-client: remote dirs only get queried during batch reports (every 2 hours), incremental sync per dir is fine, and the data stays neatly partitioned. (2) is overkill for this use case.

We don't need any changes to tkmx-client's invocation pattern as long as repeated runs against the same `CLAUDE_CONFIG_DIR` hit the same cached sqlite.

### What tkmx-client would do with this

Today ([report.js:181–198](https://github.com/srosro/tkmx-client/blob/main/reporter/report.js#L181)):

```js
const claudeResults = [collectCcusage(CCUSAGE, sinceStr, "local", {}, CCUSAGE_TIMEOUT_MS)];
for (const configDir of parseExtraConfigs(EXTRA_CLAUDE_CONFIGS)) {
  claudeResults.push(
    collectCcusage(CCUSAGE, sinceStr, label, { CLAUDE_CONFIG_DIR: configDir, ... }, ...)
  );
}
```

After this feature lands:

```js
const { claudeDaily: localClaude, codexDaily } = collectAgentsviewUsage(bin, sinceStr);
const claudeResults = [{ daily: localClaude, err: null }];
for (const configDir of parseExtraConfigs(EXTRA_CLAUDE_CONFIGS)) {
  const remote = collectAgentsviewUsage(bin, sinceStr, { env: { CLAUDE_CONFIG_DIR: configDir } });
  claudeResults.push({ daily: remote.claudeDaily, err: null });
}
```

And `package.json` / README no longer mention ccusage at all. The one-install-dep story becomes genuinely one install dep.

## Impact

- **For tkmx-client:** unblocks dropping ccusage as a hard dependency. The install story collapses from "install agentsview + also install ccusage if you ever plan to set `EXTRA_CLAUDE_CONFIGS`" down to "install agentsview." Docs get simpler, preflight check gets simpler, code gets simpler.
- **For agentsview:** a small feature that opens up aggregation workflows — any tool that today uses `CLAUDE_CONFIG_DIR` to read remote mirrors can switch to agentsview and get the 200× speedup for free.
- **For users:** one tool to install, faster reports across all their machines, no surprises.

## What we're asking

1. **Add support for `CLAUDE_CONFIG_DIR`** (Option A) or **`--claude-home <path>`** (Option B), whichever fits your preferred CLI style. Either is a drop-in substitute for what tkmx-client needs.
2. **Key the persistent sqlite by resolved config-dir path** so incremental sync works correctly for multiple different `CLAUDE_CONFIG_DIR` values on the same machine.
3. (Nice to have, not blocking) **Mirror the same for `CODEX_HOME`** — no immediate consumer in tkmx-client, but the symmetry is nice.

Happy to pair on implementation, write tests against tkmx-client's real-world synced-remote directories, or send a PR if you'd rather review than build. Let us know what's easiest.

Thanks for building agentsview — the speedup alone is enough to justify this work, and we're excited to ship it as the default in the client.

— Sam / [@srosro](https://github.com/srosro)
