import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

export interface ModelBreakdown {
  modelName: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  cost?: number;
  source?: string;
}

export interface DailyEntry {
  date: string;
  modelBreakdowns?: ModelBreakdown[];
}

// Resolve agentsview binary — launchd/systemd don't inherit user shell PATH,
// so we can't rely on execvp's default search. Resolution order:
//   1. $AGENTSVIEW_BIN (explicit override for nix, asdf, custom installs)
//   2. Hard-coded install-location candidates (matches the quickstart)
//   3. $PATH via `which agentsview` (covers interactive runs)
// Lazy so tests can swap HOME per-case.
function agentsviewCandidates(): string[] {
  return [
    `${process.env.HOME}/.local/bin/agentsview`,
    "/opt/homebrew/bin/agentsview",
    "/usr/local/bin/agentsview",
  ];
}

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

export function resolveAgentsview(): string | null {
  const override = process.env.AGENTSVIEW_BIN;
  if (override && isExecutableFile(override)) return override;
  for (const p of agentsviewCandidates()) {
    if (isExecutableFile(p)) return p;
  }
  try {
    const viaPath = execFileSync("/usr/bin/env", ["which", "agentsview"], {
      encoding: "utf-8", timeout: 5000,
    }).trim();
    if (viaPath && isExecutableFile(viaPath)) return viaPath;
  } catch {}
  return null;
}

// Parses `agentsview --version` raw output like
//   "agentsview v0.23.0-2-g1b484fb (commit 1b484fb, built 2026-04-19T00:00:00Z)"
// into the bare git-describe core ("0.23.0" / "0.23.0-2-g1b484fb"). The
// server's MIN-version gate compares the leading X.Y.Z, so the wrapper
// prefix and "(commit …, built …)" tail are dropped to keep the wire
// value compact and directly displayable. Returns null if the binary is
// missing or `--version` fails.
export function detectAgentsviewVersion(bin: string | null, timeoutMs: number = 5000): string | null {
  if (!bin) return null;
  let raw: string;
  try {
    raw = execFileSync(bin, ["--version"], {
      encoding: "utf-8",
      timeout: timeoutMs,
    }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  agentsview --version failed: ${msg}`);
    return null;
  }
  const m = raw.match(/v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return m ? m[1] : null;
}

export function toIsoDate(sinceStr: string): string {
  return `${sinceStr.slice(0, 4)}-${sinceStr.slice(4, 6)}-${sinceStr.slice(6, 8)}`;
}

interface AgentsviewJson {
  daily?: DailyEntry[];
}

// agentsview breakdown rows carry per-token-type counts but no totalTokens
// field; merge.ts sums it, so compute it here.
export function parseAgentsviewOutput(parsed: AgentsviewJson, source: string): DailyEntry[] {
  const daily = parsed.daily || [];
  for (const day of daily) {
    for (const m of day.modelBreakdowns || []) {
      m.source = source;
      m.totalTokens =
        (m.inputTokens || 0) +
        (m.outputTokens || 0) +
        (m.cacheCreationTokens || 0) +
        (m.cacheReadTokens || 0);
    }
  }
  return daily;
}

function queryAgent(
  bin: string,
  since: string,
  agent: string,
  noSync: boolean,
  timeoutMs: number,
  extraEnv?: Record<string, string>,
): DailyEntry[] {
  const args = ["usage", "daily", "--json", "--breakdown", "--agent", agent, "--since", since];
  if (noSync) args.push("--no-sync");
  const execOpts: Parameters<typeof execFileSync>[2] = { encoding: "utf-8", timeout: timeoutMs };
  if (extraEnv) execOpts.env = { ...process.env, ...extraEnv };
  let raw: string;
  try {
    raw = execFileSync(bin, args, execOpts) as string;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer };
    const stderr = (e.stderr && e.stderr.toString().trim()) || "";
    const detail = stderr ? `: ${stderr}` : `: ${e.message}`;
    throw new Error(`agentsview ${agent} query failed${detail}`);
  }
  return parseAgentsviewOutput(JSON.parse(raw), agent);
}

export function collectAgentsviewUsage(bin: string, sinceStr: string, timeoutMs: number = 180000): { claudeDaily: DailyEntry[]; codexDaily: DailyEntry[] } {
  const since = toIsoDate(sinceStr);

  // One sync call covers every agent: agentsview's syncAllLocked
  // (internal/sync/engine.go) iterates parser.Registry in a single
  // pass, so triggering sync via the claude query also picks up
  // codex, gemini, copilot, etc. The codex follow-up passes
  // --no-sync to avoid a redundant second pass. If agentsview ever
  // changes to per-agent sync scoping, drop --no-sync here.
  const claudeDaily = queryAgent(bin, since, "claude", false, timeoutMs);
  const codexDaily = queryAgent(bin, since, "codex", true, timeoutMs);

  return { claudeDaily, codexDaily };
}

// Single-agent (Claude) collection against an isolated agentsview data
// dir + projects dir. Used for EXTRA_CLAUDE_CONFIGS entries where we
// want per-remote-dir incremental sync without contaminating the local
// machine's ~/.agentsview/sessions.db.
export function collectAgentsviewClaudeOnly(bin: string, sinceStr: string, env: Record<string, string>, timeoutMs: number = 180000): DailyEntry[] {
  const since = toIsoDate(sinceStr);
  return queryAgent(bin, since, "claude", false, timeoutMs, env);
}
