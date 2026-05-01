import * as https from "node:https";
import type { DailyUsage } from "./usage";
import { errMessage } from "./errors";

// Fetch OpenAI platform usage (platform.openai.com/usage) for the given window.
// Requires OPENAI_ADMIN_KEY in env — an admin API key (sk-admin-...), not a
// regular project key. Create at platform.openai.com/settings/organization/admin-keys.
//
// Only the /completions endpoint is used — that covers chat completions and the
// Responses API, which is where essentially all token volume lives. Embeddings
// and moderations exist as separate endpoints but are a rounding error for
// most users; add them here if your org has meaningful volume there.

const USAGE_BASE = "https://api.openai.com/v1/organization/usage";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_PAGES = 10;

interface UsageResult {
  model: string;
  input_tokens: number;
  output_tokens: number;
  input_cached_tokens: number;
}

interface UsageBucket {
  start_time: number;
  results: UsageResult[];
}

interface UsagePage {
  data: UsageBucket[];
  has_more?: boolean;
  next_page?: string;
}

function httpsGetJSON(url: string, apiKey: string): Promise<UsagePage> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`OpenAI usage API ${res.statusCode}: ${body.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`Failed to parse OpenAI usage response: ${errMessage(err)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("OpenAI usage API request timed out"));
    });
    req.end();
  });
}

async function fetchAllBuckets(endpoint: string, apiKey: string, startTime: number): Promise<UsageBucket[]> {
  const buckets: UsageBucket[] = [];
  let page: string | null = null;
  // Safety cap: with bucket_width=1d&limit=31 a 30-day window fits in one page.
  // Grouped results don't increase page count, only result array size per bucket.
  for (let i = 0; i < MAX_PAGES; i++) {
    const url = new URL(`${USAGE_BASE}/${endpoint}`);
    url.searchParams.set("start_time", String(startTime));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.append("group_by", "model");
    url.searchParams.set("limit", "31");
    if (page) url.searchParams.set("page", page);

    const resp = await httpsGetJSON(url.toString(), apiKey);
    buckets.push(...resp.data);
    if (!resp.has_more || !resp.next_page) break;
    page = resp.next_page;
  }
  return buckets;
}

// Convert OpenAI usage buckets to the modelBreakdowns-per-day shape the
// reporter merges and submits. Uses local timezone for the date string so
// days line up with ccusage/Codex dates.
export function bucketsToDaily(buckets: UsageBucket[], source: string = "openai-api"): DailyUsage[] {
  const byDate: Record<string, DailyUsage> = {};
  for (const bucket of buckets) {
    const date = new Date(bucket.start_time * 1000);
    const dateStr =
      date.getFullYear() +
      "-" +
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0");

    for (const result of bucket.results) {
      const inputTokensTotal = result.input_tokens;
      const outputTokens = result.output_tokens;
      const cachedInput = result.input_cached_tokens;
      if (inputTokensTotal === 0 && outputTokens === 0) continue;

      const entry = byDate[dateStr] || (byDate[dateStr] = { date: dateStr, modelBreakdowns: [] });
      // input_tokens in the OpenAI response already includes cached; split them
      // out so cache hits show up as cacheReadTokens (matches ccusage semantics).
      const inputTokens = inputTokensTotal - cachedInput;
      entry.modelBreakdowns.push({
        modelName: result.model,
        inputTokens,
        outputTokens,
        cacheCreationTokens: 0,
        cacheReadTokens: cachedInput,
        totalTokens: inputTokens + outputTokens + cachedInput,
        source,
      });
    }
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

export async function collectOpenAIUsage(sinceDateStr: string): Promise<DailyUsage[]> {
  const apiKey = process.env.OPENAI_ADMIN_KEY;
  if (!apiKey) return [];

  const y = parseInt(sinceDateStr.slice(0, 4), 10);
  const m = parseInt(sinceDateStr.slice(4, 6), 10) - 1;
  const d = parseInt(sinceDateStr.slice(6, 8), 10);
  const startTime = Math.floor(new Date(y, m, d).getTime() / 1000);

  const buckets = await fetchAllBuckets("completions", apiKey, startTime);
  return bucketsToDaily(buckets);
}
