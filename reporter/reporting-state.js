const fs = require("node:fs");

const DEFAULT_STATE = Object.freeze({ dev_stats_on: false, session_stats_on: false });

function loadState(filePath) {
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

function saveState(filePath, state) {
  const normalized = {
    dev_stats_on:     Boolean(state.dev_stats_on),
    session_stats_on: Boolean(state.session_stats_on),
  };
  fs.writeFileSync(filePath, JSON.stringify(normalized), "utf-8");
}

// computeTransitionMarkers returns the set of POST body fields that
// should be added to this report to signal the transition to tkmx-server.
// Only on→off transitions produce markers; on→on, off→on, and off→off
// do not.
function computeTransitionMarkers(prior, current) {
  const markers = {};
  if (prior.dev_stats_on && !current.dev_stats_on) {
    markers.clear_dev_stats = true;
  }
  if (prior.session_stats_on && !current.session_stats_on) {
    markers.session_stats = null;
  }
  return markers;
}

module.exports = { loadState, saveState, computeTransitionMarkers, DEFAULT_STATE };
