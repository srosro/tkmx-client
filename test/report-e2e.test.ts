// End-to-end regression tests for the reporter's two-window contract:
//   1. REPORT_DAYS=1 with activity must still invoke agentsview with
//      --since 28d for session_stats so the wholesale-replaced blob keeps
//      its full rolling window.
//   2. An inactive day (no usage rows) must still POST so session_stats
//      and cursor_stats get refreshed — previously the reporter returned
//      early, which let stale blobs linger forever.
//
// Both tests run the actual reporter/report.js as a child process, stub
// agentsview via AGENTSVIEW_BIN to a recording bash script, and stub the
// server via an in-process http.Server. No real network, no real DB.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

// After build, __dirname = dist/test/. Project root is two levels up;
// the compiled report.js is at dist/reporter/report.js (one level up).
const REPO = path.join(__dirname, "..", "..");
const REPORT_JS = path.join(__dirname, "..", "reporter", "report.js");
const STATE_PATH = path.join(REPO, ".reporting-state.json");
const ENV_PATH = path.join(REPO, ".env");

// Run reporter/report.js asynchronously so the in-process stub HTTP
// server's request handler can fire — spawnSync would block the event
// loop for the entire child lifetime and the server would never respond.
function runReporter(env: Record<string, string>, timeoutMs = 30000): Promise<{status: number | null; stdout: string; stderr: string}> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [REPORT_JS], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

// Builds a temp fake-agentsview bash script. `dailyJson` is the value the
// `usage` subcommand echoes — either a row for the "activity" scenario or
// `{"daily":[]}` for the inactive scenario. The script also logs its argv
// to argvLog so tests can inspect the --since windows.
function writeFakeAgentsview(fakeBin, argvLog, dailyJson) {
  fs.writeFileSync(
    fakeBin,
    `#!/usr/bin/env bash
printf '%s\\t' "$@" >> "${argvLog}"
printf '\\n' >> "${argvLog}"
case "$1" in
  --version)
    echo "agentsview v0.25.0 (commit abcdef1, built 2026-04-24T00:00:00Z)"
    ;;
  usage)
    echo '${dailyJson.replace(/'/g, "'\\''")}'
    ;;
  stats)
    SINCE=""
    for ((i=1; i<=$#; i++)); do
      if [[ "\${!i}" == "--since" ]]; then
        j=$((i+1))
        SINCE="\${!j}"
      fi
    done
    printf '{"schema_version":1,"window":{"days_arg":"%s"},"totals":{"sessions_all":7},"generated_at":"2026-04-24T00:00:00Z"}\\n' "$SINCE"
    ;;
  *)
    echo "unexpected: $*" >&2
    exit 2
    ;;
esac
`,
  );
  fs.chmodSync(fakeBin, 0o755);
}

