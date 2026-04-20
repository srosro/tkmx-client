const { execFileSync } = require("node:child_process");
const { resolveAgentsview } = require("./agentsview");

const DEFAULT_TIMEOUT_MS = 180_000;  // 3 minutes — git integration can be slow
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

// collectSessionStats runs `agentsview stats --format json` and returns
// the parsed blob, or null on any error (missing binary, non-zero exit,
// non-JSON output). Errors are logged but never propagate — the reporter
// treats session stats as a best-effort addition and must keep working.
//
// GH_TOKEN / GITHUB_TOKEN are passed through the child env (execFileSync
// inherits process.env by default) rather than on argv, so the token
// doesn't show up in `ps` output.
function collectSessionStats({ sinceDays = 28, timezone } = {}) {
  const bin = resolveAgentsview();
  if (!bin) {
    console.error("[session-stats] agentsview binary not found; skipping");
    return null;
  }
  const args = ["stats", "--format", "json", "--since", `${sinceDays}d`];
  if (timezone) args.push("--timezone", timezone);

  const execOpts = {
    encoding: "utf-8",
    maxBuffer: MAX_BUFFER_BYTES,
    timeout: DEFAULT_TIMEOUT_MS,
  };

  let raw;
  try {
    raw = execFileSync(bin, args, execOpts);
  } catch (err) {
    const stderr = (err.stderr && err.stderr.toString().trim()) || "";
    const detail = stderr ? `: ${stderr}` : `: ${err.message}`;
    console.error(`[session-stats] agentsview failed${detail}`);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[session-stats] JSON parse failed: ${err.message}`);
    return null;
  }

  if (!parsed || typeof parsed !== "object" || typeof parsed.schema_version !== "number") {
    console.error("[session-stats] unexpected output shape");
    return null;
  }
  return parsed;
}

module.exports = { collectSessionStats };
