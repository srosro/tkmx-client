import type { DailyUsage, ModelBreakdown } from "./usage";

export type { DailyUsage } from "./usage";

// Merge per-day usage from multiple sources. Within a date, model breakdowns
// with the same (modelName, source) are summed — not concatenated — so the
// server never sees two rows colliding on its `(user, date, model, client_id)`
// primary key within a single POST. This matters when one reporter aggregates
// ccusage output from multiple machines (EXTRA_CLAUDE_CONFIGS), since a single
// day can legitimately have the same claude model reported from each machine.
export function mergeDailyUsage(...sources: DailyUsage[][]): DailyUsage[] {
  const dayMap: Record<string, DailyUsage> = {};
  for (const src of sources) {
    for (const day of src) {
      const entry = dayMap[day.date] || (dayMap[day.date] = { date: day.date, modelBreakdowns: [] });
      for (const m of day.modelBreakdowns) {
        const key = `${m.modelName}|${m.source || ""}`;
        const existing = entry.modelBreakdowns.find(
          (b: ModelBreakdown) => `${b.modelName}|${b.source || ""}` === key,
        );
        if (existing) {
          existing.inputTokens += m.inputTokens;
          existing.outputTokens += m.outputTokens;
          existing.cacheCreationTokens += m.cacheCreationTokens;
          existing.cacheReadTokens += m.cacheReadTokens;
          existing.totalTokens += m.totalTokens;
          if (typeof m.cost === "number") {
            existing.cost = (existing.cost || 0) + m.cost;
          }
        } else {
          entry.modelBreakdowns.push({ ...m });
        }
      }
    }
  }
  return Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
}