// Shared test scaffolding: tmp dir, fake-agentsview, stub server. Returns
// everything the test needs plus a cleanup fn.
async function setupE2E({ dailyJson }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tkmx-e2e-"));
  const argvLog = path.join(tmp, "argv.log");
  const fakeBin = path.join(tmp, "fake-agentsview");
  writeFakeAgentsview(fakeBin, argvLog, dailyJson);

  let captured = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url === "/api/usage" && req.method === "POST") {
        captured = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as import("node:net").AddressInfo;
  const { port } = addr;

  const baseEnv = {
    PATH: process.env.PATH,
    HOME: tmp,  // isolates cursor db lookup
    USERNAME: "e2euser",
    API_KEY: "e2ekey",
    CLIENT_ID: "e2e-client-id-fixed",  // avoid writing to .env
    SERVER_URL: `http://127.0.0.1:${port}`,
    AGENTSVIEW_BIN: fakeBin,
    REPORT_DAYS: "1",
    REPORT_DEV_STATS: "true",
    REPORT_SESSION_STATS: "true",
    // dotenv fills unset vars from .env, which would otherwise surface
    // the developer's real REPORT_MACHINE_CONFIG=true and invoke codex
    // / git from collectMachineConfig.
    REPORT_MACHINE_CONFIG: "false",
    EXTRA_CLAUDE_CONFIGS: "",
    OPENAI_ADMIN_KEY: "",
    TEAM: "e2e",
  };

  return {
    argvLog,
    baseEnv,
    getCaptured: () => captured,
    cleanup: () => {
      server.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

// Preserve the user's .reporting-state.json and .env during this test —
// the reporter writes to both on a successful run.
let savedState = null;
let savedEnv = null;

before(() => {
  if (fs.existsSync(STATE_PATH)) {
    savedState = fs.readFileSync(STATE_PATH);
  }
  if (fs.existsSync(ENV_PATH)) {
    savedEnv = fs.readFileSync(ENV_PATH);
  }
});

after(() => {
  if (savedState !== null) fs.writeFileSync(STATE_PATH, savedState);
  else if (fs.existsSync(STATE_PATH)) fs.unlinkSync(STATE_PATH);
  if (savedEnv !== null) fs.writeFileSync(ENV_PATH, savedEnv);
});

test("REPORT_DAYS=1 still invokes agentsview with --since 28d for session_stats", async () => {
  const ctx = await setupE2E({
    dailyJson:
      '{"daily":[{"date":"2026-04-23","modelBreakdowns":[{"modelName":"claude-sonnet-4-6","inputTokens":100,"outputTokens":50,"cacheCreationTokens":0,"cacheReadTokens":0}]}]}',
  });
  try {
    const result = await runReporter(ctx.baseEnv);
    assert.equal(
      result.status,
      0,
      `reporter exited non-zero.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    const captured = ctx.getCaptured();
    assert.ok(captured, "server did not capture a POST body");

    const argvLines = fs.readFileSync(ctx.argvLog, "utf-8").trim().split("\n");
    const statsInvocations = argvLines.filter((l) => l.startsWith("stats\t"));
    assert.ok(
      statsInvocations.length >= 1,
      `expected at least one 'stats' invocation, got ${argvLines.join(" | ")}`,
    );
    for (const line of statsInvocations) {
      assert.match(
        line,
        /--since\t28d/,
        `stats invocation should use --since 28d, got: ${line}`,
      );
    }
    assert.equal(
      captured.session_stats?.window?.days_arg,
      "28d",
      "POSTed session_stats should reflect the 28d window that agentsview was asked for",
    );
    assert.equal(captured.report_days, 1);
  } finally {
    ctx.cleanup();
  }
});

test("inactive day (no usage rows) still posts and still refreshes session_stats", async () => {
  // Regression: the reporter used to early-return when mergedDaily was
  // empty, skipping session_stats / cursor_stats collection and the POST
  // itself. That meant rolling-window blobs could not decay on an
  // inactive REPORT_DAYS=1 day — stale data would linger on the profile
  // until the next day with activity.
  const ctx = await setupE2E({ dailyJson: '{"daily":[]}' });
  try {
    const result = await runReporter(ctx.baseEnv);
    assert.equal(
      result.status,
      0,
      `reporter exited non-zero.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    const captured = ctx.getCaptured();
    assert.ok(
      captured,
      "server should still receive a POST on an inactive day so blob fields can decay",
    );
    assert.deepEqual(captured.data, [], "body.data should be the empty array");
    assert.ok(
      captured.session_stats,
      "session_stats should still be collected and sent on an inactive day",
    );
    assert.equal(
      captured.session_stats.window?.days_arg,
      "28d",
      "session_stats must still reflect the 28d window, not REPORT_DAYS=1",
    );
    // Sanity: stats invocation still happened despite no usage rows.
    const argvLines = fs.readFileSync(ctx.argvLog, "utf-8").trim().split("\n");
    assert.ok(
      argvLines.some((l) => l.startsWith("stats\t")),
      `expected at least one 'stats' invocation on an inactive day; got ${argvLines.join(" | ")}`,
    );
  } finally {
    ctx.cleanup();
  }
});
