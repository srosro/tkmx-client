import * as path from "node:path";
import * as fs from "node:fs";
import type Database from "better-sqlite3";

// Cursor stores AI code attribution in ~/.cursor/ai-tracking/ai-code-tracking.db.
// No token counts — it tracks lines authored by tab-completion, composer, and human.
// We report aggregate stats only: no commit hashes, branch names, or messages.

export function getCursorDbPath(): string | null {
  const dbPath = path.join(process.env.HOME || "", ".cursor", "ai-tracking", "ai-code-tracking.db");
  return fs.existsSync(dbPath) ? dbPath : null;
}

interface CommitStats {
  commits: number;
  tab_lines_added: number;
  tab_lines_deleted: number;
  composer_lines_added: number;
  composer_lines_deleted: number;
  human_lines_added: number;
  human_lines_deleted: number;
}

interface ConvRow {
  model: string | null;
  mode: string | null;
  count: number;
}

export interface CursorStats {
  scored_commits?: number;
  tab_lines_added?: number;
  composer_lines_added?: number;
  human_lines_added?: number;
  ai_authored_pct?: number;
  conversations?: Record<string, number>;
}

export function collectCursorStats(sinceDateStr: string): CursorStats | null {
  const dbPath = getCursorDbPath();
  if (!dbPath) return null;

  let DatabaseCtor: typeof Database;
  try { DatabaseCtor = require("better-sqlite3"); } catch { return null; }

  const sinceDate = `${sinceDateStr.slice(0, 4)}-${sinceDateStr.slice(4, 6)}-${sinceDateStr.slice(6, 8)}`;

  let db: Database.Database;
  try {
    db = new DatabaseCtor(dbPath, { readonly: true });
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
    `).get(sinceDate) as CommitStats;

    // Conversation count by model and mode
    const y = parseInt(sinceDateStr.slice(0, 4), 10);
    const m = parseInt(sinceDateStr.slice(4, 6), 10) - 1;
    const d = parseInt(sinceDateStr.slice(6, 8), 10);
    const sinceMs = new Date(y, m, d).getTime();

    const convRows = db.prepare(`
      SELECT model, mode, COUNT(*) as count
      FROM conversation_summaries
      WHERE updatedAt >= ?
      GROUP BY model, mode
    `).all(sinceMs) as ConvRow[];

    db.close();

    const conversations: Record<string, number> = {};
    for (const row of convRows) {
      const key = `${row.model || "unknown"}/${row.mode || "unknown"}`;
      conversations[key] = row.count;
    }

    const result: CursorStats = {};
    // Note: when the DB is present but the 28d window has no activity,
    // we fall through and return an empty object (not null). Upstream
    // report.ts uses `if (cursorStats)` to decide whether to attach —
    // an empty object is truthy and therefore still lands in the POST,
    // which is critical: the server's wholesale-replace semantics (see
    // tkmx-server/server/db.ts resolveMachineFields) would otherwise
    // preserve the last non-empty blob indefinitely after the user
    // stops using Cursor, leaving stale data on the profile forever.
    // `null` is reserved for the "no Cursor DB on this machine" case
    // (see getCursorDbPath above) where refreshing doesn't apply.
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
