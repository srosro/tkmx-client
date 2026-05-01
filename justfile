set shell := ["bash", "-cu"]

# Default: list available commands
default:
    @just --list

# Run the Node test suite. Always syncs deps from the lockfile so the
# pre-merge gate fails loudly on code, not on a stale node_modules that
# pre-dates a new dependency (typescript was added in the TS migration).
test:
    npm ci --silent
    npm test
