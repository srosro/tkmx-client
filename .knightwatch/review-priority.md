# Review priority

**Stage:** Internal tool. Small user base. Bias: simplicity over completeness.

**Cultural emphasis:** SIMPLIFY and FAIL LOUDLY. No external customer deployments; no SLA; the operator is effectively the only user.

The universal Broken-Glass posture lives in `standards.md` § Broken-Glass Test (sourced from `claude-config/CODING_STANDARDS.md` in vibe-engineering) — apply that here.

**Repo-specific review emphasis:**
- **The reporter cron (`reporter/report.js`) must be self-contained and restartable.** It runs unattended every 2 hours; don't introduce inter-tick state assumptions or rely on previous-tick artifacts existing.
- **Defer scaling concerns.** Rate limits, retry-with-backoff, and rate-aware caching are bloat at this scale unless a measured failure has been observed in production.
- **Cron failure mode: fail loudly + restart on next tick.** Don't add fallback chains; let unattended failures surface as a clean restart on the next 2-hour boundary.
