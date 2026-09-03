// Mock CliProxyAPI instance for manual plugin testing and screenshots.
//
//   node tests/mock-cpa.mjs [port]          (default 8317)
//
// It speaks just enough of the management API for the plugin: the fingerprint
// route (401 without a management key), auth-files, and the per-provider
// upstream quota probes via /v0/management/api-call. CORS is wide open, like
// a real deployment. Point the plugin's manual instance input at
// http://127.0.0.1:8317 and paste the management key `mock-key`.
import { createServer } from "node:http";

const PORT = Number(process.argv[2] ?? 8317);
const MANAGEMENT_KEY = "mock-key";
let usageStatsEnabled = true;

const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

const authFiles = {
  files: [
    {
      auth_index: "ag-1", name: "antigravity-demo@example.com", provider: "antigravity",
      status: "available", project_id: "demo-project-1",
    },
    {
      auth_index: "ag-2", name: "antigravity-second@example.com", provider: "antigravity",
      status: "available", project_id: "demo-project-2",
    },
    {
      auth_index: "codex-1", name: "codex-demo@example.com", provider: "codex", status: "available",
      id_token: jwt({ chatgpt_account_id: "demo-account-1", "https://api.openai.com/auth": { chatgpt_account_id: "demo-account-1" } }),
    },
    {
      auth_index: "claude-1", name: "claude-demo@example.com", provider: "claude", status: "available",
    },
    {
      auth_index: "kimi-1", name: "kimi-demo@example.com", provider: "kimi", status: "available",
    },
  ],
};

const upstream = (status, body) => ({ status_code: status, body: JSON.stringify(body) });

function handleApiCall(body) {
  const url = String(body.url ?? "");
  if (url.includes("wham/usage")) {
    return upstream(200, {
      plan_type: "plus",
      rate_limit: {
        allowed: true,
        primary_window: { used_percent: 42.5, limit_window_seconds: 18000, reset_after_seconds: 4700 },
        secondary_window: { used_percent: 81.2, limit_window_seconds: 604800, reset_after_seconds: 480000 },
      },
    });
  }
  if (url.includes("loadCodeAssist")) {
    return upstream(200, {
      currentTier: { id: "free-tier", name: "Free" },
      paidTier: { id: body.project === "demo-project-2" ? "g1-ultra-tier" : "g1-pro-tier", name: "Google One" },
      cloudaicompanionProject: body.project ?? "demo-project-1",
    });
  }
  if (url.includes("retrieveUserQuotaSummary")) {
    const ultra = body.project === "demo-project-2";
    return upstream(200, {
      groups: [
        {
          displayName: "Gemini models",
          description: "Models within this group: Gemini Flash, Gemini Pro",
          buckets: [
            { bucketId: "gemini-5h", displayName: "Five Hour Limit Remaining", window: "5h", remainingFraction: ultra ? 0.55 : 0.75, resetTime: new Date(Date.now() + 2.4 * 3600 * 1000).toISOString() },
            { bucketId: "gemini-weekly", displayName: "Weekly Limit Remaining", window: "weekly", remainingFraction: ultra ? 0.31 : 0.9, resetTime: new Date(Date.now() + 4.6 * 24 * 3600 * 1000).toISOString() },
          ],
        },
        {
          displayName: "Claude and GPT models",
          description: "Models within this group: Claude Opus, GPT-OSS",
          buckets: [
            { bucketId: "claude-5h", displayName: "Five Hour Limit Remaining", window: "5h", remainingFraction: ultra ? 0.12 : 0.75, resetTime: new Date(Date.now() + 1.3 * 3600 * 1000).toISOString() },
            { bucketId: "claude-weekly", displayName: "Weekly Limit Remaining", window: "weekly", remainingFraction: 0.66, resetTime: new Date(Date.now() + 3.2 * 24 * 3600 * 1000).toISOString() },
          ],
        },
      ],
    });
  }
  if (url.includes("api.anthropic.com/api/oauth/usage")) {
    return upstream(200, {
      five_hour: { utilization: 25, resets_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString() },
      seven_day: { utilization: 43, resets_at: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString() },
    });
  }
  if (url.includes("api.anthropic.com/api/oauth/profile")) {
    return upstream(200, { account: { has_claude_max: true } });
  }
  if (url.includes("api.kimi.com/coding/v1/usages")) {
    return upstream(200, { limits: [{ name: "Weekly limit", used: 20, limit: 100, reset_in: 2.2 * 3600 }] });
  }
  return upstream(404, "no probe for this upstream in the mock");
}

const server = createServer((req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  const key = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const json = (status, payload) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...cors });
    res.end(JSON.stringify(payload));
  };
  if (req.url === "/v0/management/usage-statistics-enabled") {
    if (req.method === "PUT") {
      if (key !== MANAGEMENT_KEY) return json(401, { error: "invalid management key" });
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(raw || "{}");
          usageStatsEnabled = parsed.value === true;
          json(200, { "usage-statistics-enabled": usageStatsEnabled });
        } catch (error) {
          json(400, { error: "invalid body" });
        }
      });
      return;
    }
    if (key !== MANAGEMENT_KEY) return json(401, { error: "missing management key" });
    return json(200, { "usage-statistics-enabled": usageStatsEnabled, logging: true });
  }
  if (req.url === "/v0/management/auth-files") {
    if (key !== MANAGEMENT_KEY) return json(401, { error: "invalid management key" });
    return json(200, authFiles);
  }
  if (req.url === "/v0/management/api-call" && req.method === "POST") {
    if (key !== MANAGEMENT_KEY) return json(401, { error: "invalid management key" });
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(raw ?? "{}");
        const result = handleApiCall(parsed);
        json(200, result);
      } catch (error) {
        json(500, { error: String(error) });
      }
    });
    return;
  }
  json(404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock CLIProxyAPI on http://127.0.0.1:${PORT} — management key: ${MANAGEMENT_KEY}`);
});
