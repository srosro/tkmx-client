// Compatibility shim for installed services that pre-date the TypeScript
// migration. Pre-migration installs wrote launchd/systemd units pointing
// at <repo>/reporter/report.js — this file existed as the source of truth
// then. After `git pull && npm install` lands the migration, those units
// keep firing this path; without this shim, the old daemon would silently
// stop reporting until the user re-ran `npm run install-service` to point
// the unit at dist/reporter/report.js.
//
// Forwards to the compiled output, which `npm install` builds via the
// `prepare` lifecycle hook. New installs use install-service / launchd /
// systemd templates that point directly at dist/, bypassing this shim.
//
// Safe to delete after every active install has been re-run through
// `npm run install-service` post-migration (units written from dist/
// don't go through here).
require("../dist/reporter/report.js");
