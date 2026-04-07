# Deepspring Client

Reports your Claude Code token usage to the Deepspring server.

## Quick Start

1. **Install ccusage** (if you haven't already):
   ```
   npm install -g ccusage
   ```

2. **Clone and install**:
   ```
   git clone git@github.com:srosro/deepspring-client.git
   cd deepspring-client
   npm install
   ```

3. **Create your `.env`**:
   ```
   USERNAME=your-name
   TEAM=plow
   SERVER_URL=http://slowdown:3847
   ```

4. **Install the auto-reporter** (runs every 2 hours):
   ```
   node reporter/install.js
   ```

5. **Verify it works**:
   ```
   npm run report
   ```

## Dashboard

View the team leaderboard at: **http://slowdown:3847**

## How It Works

The reporter runs `ccusage --json --offline` to collect your local Claude Code usage, then POSTs it to the Deepspring server. A background service (launchd on macOS, systemd on Linux) runs this every 2 hours automatically.

## Manual Report

To push your usage data immediately:

```
npm run report
```

## Logs

- **macOS**: `~/Library/Logs/token-tracking-reporter.log`
- **Linux**: `journalctl --user -u token-tracking-reporter`
