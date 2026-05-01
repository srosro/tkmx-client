import * as fs from "node:fs";

export interface ReportingState {
  dev_stats_on: boolean;
  session_stats_on: boolean;
}

export const DEFAULT_STATE: Readonly<ReportingState> = Object.freeze({ dev_stats_on: false, session_stats_on: false });

export function loadState(filePath: string): ReportingState {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      dev_stats_on:     Boolean(parsed.dev_stats_on),
      session_stats_on: Boolean(parsed.session_stats_on),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(filePath: string, state: ReportingState): void {
  const normalized: ReportingState = {
    dev_stats_on:     Boolean(state.dev_stats_on),
    session_stats_on: Boolean(state.session_stats_on),
  };
  fs.writeFileSync(filePath, JSON.stringify(normalized), "utf-8");
}

export interface TransitionMarkers {
  clear_dev_stats?: true;
  session_stats?: null;
}

// computeTransitionMarkers returns the set of POST body fields that
// should be added to this report to signal the transition to tkmx-server.
// Only on→off transitions produce markers; on→on, off→on, and off→off
// do not.
export function computeTransitionMarkers(prior: ReportingState, current: ReportingState): TransitionMarkers {
  const markers: TransitionMarkers = {};
  if (prior.dev_stats_on && !current.dev_stats_on) {
    markers.clear_dev_stats = true;
  }
  if (prior.session_stats_on && !current.session_stats_on) {
    markers.session_stats = null;
  }
  return markers;
}
