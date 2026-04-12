const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return null; }
}

function countLines(filePath) {
  try { return fs.readFileSync(filePath, "utf-8").split("\n").length; } catch { return 0; }
}

// MCP server names from settings.json (names only, never credentials)
function collectMcpServers() {
  const settings = readJsonSafe(SETTINGS_PATH);
  if (!settings) return [];
  const servers = settings.mcpServers || {};
  return Object.keys(servers).sort();
}

// Hook event types and count from settings.json
function collectHooks() {
  const settings = readJsonSafe(SETTINGS_PATH);
  if (!settings) return { events: [], count: 0 };
  const hooks = settings.hooks || {};
  const events = Object.keys(hooks).sort();
  let count = 0;
  for (const event of events) {
    const arr = hooks[event];
    count += Array.isArray(arr) ? arr.length : 1;
  }
  return { events, count };
}

// CLAUDE.md presence and LOC at global + project levels
function collectClaudeMdStats() {
  const globalLoc = countLines(path.join(CLAUDE_DIR, "CLAUDE.md"));
  // Count project-level CLAUDE.md files by scanning ~/.claude/projects
  let projectCount = 0;
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  try {
    for (const dir of fs.readdirSync(projectsDir)) {
      const claudeMd = path.join(projectsDir, dir, "CLAUDE.md");
      if (fs.existsSync(claudeMd)) projectCount++;
    }
  } catch {}
  return { global_loc: globalLoc, project_count: projectCount };
}

// Effort level from settings
function collectEffortLevel() {
  const settings = readJsonSafe(SETTINGS_PATH);
  return settings?.effortLevel || null;
}

// Shell, terminal, editor from environment
function collectEnvironment() {
  const env = {};
  env.shell = path.basename(process.env.SHELL || "");
  if (process.env.TERM_PROGRAM) env.terminal = process.env.TERM_PROGRAM;
  // Detect multiplexer
  if (process.env.TMUX) env.multiplexer = "tmux";
  else if (process.env.ZELLIJ) env.multiplexer = "zellij";
  // Detect editor
  if (process.env.EDITOR) env.editor = path.basename(process.env.EDITOR);
  else if (process.env.VISUAL) env.editor = path.basename(process.env.VISUAL);
  return env;
}

// Count git worktrees across active project dirs
function collectWorktreeCount() {
  const projectsDir = path.join(CLAUDE_DIR, "projects");
  const repoPaths = new Set();
  try {
    for (const dir of fs.readdirSync(projectsDir)) {
      // dir is like -Users-so-Hacking-tokenmaxxing → /Users/so/Hacking/tokenmaxxing
      const repoPath = "/" + dir.replace(/^-/, "").replace(/-/g, "/");
      if (fs.existsSync(path.join(repoPath, ".git"))) repoPaths.add(repoPath);
    }
  } catch {}

  let totalWorktrees = 0;
  for (const repo of repoPaths) {
    try {
      const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
        cwd: repo, encoding: "utf-8", timeout: 5000,
      });
      const count = (out.match(/^worktree /gm) || []).length;
      if (count > 1) totalWorktrees += count; // only count if >1 (main + extras)
    } catch {}
  }
  return totalWorktrees;
}

// Collect all config-stack data into a flat object to merge into machine_config
function collectConfigStack() {
  const cfg = {};

  const mcpServers = collectMcpServers();
  if (mcpServers.length > 0) cfg.mcp_servers = mcpServers;

  const hooks = collectHooks();
  if (hooks.count > 0) {
    cfg.hook_events = hooks.events;
    cfg.hook_count = hooks.count;
  }

  const claudeMd = collectClaudeMdStats();
  if (claudeMd.global_loc > 0) cfg.claude_md_global_loc = claudeMd.global_loc;
  if (claudeMd.project_count > 0) cfg.claude_md_project_count = claudeMd.project_count;

  const effort = collectEffortLevel();
  if (effort) cfg.effort_level = effort;

  const env = collectEnvironment();
  Object.assign(cfg, env);

  const worktrees = collectWorktreeCount();
  if (worktrees > 0) cfg.git_worktrees = worktrees;

  return cfg;
}

module.exports = { collectConfigStack, collectMcpServers, collectHooks, collectClaudeMdStats, collectEnvironment, collectWorktreeCount };
