const path = require("node:path");
const fs = require("node:fs");

// Cursor stores AI code attribution in ~/.cursor/ai-tracking/ai-code-tracking.db.
// No token counts — it tracks lines authored by tab-completion, composer, and human.
// We report aggregate stats only: no commit hashes, branch names, or messages.

function getCursorDbPath() {
  const dbPath = path.join(process.env.HOME, ".cursor", "ai-tracking", "ai-code-tracking.db");
  return fs.existsSync(dbPath) ? dbPath : null;
}

function collectCursorStats(sinceDateStr) {
  const dbPath = getCursorDbPath();
  if (!dbPath) return null;

  let Database;
  try { Database = require("better-sqlite3"); } catch { return null; }

  const sinceDate = `${sinceDateStr.slice(0, 4)}-${sinceDateStr.slice(4, 6)}-${sinceDateStr.slice(6, 8)}`;

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch { return null; }

  try {
    // AI code attribution from scored commits
    const commitStats = db.prepare(`
      SELECT
        COUNT(*) as commits,
        COALESCE(SUM(tabLinesAdded), 0) as tab_lines_added,
        COALESCE(SUM(tabLinesDeleted), 0) as tab_lines_deleted,
        COALESCE(SUM(composerLinesAdded), 0) as composer_lines_added,
        COALESCE(SUM(composerLinesDeleted), 0) as composer_lines_deleted,
        COALESCE(SUM(humanLinesAdded), 0) as human_lines_added,
        COALESCE(SUM(humanLinesDeleted), 0) as human_lines_deleted
      FROM scored_commits
      WHERE commitDate >= ?
    `).get(sinceDate);

    // Conversation count by model and mode
    const y = parseInt(sinceDateStr.slice(0, 4));
    const m = parseInt(sinceDateStr.slice(4, 6)) - 1;
    const d = parseInt(sinceDateStr.slice(6, 8));
    const sinceMs = new Date(y, m, d).getTime();

    const convRows = db.prepare(`
      SELECT model, mode, COUNT(*) as count
      FROM conversation_summaries
      WHERE updatedAt >= ?
      GROUP BY model, mode
    `).all(sinceMs);

    db.close();

    const conversations = {};
    for (const row of convRows) {
      const key = `${row.model || "unknown"}/${row.mode || "unknown"}`;
      conversations[key] = row.count;
    }

    if (commitStats.commits === 0 && Object.keys(conversations).length === 0) return null;

    const result = {};
    if (commitStats.commits > 0) {
      result.scored_commits = commitStats.commits;
      result.tab_lines_added = commitStats.tab_lines_added;
      result.composer_lines_added = commitStats.composer_lines_added;
      result.human_lines_added = commitStats.human_lines_added;
      const totalAdded = commitStats.tab_lines_added + commitStats.composer_lines_added + commitStats.human_lines_added;
      if (totalAdded > 0) {
        result.ai_authored_pct = Math.round(
          ((commitStats.tab_lines_added + commitStats.composer_lines_added) / totalAdded) * 100,
        );
      }
    }
    if (Object.keys(conversations).length > 0) {
      result.conversations = conversations;
    }

    return result;
  } catch {
    try { db.close(); } catch {}
    return null;
  }
}

module.exports = { collectCursorStats, getCursorDbPath };
