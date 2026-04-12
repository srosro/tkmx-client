const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// Parse a JSONL file line-by-line (streaming, not loading entire file into memory).
// Returns per-session stats: tool counts, turn counts, cache tokens, timestamps.
async function parseSessionFile(filePath) {
  const stats = {
    toolCalls: {},       // tool name → count
    assistantTurns: 0,
    toolTurnsToolCounts: [], // tools-per-turn for turns that had tools
    cacheRead: 0,
    cacheCreation: 0,
    inputTokens: 0,
    outputTokens: 0,
    timestamps: [],      // all message timestamps
    cwds: new Set(),     // unique working directories (for outcomes)
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }

    // Collect timestamp for session timing
    if (d.timestamp) stats.timestamps.push(d.timestamp);

    // Collect cwds for outcome metrics
    if (d.cwd) stats.cwds.add(d.cwd);

    if (d.type !== "assistant") continue;

    stats.assistantTurns++;
    const msg = d.message;
    if (!msg) continue;

    // Tool calls from content array
    const content = msg.content || [];
    const turnTools = [];
    for (const block of content) {
      if (block.type === "tool_use" && block.name) {
        turnTools.push(block.name);
        stats.toolCalls[block.name] = (stats.toolCalls[block.name] || 0) + 1;
      }
    }
    if (turnTools.length > 0) {
      stats.toolTurnsToolCounts.push(turnTools.length);
    }

    // Cache and token usage
    const usage = msg.usage || {};
    stats.cacheRead += usage.cache_read_input_tokens || 0;
    stats.cacheCreation += usage.cache_creation_input_tokens || 0;
    stats.inputTokens += usage.input_tokens || 0;
    stats.outputTokens += usage.output_tokens || 0;
  }

  return stats;
}

// Compute session duration in minutes from timestamps
function sessionDurationMinutes(timestamps) {
  if (timestamps.length < 2) return 0;
  const sorted = timestamps.map((t) => new Date(t).getTime()).sort((a, b) => a - b);
  return (sorted[sorted.length - 1] - sorted[0]) / 60000;
}

// Collect workflow stats from all JSONL sessions within the reporting window.
async function collectWorkflowStats(sinceDateStr) {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return null;

  // sinceDateStr is YYYYMMDD
  const y = parseInt(sinceDateStr.slice(0, 4));
  const m = parseInt(sinceDateStr.slice(4, 6)) - 1;
  const day = parseInt(sinceDateStr.slice(6, 8));
  const sinceMs = new Date(y, m, day).getTime();

  const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);

  // Collect all JSONL files, filter by mtime within window
  const jsonlFiles = [];
  for (const dir of projectDirs) {
    const projPath = path.join(CLAUDE_PROJECTS_DIR, dir);
    let entries;
    try { entries = fs.readdirSync(projPath); } catch { continue; }
    for (const file of entries) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(projPath, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs >= sinceMs) jsonlFiles.push(filePath);
      } catch { continue; }
    }
  }

  if (jsonlFiles.length === 0) return null;

  // Aggregate across all sessions
  const agg = {
    tool_calls: {},
    sessions: 0,
    assistant_turns: 0,
    total_tools_in_tool_turns: 0,
    tool_turns: 0,
    cache_read: 0,
    cache_creation: 0,
    input_tokens: 0,
    output_tokens: 0,
    session_durations: [],
    hours_active: new Array(24).fill(0),
    cwds: new Set(),
  };

  for (const filePath of jsonlFiles) {
    const stats = await parseSessionFile(filePath);
    // Skip sessions with no assistant activity (empty / system-only)
    if (stats.assistantTurns === 0) continue;

    agg.sessions++;
    agg.assistant_turns += stats.assistantTurns;

    for (const [tool, count] of Object.entries(stats.toolCalls)) {
      agg.tool_calls[tool] = (agg.tool_calls[tool] || 0) + count;
    }

    for (const count of stats.toolTurnsToolCounts) {
      agg.total_tools_in_tool_turns += count;
      agg.tool_turns++;
    }

    agg.cache_read += stats.cacheRead;
    agg.cache_creation += stats.cacheCreation;
    agg.input_tokens += stats.inputTokens;
    agg.output_tokens += stats.outputTokens;

    const duration = sessionDurationMinutes(stats.timestamps);
    if (duration > 0) agg.session_durations.push(duration);

    // Hour-of-day histogram from first timestamp of session
    if (stats.timestamps.length > 0) {
      const hour = new Date(stats.timestamps[0]).getHours();
      agg.hours_active[hour]++;
    }

    for (const cwd of stats.cwds) agg.cwds.add(cwd);
  }

  if (agg.sessions === 0) return null;

  // Build the output — aggregate stats only, no paths or content
  // cache efficiency = reads / (reads + creates + uncached input)
  const totalPromptTokens = agg.cache_read + agg.cache_creation + agg.input_tokens;
  const result = {
    sessions: agg.sessions,
    assistant_turns: agg.assistant_turns,
    tool_calls: agg.tool_calls,
    avg_tools_per_tool_turn: agg.tool_turns > 0
      ? Math.round((agg.total_tools_in_tool_turns / agg.tool_turns) * 100) / 100
      : 0,
    plan_mode_entries: (agg.tool_calls.EnterPlanMode || 0),
    subagent_dispatches: (agg.tool_calls.Task || 0) + (agg.tool_calls.Agent || 0),
    cache_reuse_ratio: totalPromptTokens > 0
      ? Math.round((agg.cache_read / totalPromptTokens) * 1000) / 1000
      : 0,
    avg_session_minutes: agg.session_durations.length > 0
      ? Math.round(agg.session_durations.reduce((a, b) => a + b, 0) / agg.session_durations.length)
      : 0,
    hours_active: agg.hours_active,
  };

  return { workflowStats: result, cwds: Array.from(agg.cwds) };
}

module.exports = { collectWorkflowStats, parseSessionFile };
