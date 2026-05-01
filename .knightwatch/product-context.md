# tkmx-client — Product Context

**Stage:** Internal tool. Small user base. Bias: simplicity over completeness.

**Distribution model:** Internal only; no external customer deployments.

**Architectural commitments:**
- Keep the reporter cron (`reporter/report.js`) self-contained and restartable; it runs unattended every 2 hours.
- Fail-fast on config or credential errors — do not silently skip reporting cycles.

**Known near-term migrations / roadmap items:**
- None tracked here yet. Update when roadmap items emerge.

**Review posture:** Architecture specialist should flag anything that adds external-facing surface area (this is an internal tool — treat new public endpoints, new auth surfaces, or new third-party integrations as notable).

**Update cadence:** Quarterly or on major direction change.
