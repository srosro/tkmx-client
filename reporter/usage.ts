// Neutral schema for the reporter's normalized usage rows. Owned here,
// not by any individual collector, so a new collector / merge rule can
// extend the same DTO without forcing an unrelated module to become the
// implicit schema author. agentsview.ts and openai.ts are producers
// (their wire-format types stay private to them); merge.ts and report.ts
// are consumers — all four import from this module.
//
// The contract: every counter is a finite number (never undefined),
// totalTokens is computed once at the producer boundary, and cost stays
// optional because not every agent reports it on the wire.

export interface ModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost?: number;
  source?: string;
}

export interface DailyUsage {
  date: string;
  modelBreakdowns: ModelBreakdown[];
}
