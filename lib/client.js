/**
 * CliProxyAPI quota indicator, browser half.
 *
 * A green hollow dot is injected left of the model name in the composer's
 * model-select trigger. CliProxyAPI instances are discovered automatically:
 * the plugin reads every DSH llm provider's baseURL (`llm.providers` +
 * `settings.describe` over the client connection RPC face), fingerprints
 * each baseURL against the CliProxyAPI management API (CORS is open), and
 * watches the instances it finds. The only per-user input is the management
 * key, editable in Settings → Plugins → “CliProxyAPI Quota” (stored in
 * localStorage) or via the cordis.patch.yml config. Hovering the dot (or the
 * trigger) opens a floating card with provider-specific quota windows:
 * Codex, Claude, Antigravity, Gemini CLI, Kimi and xAI/Grok are queried using
 * their upstream quota endpoints; other CLIProxyAPI auth providers still show
 * account status and recent request activity. Everything is fetched
 * browser-side and removed cleanly on plugin dispose.
 *
 * Data path mirrors the CLIProxyAPI management API and its upstream provider
 * quota requests:
 * GET /v0/management/auth-files, then POST /v0/management/api-call with
 * $TOKEN$ substitution for each upstream probe.
 */
window.__ModuleLoader__.load({
	id: "dsh-client-ui-cpa-quota",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");

		//#region constants
		const DOT_ATTR = "data-cpa-quota-ring";
		const TIP_ATTR = "data-cpa-quota-tip";
		const LS_CONFIG = "dsh-cpa-quota:config";
		// v2: the v1 cache recorded false negatives from the /v1-prefixed probe URL.
		const LS_PROBE = "dsh-cpa-quota:probe.v2";
		const EV_CONFIG = "dsh-cpa-quota:config-changed";
		const EV_UPDATED = "dsh-cpa-quota:updated";
		const EV_REFRESH = "dsh-cpa-quota:refresh-requested";
		const PROBE_TTL = 60 * 60 * 1000;
		/** Unreachable/unknown verdicts retry on this shorter clock so one
		 * transient network failure never hides a ring for an hour. */
		const PROBE_RETRY_TTL = 2 * 60 * 1000;
		/** Usage ledger (per-instance local request history) — powers the
		 * "accounts in use" filter and the 24h usage lines. */
		const USAGE_QUEUE_PATH = "/v0/management/usage-queue?count=300";
		const USAGE_LEDGER_PREFIX = "dsh-cpa-quota:ledger:";
		const USAGE_LEDGER_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
		const USAGE_LEDGER_MAX_EVENTS = 4000;
		const USAGE_ACTIVE_WINDOW = 24 * 60 * 60 * 1000;
		/** In-use window follows the card's refresh interval (set by applyConfig)
		 * so "in use" means "served within the current refresh cycle". */
		let usageWindowMs = USAGE_ACTIVE_WINDOW;
		const USAGE_STATS_TTL = 10 * 60 * 1000;
		const LS_ACTIVE_ONLY = "dsh-cpa-quota:active-only";
		const W5H = 5 * 60 * 60;
		const W7D = 7 * 24 * 60 * 60;
		const W28D = 28 * 24 * 60 * 60;
		const W31D = 31 * 24 * 60 * 60;
		const UPSTREAM = {
			codexUsage: "https://chatgpt.com/backend-api/wham/usage",
			claudeProfile: "https://api.anthropic.com/api/oauth/profile",
			claudeUsage: "https://api.anthropic.com/api/oauth/usage",
			// The subscription endpoint is served by the daily Cloud Code host,
			// matching the official management center implementation.
			googleLoad: "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
			googleQuota: "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
			antigravityModels: [
				"https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
				"https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
			],
			antigravityQuota: [
				"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
				"https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
				"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
			],
			kimiUsage: "https://api.kimi.com/coding/v1/usages",
			xaiBillingWeekly: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
			xaiBillingMonthly: "https://cli-chat-proxy.grok.com/v1/billing",
			xaiMe: "https://api.x.ai/v1/me",
			xaiChat: "https://api.x.ai/v1/chat/completions",
			xaiPaidHealthModel: "grok-4.5",
		};
		const AG_META = { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" };
		const GEMINI_META = { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" };
		const ZH = String(navigator.language || "zh").toLowerCase().startsWith("zh");
		const LOW_PCT = 20;
		const PROVIDER_LABELS = {
			codex: "Codex",
			antigravity: "Antigravity",
			"gemini-cli": "Gemini CLI",
			gemini: "Gemini",
			claude: "Claude",
			anthropic: "Claude",
			kimi: "Kimi",
			qwen: "Qwen",
			glm: "GLM",
			deepseek: "DeepSeek",
			xai: "xAI / Grok",
			grok: "xAI / Grok",
			iflow: "iFlow",
			vertex: "Vertex",
			interactions: "Interactions API",
			aistudio: "AI Studio",
			"openai-compatibility": "OpenAI-compatible",
			"openai-compatible": "OpenAI-compatible",
			openai: "OpenAI",
			"gemini-api": "Gemini API",
			"opencode-go": "OpenCode Go",
			copilot: "GitHub Copilot",
			infistar: "Infistar",
		};
		const PLAN_LABELS = {
			free: "Free",
			"free-tier": "Free",
			plan_free: "Free",
			basic: "Basic",
			standard: "Standard",
			team: "Team",
			plan_pro: "Pro",
			"g1-pro-tier": "Pro",
			pro: "Pro",
			plan_max: "Max",
			max: "Max",
			plan_team: "Team",
			plus: "Plus",
			ultra: "Ultra",
			"g1-ultra-tier": "Ultra",
			"ultra-lite": "Ultra Lite",
			"g1-ultra-lite-tier": "Ultra Lite",
			paid: "Paid",
			enterprise: "Enterprise",
		};
		//#endregion

		//#region shared runtime state (indicator + settings card)
		/** baseKey → { state: 'ok'|'error'|'nokey', error, accounts, fetchedAt } */
		const quotaByKey = new Map();
		/** `${baseKey}\0${auth_index}` → the last successfully resolved plan. */
		const planByAccountKey = new Map();
		/** baseKey → { cpa: boolean|null, at: number, reason: string } fingerprint results */
		const discoveredByKey = new Map();
		const shared = {
			refreshing: false,
			probing: false,
			instances: [],
			lastRefreshedAt: 0,
			nextRefreshAt: 0,
			usageStatsByBase: {},
		};
		const emitUpdated = () => {
			try {
				window.dispatchEvent(new CustomEvent(EV_UPDATED));
			} catch {
				/* older engines */
			}
		};
		//#endregion

		//#region small helpers
		const clampPct = (v) => Math.max(0, Math.min(100, v));
		const text = (v) => (typeof v === "string" ? v.trim() : "");
		const firstText = (...values) => {
			for (const v of values) {
				const t = text(v);
				if (t !== "") return t;
			}
			return "";
		};
		const numberOrNull = (v) => {
			if (typeof v === "number" && Number.isFinite(v)) return v;
			if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
			return null;
		};
		const boolOf = (v) => v === true || v === "true";
		const flagOf = (v) => {
			if (v === true || v === 1 || v === "1") return true;
			if (v === false || v === 0 || v === "0") return false;
			if (typeof v === "string") {
				const normalized = v.trim().toLowerCase();
				if (["true", "yes", "on"].includes(normalized)) return true;
				if (["false", "no", "off"].includes(normalized)) return false;
			}
			return undefined;
		};
		const normalizeProvider = (value) => {
			const provider = text(value).toLowerCase();
			if (provider === "anthropic" || provider === "claude-code") return "claude";
			if (provider === "grok" || provider === "x-ai" || provider === "x.ai") return "xai";
			if (provider === "gemini-cli" || provider === "gemini") return provider;
			if (provider === "zai" || provider === "zhipu" || provider === "chatglm") return "glm";
			return provider;
		};

		function fractionPercent(value) {
			const rawText = text(value);
			if (rawText.endsWith("%")) {
				const percent = Number(rawText.slice(0, -1));
				return Number.isFinite(percent) ? clampPct(percent) : null;
			}
			const raw = numberOrNull(value);
			if (raw === null) return null;
			if (raw > 1 && raw <= 100) return clampPct(raw);
			return clampPct(raw * 100);
		}

		function windowTypeFromText(...values) {
			const normalized = values.map((value) => text(value).toLowerCase()).filter(Boolean).join(" ");
			if (/(?:^|[^0-9])5\s*[-_ ]?(?:h|hour|hours)|five\s*[-_ ]?hour|5小时/.test(normalized)) return "5h";
			if (/7\s*[-_ ]?(?:d|day|days)|weekly|week|每周|7天/.test(normalized)) return "7d";
			if (/(?:28|29|30|31)\s*[-_ ]?(?:d|day|days)|monthly|month|每月|月度/.test(normalized)) return "30d";
			if (/daily|day|每日|每天/.test(normalized)) return "1d";
			return "";
		}

		function windowTypeFromSeconds(value) {
			const seconds = numberOrNull(value);
			if (seconds === null) return "";
			if (seconds === W5H) return "5h";
			if (seconds === W7D) return "7d";
			if (seconds >= W28D && seconds <= W31D) return "30d";
			if (seconds <= 24 * 60 * 60) return "1d";
			return "";
		}

		function defaultWindowLabel(type) {
			if (ZH) {
				if (type === "5h") return "5小时窗口";
				if (type === "7d") return "每周窗口";
				if (type === "30d") return "每月窗口";
				if (type === "1d") return "每日窗口";
			}
			if (type === "5h") return "Five Hour Limit Remaining";
			if (type === "7d") return "Weekly Limit Remaining";
			if (type === "30d") return "Monthly Limit Remaining";
			if (type === "1d") return "Daily Limit Remaining";
			return "Quota";
		}

		function windowSortRank(row) {
			if (row.windowType === "5h") return 0;
			if (row.windowType === "7d") return 1;
			if (row.windowType === "30d") return 2;
			if (row.windowType === "1d") return 3;
			return 99;
		}

		function getPath(obj, path) {
			let cur = obj;
			for (const key of path) {
				if (cur === null || typeof cur !== "object") return undefined;
				cur = cur[key];
			}
			return cur;
		}

		/**
		 * Normalize the plan/tier identifiers used by the upstream providers.
		 * CPA auth-files do not expose a common plan field, so this intentionally
		 * accepts both the human label and the stable Antigravity tier ids.
		 */
		function normalizePlanToken(value) {
			const raw = text(value);
			if (raw === "") return "";
			const key = raw.toLowerCase().replace(/[\s_]+/g, "-");
			if (PLAN_LABELS[key] !== undefined) return key;
			if (/g1[- ]?ultra[- ]?lite|ultra[- ]?lite|ultralite/.test(key)) return "ultra-lite";
			if (/g1[- ]?ultra|ultra/.test(key)) return "ultra";
			if (/g1[- ]?pro|(^|[- ])pro($|[- ]|plan|tier)/.test(key)) return "pro";
			if (/free[- ]?tier|(^|[- ])free($|[- ]|plan|tier)/.test(key)) return "free";
			if (/plus/.test(key)) return "plus";
			if (/max/.test(key)) return "max";
			if (/team/.test(key)) return "team";
			if (/enterprise/.test(key)) return "enterprise";
			return "";
		}

		/** Resolve one plan-shaped value without treating an email/account name as a plan. */
		function planValue(value, field = "") {
			if (typeof value === "string") {
				const raw = text(value);
				if (raw === "") return "";
				const normalized = normalizePlanToken(raw);
				if (normalized !== "") return normalized;
				return /plan|tier|subscription|membership/i.test(field) ? raw : "";
			}
			if (value === null || typeof value !== "object" || Array.isArray(value)) return "";
			for (const [key, candidate] of [
				["plan", value.plan],
				["plan_type", value.plan_type],
				["planType", value.planType],
				["tier_name", value.tier_name],
				["tierName", value.tierName],
				["tier_id", value.tier_id],
			]) {
				const resolved = planValue(candidate, key);
				if (resolved !== "") return resolved;
			}
			if (/plan|tier|subscription|membership/i.test(field)) {
				for (const [key, candidate] of [["name", value.name], ["id", value.id]]) {
					const resolved = planValue(candidate, key);
					if (resolved !== "") return resolved;
				}
			}
			return "";
		}

		/**
		 * Extract a plan from an auth-file or an upstream profile response. The
		 * paid tier is deliberately checked before the current/default tier: an
		 * Antigravity response can contain `currentTier: free-tier` together with
		 * a paid `paidTier: g1-pro-tier`.
		 */
		function extractPlan(...sources) {
			const paths = [
				["paidTier"], ["paid_tier"], ["subscription"], ["plan"], ["plan_type"], ["planType"],
				["tier"], ["tier_name"], ["tierName"], ["tier_id"], ["tierId"],
				["currentTier"], ["current_tier"], ["account", "subscription"], ["account", "plan"],
				["account", "plan_type"], ["account", "tier"], ["organization", "subscription"],
				["organization", "plan"], ["metadata", "subscription"], ["metadata", "plan"],
				["metadata", "plan_type"], ["metadata", "tier"], ["attributes", "subscription"],
				["attributes", "plan"], ["attributes", "plan_type"], ["attributes", "tier"],
				["account_type"],
			];
			for (const source of sources) {
				if (source === null || source === undefined) continue;
				const direct = planValue(source, "plan");
				if (direct !== "") return direct;
				if (typeof source !== "object" || Array.isArray(source)) continue;
				for (const path of paths) {
					const candidate = getPath(source, path);
					const resolved = planValue(candidate, path[path.length - 1]);
					if (resolved !== "") return resolved;
				}
			}
			return "";
		}

		function planLabel(value) {
			const normalized = normalizePlanToken(value);
			const key = normalized || text(value).toLowerCase().replace(/[\s_]+/g, "-");
			return PLAN_LABELS[key] ?? text(value);
		}

		/** Normalize a baseURL for matching: strip protocol, www., trailing /v1 and slashes. */
		function baseKey(raw) {
			let s = text(raw);
			if (s === "") return "";
			s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
			s = s.replace(/^(www\.)?/i, "");
			s = s.replace(/\/+$/, "");
			s = s.replace(/\/v1$/i, "");
			return s.toLowerCase();
		}

		/**
		 * Management-API base of a baseURL: trailing slashes and the conventional
		 * OpenAI-compatible `/v1` suffix stripped — the management routes live at
		 * `{origin}/v0/management/...`, never under `/v1`.
		 */
		function mgmtBase(raw) {
			return text(raw).replace(/\/+$/, "").replace(/\/v1$/i, "");
		}

		function hostOf(raw) {
			const s = text(raw).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
			const slash = s.indexOf("/");
			return (slash === -1 ? s : s.slice(0, slash)).toLowerCase();
		}

		/** Strip a trailing effort/variant suffix so series models fall together. */
		function seriesKey(id) {
			return text(id)
				.toLowerCase()
				.replace(/-(extra-low|high|low|medium|thinking|preview)$/i, "");
		}

		function fmtClock(date) {
			const p = (n) => String(n).padStart(2, "0");
			return `${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
		}

		function fmtResetFromUnix(ts) {
			if (ts === null || ts <= 0) return "";
			const d = new Date(ts * 1000);
			return Number.isNaN(d.getTime()) ? "" : fmtClock(d);
		}

		function fmtResetFromSeconds(secs) {
			if (secs === null || secs <= 0) return "";
			return fmtResetFromUnix(Math.floor(Date.now() / 1000) + secs);
		}

		function fmtResetFromISO(iso) {
			const d = new Date(text(iso));
			return text(iso) === "" || Number.isNaN(d.getTime()) ? "" : fmtClock(d);
		}

		function fmtResetRelative(iso) {
			const d = new Date(text(iso));
			if (text(iso) === "" || Number.isNaN(d.getTime())) return "";
			const delta = d.getTime() - Date.now();
			if (delta <= 0) return ZH ? "可用" : "available";
			const totalMinutes = Math.max(1, Math.ceil(delta / 60000));
			const days = Math.floor(totalMinutes / 1440);
			const hours = Math.floor((totalMinutes % 1440) / 60);
			const minutes = totalMinutes % 60;
			if (ZH) {
				if (days > 0) return `${days}天${hours}小时后刷新`;
				if (hours > 0) return `${hours}小时${minutes}分钟后刷新`;
				return `${minutes}分钟后刷新`;
			}
			if (days > 0) return `refreshes in ${days}d ${hours}h`;
			if (hours > 0) return `refreshes in ${hours}h ${minutes}m`;
			return `refreshes in ${minutes}m`;
		}

		function fmtRefreshAge(now) {
			if (shared.lastRefreshedAt <= 0) return ZH ? "等待首次刷新" : "waiting for first refresh";
			const ageSeconds = Math.max(0, Math.floor((now - shared.lastRefreshedAt) / 1000));
			if (ageSeconds < 5) return ZH ? "刚刚更新" : "updated just now";
			if (ageSeconds < 60) return ZH ? `${ageSeconds} 秒前更新` : `updated ${ageSeconds}s ago`;
			const minutes = Math.floor(ageSeconds / 60);
			return ZH ? `${minutes} 分钟前更新` : `updated ${minutes}m ago`;
		}

		function fmtNextRefresh(now) {
			if (shared.refreshing) return ZH ? "正在刷新…" : "refreshing…";
			if (shared.nextRefreshAt <= 0) return ZH ? "等待排程" : "waiting for schedule";
			const seconds = Math.max(0, Math.ceil((shared.nextRefreshAt - now) / 1000));
			if (seconds <= 0) return ZH ? "即将刷新" : "refreshing soon";
			const minutes = Math.floor(seconds / 60);
			const rest = String(seconds % 60).padStart(2, "0");
			return ZH ? `下次刷新 ${minutes}:${rest}` : `next refresh ${minutes}:${rest}`;
		}

		async function fetchJSON(url, init) {
			const response = await fetch(url, init);
			const body = await response.text();
			let payload = null;
			try {
				payload = body === "" ? null : JSON.parse(body);
			} catch {
				payload = null;
			}
			if (!response.ok) {
				const detail = payload !== null && typeof payload === "object" && payload.error !== undefined
					? typeof payload.error === "object" ? JSON.stringify(payload.error) : String(payload.error)
					: body.slice(0, 140);
				const error = new Error(`HTTP ${response.status}${detail !== "" ? `: ${detail}` : ""}`);
				error.status = response.status;
				throw error;
			}
			return payload;
		}

		/** Parse a JWT-like string or passthrough object into claims (used for the Codex account id). */
		function jwtClaims(value) {
			const raw = text(value);
			if (raw === "") return null;
			if (raw.startsWith("{")) {
				try {
					return JSON.parse(raw);
				} catch {
					return null;
				}
			}
			const parts = raw.split(".");
			if (parts.length < 2) return null;
			let enc = parts[1].replace(/-/g, "+").replace(/_/g, "/");
			while (enc.length % 4 !== 0) enc += "=";
			try {
				return JSON.parse(atob(enc));
			} catch {
				return null;
			}
		}

		/**
		 * The ChatGPT account id for a Codex auth file. The management API
		 * exposes `id_token` as an ALREADY-PARSED claims object (not a JWT
		 * string), and CPA also accepts `tokens.account_id` in newer builds —
		 * all shapes are handled here.
		 */
		function claimsOf(value) {
			if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
			if (typeof value === "string") return jwtClaims(value);
			return null;
		}

		function codexAccountId(entry) {
			const direct = firstText(
				entry.chatgpt_account_id,
				entry.account_id,
				getPath(entry, ["tokens", "account_id"]),
				getPath(entry, ["tokens", "chatgpt_account_id"]),
				getPath(entry, ["metadata", "account_id"]),
				getPath(entry, ["attributes", "account_id"]),
			);
			if (direct !== "") return direct;
			const candidates = [entry.id_token, getPath(entry, ["tokens", "id_token"]), getPath(entry, ["metadata", "id_token"]), getPath(entry, ["attributes", "id_token"])];
			for (const candidate of candidates) {
				const claims = claimsOf(candidate);
				if (claims === null) continue;
				const directClaim = text(claims.chatgpt_account_id);
				if (directClaim !== "") return directClaim;
				const auth = claims["https://api.openai.com/auth"];
				if (auth !== null && typeof auth === "object") {
					const nestedId = text(auth.chatgpt_account_id);
					if (nestedId !== "") return nestedId;
				}
			}
			return "";
		}

		function codexPlanFromEntry(entry) {
			const candidates = [entry.id_token, getPath(entry, ["tokens", "id_token"]), getPath(entry, ["metadata", "id_token"]), getPath(entry, ["attributes", "id_token"])]
				.map(claimsOf)
				.filter((claims) => claims !== null);
			return extractPlan(...candidates);
		}
		//#endregion

		//#region config + localStorage
		function readLocalConfig() {
			try {
				const raw = window.localStorage.getItem(LS_CONFIG);
				if (raw === null || raw.trim() === "") return {};
				const parsed = JSON.parse(raw);
				return parsed !== null && typeof parsed === "object" ? parsed : {};
			} catch {
				return {};
			}
		}

		function readConfig(...sources) {
			const merged = { instances: [], refreshMinutes: 10, usageWindowMinutes: 1440 };
			const applySource = (source, origin) => {
				if (source === null || source === undefined || typeof source !== "object") return;
				if (Array.isArray(source.instances)) {
					for (const item of source.instances) {
						if (item === null || typeof item !== "object") continue;
						const baseURL = text(item.baseURL ?? item.baseUrl);
						if (baseURL === "") continue;
						merged.instances.push({
							baseURL,
							managementKey: text(item.managementKey ?? item.management_key ?? item.key),
							source: origin,
						});
					}
				}
				if (source.refreshMinutes !== undefined) {
					const minutes = numberOrNull(source.refreshMinutes);
					if (minutes !== null && minutes >= 1) merged.refreshMinutes = Math.min(1440, minutes);
				}
				if (source.usageWindowMinutes !== undefined) {
					const minutes = numberOrNull(source.usageWindowMinutes);
					if (minutes !== null && minutes >= 5) merged.usageWindowMinutes = Math.min(10080, minutes);
				}
			};
			// Precedence (low → high): apply() config argument, ctx.config, localStorage override.
			for (const source of sources) applySource(source, "yaml");
			applySource(readLocalConfig(), "local");
			// Deduplicate by normalized baseURL; the later (higher-precedence) entry wins.
			const byKey = new Map();
			for (const instance of merged.instances) {
				const key = baseKey(instance.baseURL);
				if (key === "") continue;
				byKey.set(key, {
					baseURL: instance.baseURL,
					base: mgmtBase(instance.baseURL),
					managementKey: instance.managementKey,
					manual: instance.source === "local",
				});
			}
			merged.instances = [...byKey.values()];
			return merged;
		}

		function writeLocalConfig(next) {
			window.localStorage.setItem(LS_CONFIG, JSON.stringify(next));
			window.dispatchEvent(new CustomEvent(EV_CONFIG));
		}

		/** Normalize an imported config object: valid instances only, clamped refreshMinutes. */
		function parseImportedConfig(raw) {
			const parsed = JSON.parse(raw);
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("config must be a JSON object");
			const out = { instances: [], refreshMinutes: 10 };
			const minutes = numberOrNull(parsed.refreshMinutes);
			if (minutes !== null && minutes >= 1) out.refreshMinutes = Math.min(1440, minutes);
			if (Array.isArray(parsed.instances)) {
				for (const item of parsed.instances) {
					if (item === null || typeof item !== "object") continue;
					const baseURL = text(item.baseURL ?? item.baseUrl);
					if (baseURL === "") continue;
					out.instances.push({ baseURL, managementKey: text(item.managementKey ?? item.management_key ?? item.key) });
				}
			}
			if (out.instances.length === 0) throw new Error("config contains no usable instances");
			return out;
		}

		function readProbeCache() {
			try {
				const raw = window.localStorage.getItem(LS_PROBE);
				const parsed = raw === null ? {} : JSON.parse(raw);
				return parsed !== null && typeof parsed === "object" ? parsed : {};
			} catch {
				return {};
			}
		}

		function writeProbeCache(cache) {
			try {
				window.localStorage.setItem(LS_PROBE, JSON.stringify(cache));
			} catch {
				/* storage full / disabled — probe results just won't persist */
			}
		}
		//#endregion

		//#region provider directory (baseURL discovery source)
		/** Race one RPC call against an 8s timeout; the timer is always cleared
		 * so a settled call never keeps the event loop alive. */
		async function rpcWithTimeout(promise, what) {
			let timer;
			try {
				return await Promise.race([
					promise,
					new Promise((_, reject) => {
						timer = setTimeout(() => reject(new Error(`cpa-quota: ${what} timed out`)), 8000);
					}),
				]);
			} finally {
				clearTimeout(timer);
			}
		}

		/**
		 * Joins the provider directory with settings values.
		 *
		 * Works across dsh generations: ≤0.1.1 (rc.x) exposes
		 * `api.llm.providers({})` / `api.settings.describe({})` with a
		 * `{result:{ok,value}}` envelope, while 0.1.2 removed `ConnectionHandle.api`
		 * and serves `remote.llm.listConfigurableProviders()` (flat `{ok,value}`
		 * envelope, no arguments) and `remote.settings.describe()` — which hangs
		 * forever when handed a parameter object. Both shapes are probed here, and
		 * every call races the timeout above so a hung RPC cannot stall the rings.
		 *
		 * @returns { index: Map<label/id → {baseURL, modelId, providerId}>,
		 *            providerBases: Map<baseKey → {baseURL, providerId}> }
		 */
		async function loadModelIndex(api) {
			const llm = api?.llm ?? null;
			const settings = api?.settings ?? null;
			const listConfigurable =
				typeof llm?.listConfigurableProviders === "function" ? () => llm.listConfigurableProviders() :
				typeof llm?.providers === "function" ? () => llm.providers({}) :
				null;
			if (listConfigurable === null || typeof settings?.describe !== "function") {
				throw new Error("cpa-quota: llm/settings RPC face unavailable");
			}
			// describe() without arguments works on 0.1.2; rc.x may reject it, so a
			// failed no-arg attempt falls back to the rc.x ({}) form once.
			const attempt = (call) => Promise.resolve().then(call).catch(() => null);
			const unwrap = (res) => (res !== null && typeof res === "object" && res.result !== undefined ? res.result : res);
			const valid = (data) => data !== null && typeof data === "object" && data.ok !== false &&
				(data.value !== undefined || data.providers !== undefined || data.namespaces !== undefined);
			const providersRes = unwrap(await rpcWithTimeout(listConfigurable(), "llm.providers"));
			if (!valid(providersRes)) throw new Error("cpa-quota: llm.providers face unusable");
			let settingsRes = unwrap(await attempt(() => rpcWithTimeout(settings.describe(), "settings.describe")));
			if (!valid(settingsRes)) {
				settingsRes = unwrap(await attempt(() => rpcWithTimeout(settings.describe({}), "settings.describe({})")));
			}
			if (!valid(settingsRes)) throw new Error("cpa-quota: settings.describe face unusable");
			const declaredProviders = Array.isArray(providersRes.value)
				? providersRes.value
				: Array.isArray(providersRes.value?.providers) ? providersRes.value.providers
				: Array.isArray(providersRes.providers) ? providersRes.providers : [];
			const namespaces = new Map((settingsRes.value?.namespaces ?? settingsRes.namespaces ?? []).map((view) => [view.ns, view]));
			const index = new Map();
			const providerBases = new Map();
			const indexEntry = (baseURL, modelId, modelName, providerId) => {
				if (modelId === "") return;
				const record = { baseURL, modelId, providerId };
				index.set(modelId.toLowerCase(), record);
				if (modelName !== "") index.set(modelName.toLowerCase(), record);
			};
			for (const entry of declaredProviders) {
				if (entry === null || typeof entry !== "object") continue;
				const view = namespaces.get(entry.settingsNs);
				if (view === undefined) continue;
				const configValue = Array.isArray(entry.settingsPath) && entry.settingsPath.length > 0
					? getPath(view.value, entry.settingsPath)
					: view.value;
				if (configValue === null || typeof configValue !== "object") continue;
				const baseURL = text(configValue.baseURL ?? configValue.baseUrl);
				if (baseURL !== "") providerBases.set(baseKey(baseURL), { baseURL, providerId: text(entry.provider) });
				const models = Array.isArray(configValue.models) ? configValue.models : [];
				for (const model of models) {
					if (model === null || typeof model !== "object") continue;
					indexEntry(baseURL, text(model.id), text(model.name), text(entry.provider));
				}
			}
			// Fallback for hosts whose provider directory stays empty: build the
			// index straight from the settings namespaces, supporting the nested
			// providers.<name>.{baseURL,models} layout and flat layouts alike.
			if (index.size === 0 || providerBases.size === 0) {
				for (const view of namespaces.values()) {
					if (view === null || typeof view !== "object" || view.value === null || typeof view.value !== "object") continue;
					const nested = view.value.providers && typeof view.value.providers === "object" ? Object.entries(view.value.providers) : [];
					for (const [providerName, providerValue] of nested) {
						if (providerValue === null || typeof providerValue !== "object") continue;
						const baseURL = text(providerValue.baseURL ?? providerValue.baseUrl);
						if (baseURL !== "") providerBases.set(baseKey(baseURL), { baseURL, providerId: providerName });
						const models = Array.isArray(providerValue.models) ? providerValue.models : [];
						for (const model of models) {
							if (model === null || typeof model !== "object") continue;
							indexEntry(baseURL, text(model.id), text(model.name), providerName);
						}
					}
					const baseURL = text(view.value.baseURL ?? view.value.baseUrl);
					const models = Array.isArray(view.value.models) ? view.value.models : [];
					if (baseURL !== "") providerBases.set(baseKey(baseURL), { baseURL, providerId: view.ns });
					for (const model of models) {
						if (model === null || typeof model !== "object") continue;
						indexEntry(baseURL, text(model.id), text(model.name), view.ns);
					}
				}
			}
			return { index, providerBases };
		}
		//#endregion

		//#region CPA fingerprint probe
		/**
		 * Fingerprint one baseURL as a CliProxyAPI instance. The management API
		 * is the signal: an unauthenticated GET on a management route answers
		 * 401 with a management-key error on CPA, where a plain
		 * OpenAI-compatible server answers 404 / HTML / something else.
		 * @returns {'cpa'|'no'|'unknown'|'unreachable'}
		 */
		async function probeCpa(base) {
			// A hung probe never yields a verdict and the ring stays missing, so
			// bound the request like every other network call.
			const controller = typeof AbortController === "function" ? new AbortController() : null;
			const timer = controller === null ? 0 : window.setTimeout(() => controller.abort(), 10_000);
			try {
				const response = await fetch(`${base}/v0/management/usage-statistics-enabled`, { method: "GET", ...(controller === null ? {} : { signal: controller.signal }) });
				const body = await response.text();
				if (response.status === 401) return /management|unauthor/i.test(body) ? "cpa" : "unknown";
				if (response.status === 404) return "no";
				// A 2xx only counts with CPA-shaped content: a bare `true`/`false`
				// appears in plenty of unrelated JSON bodies.
				if (response.status >= 200 && response.status < 300 && /management|logging|"enabled"\s*:|usage-statistics/i.test(body)) return "cpa";
				return "unknown";
			} catch {
				return "unreachable";
			} finally {
				if (timer !== 0) window.clearTimeout(timer);
			}
		}

		async function probeProviderBases(providerBases, force) {
			const cache = readProbeCache();
			const targets = [];
			for (const [key, info] of providerBases) {
				const hit = cache[key];
				if (!force && hit !== undefined) {
					// Confirmed verdicts (cpa / a plain 404) keep the long cache; a
					// transient network failure or ambiguous answer must retry
					// quickly — caching it for an hour left rings missing after a
					// single hiccup.
					const ttl = hit.cpa === true || hit.verdict === "no" ? PROBE_TTL : PROBE_RETRY_TTL;
					if (Date.now() - hit.at < ttl) {
						discoveredByKey.set(key, { ...hit, baseURL: info.baseURL });
						continue;
					}
				}
				targets.push([key, info]);
			}
			if (targets.length === 0) return;
			shared.probing = true;
			emitUpdated();
			await Promise.all(targets.map(async ([key, info]) => {
				const verdict = await probeCpa(mgmtBase(info.baseURL));
				const record = { cpa: verdict === "cpa", verdict, at: Date.now() };
				discoveredByKey.set(key, { ...record, baseURL: info.baseURL });
				cache[key] = record;
			}));
			shared.probing = false;
			writeProbeCache(cache);
			emitUpdated();
		}
		//#endregion

		//#region quota fetching (CliProxyAPI management API)
		/** Per-request ceiling: one hung upstream must never stall the refresh
		 * cycle (a stuck `refreshing` flag would block every later refresh). */
		const API_CALL_TIMEOUT_MS = 20_000;
		/** Upstream probes run through a bounded pool: dozens of auth files must
		 * not turn into dozens of simultaneous upstream requests. */
		const ACCOUNT_PROBE_CONCURRENCY = 5;

		/** `Promise.all` over `worker` with at most `limit` in flight. */
		async function pooledAll(items, limit, worker) {
			const results = new Array(items.length);
			let cursor = 0;
			const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
				while (cursor < items.length) {
					const index = cursor;
					cursor += 1;
					results[index] = await worker(items[index], index);
				}
			});
			await Promise.all(runners);
			return results;
		}

		async function apiCall(instance, payload, timeoutMs = API_CALL_TIMEOUT_MS) {
			const headers = { "Content-Type": "application/json" };
			if (instance.managementKey !== "") headers.Authorization = `Bearer ${instance.managementKey}`;
			const controller = timeoutMs > 0 && typeof AbortController === "function" ? new AbortController() : null;
			const timer = controller === null ? 0 : window.setTimeout(() => controller.abort(), timeoutMs);
			try {
				return await fetchJSON(`${instance.base}/v0/management/api-call`, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				...(controller === null ? {} : { signal: controller.signal }),
				});
			} catch (error) {
				if (controller !== null && controller.signal.aborted) throw new Error(ZH ? `上游请求超过 ${Math.round(timeoutMs / 1000)} 秒未响应` : `upstream did not respond within ${Math.round(timeoutMs / 1000)}s`);
				throw error;
			} finally {
				if (timer !== 0) window.clearTimeout(timer);
			}
		}

		/** The api-call response body: {status_code, body} where body is JSON string or object. */
		function unwrapApiCall(response) {
			const status = numberOrNull(response?.status_code ?? response?.statusCode) ?? 0;
			let body = response?.body;
			if (typeof body === "string") {
				try {
					body = JSON.parse(body);
				} catch {
					/* keep the raw string for the error path */
				}
			}
			if (status < 200 || status >= 300) {
				const detail = typeof body === "string" ? body.slice(0, 140) : JSON.stringify(body ?? {}).slice(0, 140);
				throw new Error(`upstream HTTP ${status}${detail !== "" ? `: ${detail}` : ""}`);
			}
			if (body === null || typeof body !== "object") throw new Error("upstream returned an empty payload");
			return body;
		}

		/** Unwrap the occasional management/HTTP wrapper around a JSON upstream body. */
		function unwrapNestedPayload(value) {
			let current = value;
			for (let depth = 0; depth < 3; depth += 1) {
				if (typeof current === "string") {
					try {
						current = JSON.parse(current);
					} catch {
						return value;
					}
				}
				if (current === null || typeof current !== "object" || Array.isArray(current)) return current;
				if (["groups", "models", "currentTier", "paidTier", "cloudaicompanionProject", "config", "limits", "rate_limit", "five_hour", "buckets"].some((key) => Object.prototype.hasOwnProperty.call(current, key))) return current;
				const nested = current.body ?? current.data ?? current.result;
				if (nested === undefined || nested === current || nested === null) return current;
				current = nested;
			}
			return current;
		}

		/** One quota window row, provider-agnostic. `modelId` set for per-model windows. */
		function windowRow({
			id,
			label,
			modelId,
			usedPercent,
			remainingPercent,
			resetLabel,
			exhausted,
			windowType,
			groupId,
			groupLabel,
			groupDescription,
			modelIds,
			prefixes,
		}) {
			const used = usedPercent === null ? null : clampPct(usedPercent);
			return {
				id,
				label,
				modelId: modelId ?? null,
				modelIds: Array.isArray(modelIds) ? modelIds : undefined,
				prefixes: Array.isArray(prefixes) ? prefixes : undefined,
				groupId: groupId ?? null,
				groupLabel: groupLabel ?? "",
				groupDescription: groupDescription ?? "",
				windowType: windowType ?? windowTypeFromText(label),
				usedPercent: used,
				remainingPercent: remainingPercent === null && used === null ? null : clampPct(remainingPercent ?? 100 - used),
				resetLabel: resetLabel ?? "",
				exhausted: exhausted ?? (used !== null && used >= 100),
			};
		}

		function parseCodexWindows(body) {
			const rate = body.rate_limit ?? body.rateLimit;
			const codeReviewRate = body.code_review_rate_limit ?? body.codeReviewRateLimit;
			const extras = body.additional_rate_limits ?? body.additionalRateLimits;
			const windows = [];

			const classify = (limitInfo) => {
				if (limitInfo === null || typeof limitInfo !== "object") return { fiveHour: null, secondary: null, secondaryType: "7d" };
				const primary = limitInfo.primary_window ?? limitInfo.primaryWindow;
				const secondary = limitInfo.secondary_window ?? limitInfo.secondaryWindow;
				const candidates = [primary, secondary].filter((raw) => raw !== null && typeof raw === "object");
				const findByType = (type) => candidates.find((raw) => {
					const explicit = windowTypeFromSeconds(raw.limit_window_seconds ?? raw.limitWindowSeconds);
					return explicit === type;
				}) ?? null;
				const fiveHour = findByType("5h") ?? (primary !== null && typeof primary === "object" ? primary : null);
				const secondaryByDuration = findByType("7d") ?? findByType("30d");
				const secondaryFallback = candidates.find((raw) => raw !== fiveHour) ?? null;
				const secondaryWindow = secondaryByDuration ?? secondaryFallback;
				const secondaryType = windowTypeFromSeconds(secondaryWindow?.limit_window_seconds ?? secondaryWindow?.limitWindowSeconds) || "7d";
				return { fiveHour, secondary: secondaryWindow, secondaryType };
			};

			const addLimit = (limitInfo, prefix, labels) => {
				if (limitInfo === null || typeof limitInfo !== "object") return;
				const classified = classify(limitInfo);
				const limitReached = boolOf(limitInfo.limit_reached ?? limitInfo.limitReached);
				const allowed = limitInfo.allowed;
				const parseWindow = (raw, id, type, label) => {
					if (raw === null || raw === undefined || typeof raw !== "object") return;
					const used = numberOrNull(raw.used_percent ?? raw.usedPercent);
					const reset = fmtResetFromUnix(numberOrNull(raw.reset_at ?? raw.resetAt)) || fmtResetFromSeconds(numberOrNull(raw.reset_after_seconds ?? raw.resetAfterSeconds));
					const noData = used === null && reset === "";
					const exhaustedHint = (limitReached || allowed === false) && reset !== "";
					windows.push(windowRow({
						id,
						label: label ?? defaultWindowLabel(type),
						windowType: type,
						usedPercent: used ?? (exhaustedHint ? 100 : null),
						remainingPercent: null,
						resetLabel: reset,
						exhausted: used !== null ? used >= 100 : exhaustedHint && !noData,
					}));
				};
				parseWindow(classified.fiveHour, `${prefix}-5h`, "5h", labels.fiveHour);
				parseWindow(classified.secondary, `${prefix}-${classified.secondaryType}`, classified.secondaryType, labels[ classified.secondaryType ] ?? labels.secondary);
			};

			addLimit(rate, "code", {
				fiveHour: ZH ? "5小时窗口" : "5-hour window",
				secondary: ZH ? "每周窗口" : "weekly window",
				"7d": ZH ? "每周窗口" : "weekly window",
				"30d": ZH ? "每月窗口" : "monthly window",
			});
			addLimit(codeReviewRate, "code-review", {
				fiveHour: ZH ? "代码审查 5小时窗口" : "code review 5-hour window",
				secondary: ZH ? "代码审查每周窗口" : "code review weekly window",
				"7d": ZH ? "代码审查每周窗口" : "code review weekly window",
				"30d": ZH ? "代码审查每月窗口" : "code review monthly window",
			});

			if (Array.isArray(extras)) {
				extras.forEach((item, index) => {
					if (item === null || typeof item !== "object") return;
					const extraRate = item.rate_limit ?? item.rateLimit;
					const name = firstText(item.limit_name, item.limitName, item.metered_feature, item.meteredFeature, `extra-${index + 1}`);
					if (extraRate === null || typeof extraRate !== "object") return;
					addLimit(extraRate, `extra:${name}`, {
						fiveHour: `${name} · ${defaultWindowLabel("5h")}`,
						secondary: `${name} · ${defaultWindowLabel("7d")}`,
						"7d": `${name} · ${defaultWindowLabel("7d")}`,
						"30d": `${name} · ${defaultWindowLabel("30d")}`,
					});
				});
			}
			return windows;
		}

		/**
		 * Tolerant reader of the auth-file `recent_requests` snapshot: whatever
		 * shape a CPA build records, extract per-window request counts so every
		 * provider (including ones without an upstream quota probe) can show
		 * 5-hour / 7-day activity windows.
		 */
		function parseRecentRequests(entry) {
			const raw = entry.recent_requests ?? entry.recentRequests;
			if (raw === null || raw === undefined) return null;
			const now = Date.now();
			if (Array.isArray(raw)) {
				let h5 = 0;
				let d7 = 0;
				let bucketCount = 0;
				for (const item of raw) {
					if (item !== null && typeof item === "object") {
						const success = numberOrNull(item.success) ?? 0;
						const failed = numberOrNull(item.failed) ?? 0;
						const count = success + failed;
						if (count > 0) {
							bucketCount += count;
							continue;
						}
					}
					let ts = null;
					if (typeof item === "number") ts = item > 1e12 ? item : item * 1000;
					else if (typeof item === "string") {
						const parsed = new Date(item).getTime();
						if (!Number.isNaN(parsed)) ts = parsed;
					} else if (item !== null && typeof item === "object") {
						const candidate = item.time ?? item.timestamp ?? item.at ?? item.ts ?? item.created_at ?? item.createdAt;
						const num = numberOrNull(candidate);
						if (num !== null) ts = num > 1e12 ? num : num * 1000;
						else if (typeof candidate === "string") {
							const parsed = new Date(candidate).getTime();
							if (!Number.isNaN(parsed)) ts = parsed;
						}
					}
					if (ts === null) continue;
					const age = now - ts;
					if (age <= 5 * 3600 * 1000) h5 += 1;
					if (age <= 7 * 24 * 3600 * 1000) d7 += 1;
				}
				if (bucketCount > 0) return { h5: bucketCount, d7: bucketCount };
				return { h5, d7 };
			}
			if (typeof raw === "object") {
				const pick = (regex) => {
					for (const [key, value] of Object.entries(raw)) {
						if (!regex.test(key)) continue;
						const num = numberOrNull(value);
						if (num !== null) return num;
					}
					return null;
				};
				const h5 = pick(/5|hour/i);
				const d7 = pick(/7|week|day/i);
				if (h5 !== null || d7 !== null) return { h5: h5 ?? 0, d7: d7 ?? 0 };
			}
			return null;
		}

		function antigravityGroupForModel(modelId, label) {
			const id = `${text(modelId)} ${text(label)}`.toLowerCase();
			if (id.includes("claude") || id.includes("gpt")) {
				return {
					id: "claude-gpt",
					label: ZH ? "Claude 和 GPT 模型" : "Claude and GPT models",
					description: "",
				};
			}
			if (id.includes("gemini")) {
				return {
					id: "gemini",
					label: ZH ? "Gemini 模型" : "Gemini models",
					description: "",
				};
			}
			return {
				id: "other",
				label: ZH ? "其他模型" : "Other models",
				description: "",
			};
		}

		function antigravitySummaryRows(body) {
			const groups = Array.isArray(body.groups)
				? body.groups
				: Array.isArray(body.quota?.groups)
					? body.quota.groups
					: Array.isArray(body.data?.groups)
						? body.data.groups
						: [];
			const rows = [];
			groups.forEach((group, groupIndex) => {
				if (group === null || typeof group !== "object") return;
				const groupLabel = firstText(group.displayName, group.display_name, group.name, `Quota Group ${groupIndex + 1}`);
				const groupId = text(group.id) || groupLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `group-${groupIndex + 1}`;
				const groupDescription = firstText(group.description);
				const groupText = `${groupLabel} ${groupDescription}`.toLowerCase();
				const prefixes = groupText.includes("claude") || groupText.includes("gpt")
					? ["claude", "gpt"]
					: groupText.includes("gemini")
						? ["gemini"]
						: undefined;
				const buckets = Array.isArray(group.buckets) ? group.buckets : [];
				buckets.forEach((bucket, bucketIndex) => {
					if (bucket === null || typeof bucket !== "object") return;
					const fraction = fractionPercent(bucket.remainingFraction ?? bucket.remaining_fraction);
					const reset = fmtResetRelative(firstText(bucket.resetTime, bucket.reset_time));
					const type = windowTypeFromText(
						bucket.window,
						bucket.windowType,
						bucket.window_type,
						bucket.displayName,
						bucket.display_name,
						bucket.label,
					) || windowTypeFromSeconds(bucket.windowSeconds ?? bucket.window_seconds ?? bucket.limitWindowSeconds ?? bucket.limit_window_seconds);
					if (fraction === null && reset === "") return;
					const label = firstText(bucket.displayName, bucket.display_name, bucket.label, defaultWindowLabel(type));
					rows.push(windowRow({
						id: `ag-summary:${groupId}:${firstText(bucket.bucketId, bucket.bucket_id, `${type || "bucket"}-${bucketIndex + 1}`)}`,
						label,
						modelId: null,
						usedPercent: fraction === null ? null : 100 - fraction,
						remainingPercent: fraction,
						resetLabel: reset,
						windowType: type,
						groupId,
						groupLabel,
						groupDescription,
						prefixes,
					}));
				});
			});
			return rows;
		}

		function antigravityModelRows(body) {
			const models = body.models;
			if (models === null || typeof models !== "object") return [];
			const rows = [];
			const entries = Array.isArray(models)
				? models.map((raw, index) => [String(index), raw])
				: Object.entries(models);
			for (const [key, raw] of entries) {
				if (raw === null || typeof raw !== "object") continue;
				const modelId = firstText(raw.modelId, raw.model_id, raw.id, raw.name, raw.model, key);
				if (modelId === "") continue;
				const quota = raw.quotaInfo ?? raw.quota_info ?? raw;
				const fraction = fractionPercent(
					quota.remainingFraction
						?? quota.remaining_fraction
						?? quota.remaining
						?? raw.remainingFraction
						?? raw.remaining_fraction
						?? raw.remaining,
				);
				const amount = numberOrNull(
					quota.remainingAmount
						?? quota.remaining_amount
						?? raw.remainingAmount
						?? raw.remaining_amount,
				);
				const reset = fmtResetRelative(
					firstText(
						quota.resetTime,
						quota.reset_time,
						raw.resetTime,
						raw.reset_time,
					),
				);
				if (fraction === null && reset === "") continue;
				const remainingPercent = fraction === null && amount !== null && amount <= 0 ? 0 : fraction;
				const group = antigravityGroupForModel(modelId, raw.displayName ?? raw.display_name ?? raw.name);
				rows.push(windowRow({
					id: `ag:${modelId}`,
					label: firstText(raw.displayName, raw.display_name, raw.name, modelId),
					modelId,
					groupId: group.id,
					groupLabel: group.label,
					groupDescription: group.description,
					usedPercent: remainingPercent === null ? null : 100 - remainingPercent,
					remainingPercent,
					resetLabel: reset,
				}));
			}
			return rows;
		}

		function geminiBucketRows(body) {
			const buckets = Array.isArray(body.buckets) ? body.buckets : [];
			const rows = [];
			for (const bucket of buckets) {
				if (bucket === null || typeof bucket !== "object") continue;
				const modelId = firstText(bucket.modelId, bucket.model_id);
				if (modelId === "") continue;
				const fraction = fractionPercent(bucket.remainingFraction ?? bucket.remaining_fraction ?? bucket.remaining);
				const reset = fmtResetFromISO(bucket.resetTime ?? bucket.reset_time);
				if (fraction === null && reset === "") continue;
				rows.push(windowRow({
					id: `gem:${modelId}`,
					label: modelId,
					modelId: modelId.replace(/_vertex$/, ""),
					windowType: windowTypeFromText(bucket.window, bucket.windowType, bucket.label, modelId) || "7d",
					usedPercent: fraction === null ? null : 100 - fraction,
					remainingPercent: fraction,
					resetLabel: reset,
				}));
			}
			return rows;
		}

		function parseClaudeRows(body) {
			const rows = [];
			const windows = [
				["five_hour", "5h", ZH ? "5小时窗口" : "5-hour window"],
				["seven_day", "7d", ZH ? "每周窗口" : "weekly window"],
				["seven_day_oauth_apps", "7d", ZH ? "OAuth 应用每周窗口" : "OAuth apps weekly window"],
				["seven_day_opus", "7d", ZH ? "Opus 每周窗口" : "Opus weekly window"],
				["seven_day_sonnet", "7d", ZH ? "Sonnet 每周窗口" : "Sonnet weekly window"],
				["seven_day_cowork", "7d", ZH ? "Cowork 每周窗口" : "Cowork weekly window"],
				["iguana_necktie", "7d", ZH ? "Fable 每周窗口" : "Fable weekly window"],
			];
			for (const [key, type, label] of windows) {
				const raw = body[key];
				if (raw === null || typeof raw !== "object") continue;
				const rawUsed = numberOrNull(raw.utilization);
				const used = rawUsed === null ? null : rawUsed <= 1 ? rawUsed * 100 : rawUsed;
				const reset = fmtResetFromISO(firstText(raw.resets_at, raw.resetAt, raw.reset_time));
				if (used === null && reset === "") continue;
				rows.push(windowRow({
					id: `claude:${key}`,
					label,
					modelId: null,
					windowType: type,
					usedPercent: used,
					remainingPercent: used === null ? null : 100 - clampPct(used),
					resetLabel: reset,
				}));
			}
			if (Array.isArray(body.limits)) {
				const fable = body.limits.find((limit) => {
					const kind = text(limit?.kind).toLowerCase();
					const model = text(limit?.scope?.model?.display_name).toLowerCase();
					return kind === "weekly_scoped" && (model === "fable" || model === "fable 5");
				});
				if (fable !== undefined) {
					const rawUsed = numberOrNull(fable.percent);
					const used = rawUsed === null ? null : rawUsed <= 1 ? rawUsed * 100 : rawUsed;
					const reset = fmtResetFromISO(firstText(fable.resets_at, fable.resetAt));
					if (used !== null || reset !== "") {
						rows.push(windowRow({
							id: "claude:seven-day-fable",
							label: ZH ? "Fable 每周窗口" : "Fable weekly window",
							modelId: null,
							windowType: "7d",
							usedPercent: used,
							remainingPercent: used === null ? null : 100 - clampPct(used),
							resetLabel: reset,
						}));
					}
				}
			}
			const extra = body.extra_usage;
			if (extra !== null && typeof extra === "object") {
				const limit = numberOrNull(extra.monthly_limit);
				const used = numberOrNull(extra.used_credits);
				if (limit !== null && limit > 0 && used !== null) {
					rows.push(windowRow({
						id: "claude:extra-monthly",
						label: ZH ? "额外用量月度窗口" : "extra usage monthly window",
						modelId: null,
						windowType: "30d",
						usedPercent: clampPct((used / limit) * 100),
						remainingPercent: clampPct(((limit - used) / limit) * 100),
						resetLabel: "",
					}));
				}
			}
			return rows;
		}

		function durationSeconds(value, unit) {
			const duration = numberOrNull(value);
			if (duration === null || duration <= 0) return null;
			const normalized = text(unit).toLowerCase().replace(/^time_unit_/, "");
			if (normalized.startsWith("second")) return duration;
			if (normalized.startsWith("hour")) return duration * 60 * 60;
			if (normalized.startsWith("day")) return duration * 24 * 60 * 60;
			if (normalized.startsWith("week")) return duration * 7 * 24 * 60 * 60;
			return duration * 60;
		}

		function parseKimiRows(body) {
			const rows = [];
			const limits = Array.isArray(body.limits) ? body.limits : [];
			const add = (data, fallbackLabel, index, duration, unit) => {
				if (data === null || typeof data !== "object") return;
				const limit = numberOrNull(data.limit);
				const used = numberOrNull(data.used);
				const remaining = numberOrNull(data.remaining);
				let remainingPercent = null;
				let usedPercent = null;
				if (limit !== null && limit > 0) {
					if (remaining !== null) remainingPercent = clampPct((remaining / limit) * 100);
					else if (used !== null) {
						usedPercent = clampPct((used / limit) * 100);
						remainingPercent = 100 - usedPercent;
					}
				}
				const resetSeconds = numberOrNull(data.reset_in ?? data.resetIn ?? data.ttl);
				const reset = fmtResetFromISO(firstText(data.reset_at, data.resetAt, data.reset_time, data.resetTime))
					|| fmtResetFromSeconds(resetSeconds);
				const label = firstText(data.name, data.title, data.scope, fallbackLabel);
				const type = windowTypeFromText(label) || windowTypeFromSeconds(durationSeconds(duration, unit));
				if (remainingPercent === null && usedPercent === null && reset === "") return;
				rows.push(windowRow({
					id: `kimi:${index}`,
					label,
					modelId: null,
					windowType: type,
					usedPercent,
					remainingPercent,
					resetLabel: reset,
				}));
			};
			limits.forEach((item, index) => {
				const detail = item?.detail && typeof item.detail === "object" ? item.detail : item;
				const window = item?.window && typeof item.window === "object" ? item.window : {};
				const duration = window.duration ?? item?.duration ?? detail?.duration;
				const unit = window.timeUnit ?? item?.timeUnit ?? detail?.timeUnit;
				add(detail, ZH ? `限制窗口 ${index + 1}` : `limit window ${index + 1}`, index, duration, unit);
			});
			if (body.usage !== null && typeof body.usage === "object") {
				add(body.usage, ZH ? "每周窗口" : "weekly window", rows.length, null, null);
			}
			return rows;
		}

		function parseXaiRows(body, periodType) {
			const config = body.config !== null && typeof body.config === "object" ? body.config : body;
			if (config === null || typeof config !== "object") return [];
			const rows = [];
			const period = config.currentPeriod ?? config.current_period ?? {};
			const periodReset = fmtResetFromISO(firstText(period.end, config.billingPeriodEnd, config.billing_period_end));
			const creditUsage = numberOrNull(config.creditUsagePercent ?? config.credit_usage_percent);
			if (creditUsage !== null && periodType !== "monthly") {
				rows.push(windowRow({
					id: "xai:weekly",
					label: ZH ? "每周额度" : "weekly credits",
					modelId: null,
					windowType: "7d",
					usedPercent: creditUsage,
					remainingPercent: 100 - clampPct(creditUsage),
					resetLabel: periodReset,
				}));
			}
			const monthlyLimitRaw = config.monthlyLimit ?? config.monthly_limit;
			const monthlyLimit = monthlyLimitRaw !== null && typeof monthlyLimitRaw === "object"
				? numberOrNull(monthlyLimitRaw.val)
				: numberOrNull(monthlyLimitRaw);
			const usedRaw = config.used;
			const used = usedRaw !== null && typeof usedRaw === "object" ? numberOrNull(usedRaw.val) : numberOrNull(usedRaw);
			if (monthlyLimit !== null && monthlyLimit > 0 && used !== null) {
				rows.push(windowRow({
					id: "xai:monthly",
					label: ZH ? "月度额度" : "monthly credits",
					modelId: null,
					windowType: "30d",
					usedPercent: clampPct((used / monthlyLimit) * 100),
					remainingPercent: clampPct(((monthlyLimit - used) / monthlyLimit) * 100),
					resetLabel: periodType === "monthly" ? periodReset : "",
				}));
			}
			const products = Array.isArray(config.productUsage ?? config.product_usage) ? (config.productUsage ?? config.product_usage) : [];
			products.forEach((item, index) => {
				if (item === null || typeof item !== "object") return;
				const usage = numberOrNull(item.usagePercent ?? item.usage_percent);
				if (usage === null) return;
				rows.push(windowRow({
					id: `xai:product:${index}`,
					label: firstText(item.product, `${ZH ? "产品" : "product"} ${index + 1}`),
					modelId: null,
					windowType: "7d",
					usedPercent: usage,
					remainingPercent: 100 - clampPct(usage),
					resetLabel: periodReset,
				}));
			});
			return rows;
		}

		/**
		 * Paid Grok accounts do not expose the free-tier billing counters. The
		 * official management center treats a successful `grok-4.5` ping as a
		 * health quota, so keep the account visible and green instead of marking
		 * it as an unsupported/error provider.
		 */
		async function queryXaiPaidHealth(instance, authIndex, headers) {
			const [profileResult, chatResult] = await Promise.allSettled([
				apiCall(instance, {
					auth_index: authIndex,
					method: "GET",
					url: UPSTREAM.xaiMe,
					header: {
						Authorization: "Bearer $TOKEN$",
						accept: "application/json",
					},
				}, 15_000),
				apiCall(instance, {
					auth_index: authIndex,
					method: "POST",
					url: UPSTREAM.xaiChat,
					header: { ...headers, "Content-Type": "application/json" },
					data: JSON.stringify({
						model: UPSTREAM.xaiPaidHealthModel,
						messages: [{ role: "user", content: "ping" }],
						max_tokens: 1,
						stream: false,
					}),
				}, 15_000),
			]);
			if (chatResult.status === "rejected") throw chatResult.reason;
			unwrapApiCall(chatResult.value);
			// Profile is useful for diagnostics but is not required for a healthy
			// paid account; a provider can authorize chat while hiding /v1/me.
			if (profileResult.status === "fulfilled") {
				try { unwrapApiCall(profileResult.value); } catch { /* optional */ }
			}
			return windowRow({
				id: "xai:paid-health",
				label: ZH ? "账户可用性" : "account health",
				windowType: "health",
				usedPercent: 0,
				remainingPercent: 100,
				resetLabel: "",
			});
		}

		function googleHeaders(metadata) {
			const headers = {
				Authorization: "Bearer $TOKEN$",
				"Content-Type": "application/json",
			};
			if (metadata !== undefined) {
				headers["User-Agent"] = "google-api-nodejs-client/9.15.1";
				headers["X-Goog-Api-Client"] = "google-cloud-sdk vscode_cloudshelleditor/0.1";
				headers["Client-Metadata"] = JSON.stringify(metadata);
			}
			return headers;
		}

		async function loadCodeAssist(instance, authIndex, metadata, projectID) {
			const request = { metadata };
			if (projectID !== "") request.cloudaicompanionProject = projectID;
			const headers = metadata?.ideType === "ANTIGRAVITY"
				? {
					Authorization: "Bearer $TOKEN$",
					"Content-Type": "application/json",
					"User-Agent": "antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)",
				}
				: googleHeaders(metadata);
			const rawBody = unwrapApiCall(await apiCall(instance, {
				auth_index: authIndex,
				method: "POST",
				url: UPSTREAM.googleLoad,
				header: headers,
				data: JSON.stringify(request),
			}));
			const body = unwrapNestedPayload(rawBody);
			const record = body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
			const project = record.cloudaicompanionProject ?? record.cloudaicompanion_project;
			return {
				body: record,
				projectID: typeof project === "object" && project !== null ? firstText(project.id) : firstText(project),
			};
		}

		/** baseKey → the Antigravity endpoint that last returned usable quota rows;
		 * trying it first spares the other accounts a 5-endpoint walk. */
		const agEndpointByBase = new Map();

		/**
		 * Per-account served-model registry: CPA exposes the models each auth
		 * file routes (`GET /v0/management/auth-files/models?name=…`) — the same
		 * table its own router uses. Cached per account so refreshes stay cheap;
		 * a failed lookup stays uncached and retries next refresh.
		 */
		const ACCOUNT_MODELS_TTL = 10 * 60 * 1000;
		const accountModelsByKey = new Map();

		async function loadAccountModelList(instance, entry) {
			// Key by the auth FILE NAME — it is stable across CPA's index
			// reshuffles; auth_index moves when accounts are added or removed.
			const name = firstText(entry.name, entry.id);
			if (name === "") return null;
			const key = `${baseKey(instance.baseURL)}\u0000${name}`;
			const hit = accountModelsByKey.get(key);
			if (hit !== undefined && Date.now() - hit.at < ACCOUNT_MODELS_TTL) return hit.ids;
			try {
				const payload = await fetchJSON(`${instance.base}/v0/management/auth-files/models?name=${encodeURIComponent(name)}`, {
					headers: { Authorization: `Bearer ${instance.managementKey}` },
				});
				const rows = Array.isArray(payload?.models) ? payload.models : [];
				const ids = rows
					.map((m) => (typeof m === "string" ? text(m) : firstText(m?.id, m?.name, m?.display_name)))
					.filter((id) => id !== "");
				const out = ids.length > 0 ? ids : null;
				if (out !== null) accountModelsByKey.set(key, { at: Date.now(), ids: out });
				return out;
			} catch {
				return null;
			}
		}

		/** Loose match between a declared model id and the selected one: exact,
		 * same series (effort suffixes stripped), or the selected id extends the
		 * declared alias (declared "gemini-3.7-flash" covers selected
		 * "gemini-3.7-flash-high"). The reverse direction must NOT match — an
		 * account declaring only "gpt-5.5-mini" does not serve "gpt-5.5". */
		function modelListMatches(listedId, modelId) {
			const a = text(listedId).toLowerCase();
			const b = text(modelId).toLowerCase();
			if (a === "" || b === "") return false;
			if (a === b || seriesKey(a) === seriesKey(b)) return true;
			return b.startsWith(`${a}-`);
		}

		//#region usage ledger (per-instance request history, browser-local)
		/**
		 * The ledger answers "which accounts are actually being used". CPA's
		 * usage-queue yields one record per request (auth_index, model,
		 * timestamp, tokens, failed); the plugin is its only consumer, so it
		 * pops the queue every refresh cycle and keeps a per-instance history
		 * in localStorage — keyed by the stable auth-file NAME, pruned to 7
		 * days / 4000 events. No extra service, no server-side storage.
		 */
		const usageLedgerMemory = new Map();
		const usageStatsMemory = new Map();

		function usageLedgerFor(base) {
			let ledger = usageLedgerMemory.get(base);
			if (ledger !== undefined) return ledger;
			let parsed = { fp: [], ev: [] };
			try {
				const raw = window.localStorage.getItem(USAGE_LEDGER_PREFIX + base);
				if (raw !== null && raw.trim() !== "") {
					const candidate = JSON.parse(raw);
					if (candidate !== null && typeof candidate === "object" && Array.isArray(candidate.ev) && Array.isArray(candidate.fp)) parsed = candidate;
				}
			} catch {
				/* corrupted ledger → start fresh */
			}
			usageLedgerMemory.set(base, parsed);
			return parsed;
		}

		function persistUsageLedger(base, ledger) {
			usageLedgerMemory.set(base, ledger);
			try {
				window.localStorage.setItem(USAGE_LEDGER_PREFIX + base, JSON.stringify(ledger));
			} catch {
				/* storage full — the in-memory ledger still covers this session */
			}
		}

		/** Pop CPA's usage queue and fold the records into the ledger. Records
		 * are attributed to auth-file NAMES via the current entry list (auth
		 * indexes reshuffle; names do not). Unknown indexes and requestless
		 * records are dropped. */
		function pollUsageEvents(instance, base, entries) {
			const ledger = usageLedgerFor(base);
			// One-time migration: ledger events recorded by PRE-0.7.2 builds were
			// keyed by the auth-file NAME; re-key them to the rendered display
			// name so the in-use match covers history too. Idempotent.
			const nameByFile = new Map(entries.map((e) => [text(e.name), accountDisplayName(e)]));
			let migrated = false;
			for (const ev of ledger.ev) {
				const mapped = nameByFile.get(ev.a);
				if (mapped !== undefined && mapped !== ev.a) { ev.a = mapped; migrated = true; }
			}
			if (migrated) persistUsageLedger(base, ledger);
			const fpSet = new Set(ledger.fp);
			const nameByIndex = new Map(entries.map((e) => [String(e.auth_index ?? e.authIndex), accountDisplayName(e)]));
			return fetchJSON(`${instance.base}${USAGE_QUEUE_PATH}`, {
				headers: { Authorization: `Bearer ${instance.managementKey}` },
			}).then((records) => {
				if (!Array.isArray(records) || records.length === 0) return 0;
				const now = Date.now();
				let added = 0;
				for (const rec of records) {
					if (rec === null || typeof rec !== "object") continue;
					const indexKey = String(rec.auth_index ?? "");
					const name = nameByIndex.get(indexKey);
					if (name === undefined || name === "") continue;
					const t = Date.parse(rec.timestamp);
					if (!Number.isFinite(t) || now - t > USAGE_LEDGER_MAX_AGE) continue;
					const m = text(rec.model);
					if (m === "") continue;
					const f = rec.failed === true || rec.failed === 1 ? 1 : 0;
					const fp = `${t}:${name}:${m}:${f}`;
					if (fpSet.has(fp)) continue;
					fpSet.add(fp);
					ledger.fp.push(fp);
					ledger.ev.push({
						t,
						m,
						a: name,
						f,
						k: Math.max(0, Math.round(numberOrNull(rec.tokens?.total_tokens) ?? 0)),
					});
					added += 1;
				}
				if (added > 0) {
					ledger.ev.sort((x, y) => x.t - y.t);
					const cutoff = now - USAGE_LEDGER_MAX_AGE;
					if (ledger.ev.some((e) => e.t < cutoff) || ledger.ev.length > USAGE_LEDGER_MAX_EVENTS) {
						ledger.ev = ledger.ev.filter((e) => e.t >= cutoff);
						if (ledger.ev.length > USAGE_LEDGER_MAX_EVENTS) ledger.ev = ledger.ev.slice(ledger.ev.length - USAGE_LEDGER_MAX_EVENTS);
						ledger.fp = ledger.ev.map((e) => `${e.t}:${e.a}:${e.m}:${e.f}`);
					}
					persistUsageLedger(base, ledger);
				}
				return added;
			}).catch(() => 0);
		}

		/** Names with ANY ledger activity inside the window → last-used ts. */
		function usageActiveNamesAny(base, now = Date.now()) {
			const ledger = usageLedgerFor(base);
			const cutoff = now - usageWindowMs;
			const lastByAccount = new Map();
			for (const ev of ledger.ev) {
				if (ev.t < cutoff) continue;
				const prev = lastByAccount.get(ev.a);
				if (prev === undefined || ev.t > prev) lastByAccount.set(ev.a, ev.t);
			}
			return lastByAccount;
		}

		/** Names that served the SELECTED model inside the window. */
		function usageActiveNames(base, modelId, now = Date.now()) {
			const ledger = usageLedgerFor(base);
			const cutoff = now - usageWindowMs;
			const lastByAccount = new Map();
			for (const ev of ledger.ev) {
				if (ev.t < cutoff || !modelListMatches(ev.m, modelId)) continue;
				const prev = lastByAccount.get(ev.a);
				if (prev === undefined || ev.t > prev) lastByAccount.set(ev.a, ev.t);
			}
			return lastByAccount;
		}

		/** Shaped usage view for the filter/tooltip layers. */
		function usageFor(base, modelId, now = Date.now()) {
			const lastByAccount = usageActiveNames(base, modelId, now);
			return { activeNames: new Set(lastByAccount.keys()), lastByAccount };
		}

		/** 24h request count / token sum / last use for one account name. */
		function usageAccountStats(base, name, now = Date.now()) {
			const ledger = usageLedgerFor(base);
			const cutoff = now - USAGE_ACTIVE_WINDOW;
			let count = 0;
			let tokens = 0;
			let lastTs = 0;
			for (const ev of ledger.ev) {
				if (ev.a !== name || ev.t < cutoff) continue;
				count += 1;
				tokens += ev.k;
				if (ev.t > lastTs) lastTs = ev.t;
			}
			return { count, tokens, lastTs };
		}

		function usageCount24h(base, now = Date.now()) {
			const cutoff = now - USAGE_ACTIVE_WINDOW;
			return usageLedgerFor(base).ev.filter((ev) => ev.t >= cutoff).length;
		}

		function usageActiveOnly() {
			try {
				return window.localStorage.getItem(LS_ACTIVE_ONLY) !== "0";
			} catch {
				return true;
			}
		}

		function usageStatsEnabledFor(instance, base) {
			if (instance.managementKey === "") return null;
			const hit = usageStatsMemory.get(base);
			if (hit !== undefined && Date.now() - hit.at < USAGE_STATS_TTL) return hit.enabled;
			return fetchJSON(`${instance.base}/v0/management/usage-statistics-enabled`, {
				headers: { Authorization: `Bearer ${instance.managementKey}` },
			}).then((payload) => {
				// CPA's GET returns the field under its kebab-case name.
				const enabled = boolOf(payload?.["usage-statistics-enabled"] ?? payload?.enabled);
				usageStatsMemory.set(base, { at: Date.now(), enabled });
				return enabled;
			}).catch(() => {
				usageStatsMemory.set(base, { at: Date.now(), enabled: null });
				return null;
			});
		}

		/** One-click enable: PUT writes the CPA config (persisted) and the
		 * in-memory toggle so the queue starts serving records immediately. */
		function enableUsageStats(instance) {
			const base = baseKey(instance.baseURL);
			return fetchJSON(`${base}/v0/management/usage-statistics-enabled`, {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${instance.managementKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ value: true }),
			}).then(() => {
				// The PUT has no response body; we asked for true, so reflect it.
				usageStatsMemory.delete(base);
				shared.usageStatsByBase[base] = true;
			});
		}

		function fmtTokensCompact(tokens) {
			if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
			if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
			return String(tokens);
		}

		function usageLastUsedText(ts, now = Date.now()) {
			const minutes = Math.max(1, Math.round((now - ts) / 60000));
			if (minutes < 60) return ZH ? `${minutes} 分钟前` : `${minutes}m ago`;
			const hours = Math.floor(minutes / 60);
			return ZH ? `${hours} 小时前` : `${hours}h ago`;
		}
		//#endregion

		/** The display name for one auth-file entry — MUST stay in sync with
		 * the ledger's name resolution (pollUsageEvents attributes queue
		 * records to the same name the UI renders). */
		function accountDisplayName(entry) {
			return firstText(entry.label, entry.email, entry.account_email, entry.name, entry.id, firstText(entry.auth_index, entry.authIndex), "unknown");
		}

		async function queryAccount(instance, entry) {
			const provider = normalizeProvider(firstText(entry.provider, entry.type));
			const authIndex = firstText(entry.auth_index, entry.authIndex);
			const planKey = authIndex === "" ? "" : `${baseKey(instance.baseURL)}\u0000${authIndex}`;
			const account = {
				name: accountDisplayName(entry),
				provider,
				authIndex,
				modelList: null,
				status: firstText(entry.status),
				statusMessage: firstText(entry.status_message, entry.statusMessage),
				disabled: boolOf(entry.disabled),
				unavailable: boolOf(entry.unavailable),
				recent: parseRecentRequests(entry),
				plan: extractPlan(entry) || codexPlanFromEntry(entry) || (planKey !== "" ? planByAccountKey.get(planKey) ?? "" : ""),
				windows: [],
				error: "",
			};
			// Which models CPA routes to this account — the authoritative filter
			// signal. Fetched with the account's own management key; a failure
			// just means the account falls back to family-name filtering.
			account.modelList = await loadAccountModelList(instance, entry);
			const rememberPlan = () => {
				if (planKey !== "" && account.plan !== "") planByAccountKey.set(planKey, account.plan);
			};
			const resolveOptionalPlan = (promise) => {
				if (promise === null || promise === undefined) return;
				promise.then((resolved) => {
					if (resolved === "" || account.plan !== "") return;
					account.plan = resolved;
					rememberPlan();
					emitUpdated();
				}).catch(() => {
					/* subscription lookup is optional; quota data remains useful */
				});
			};
			if (authIndex === "") {
				account.error = ZH ? "缺少 auth_index" : "missing auth_index";
				return account;
			}
			try {
				if (provider === "codex") {
					// No id found is not fatal: some CPA setups bind the account
					// server-side, so try without the Chatgpt-Account-Id header
					// and let an upstream rejection surface as the account error.
					const accountID = codexAccountId(entry);
					const usageHeaders = {
						Authorization: "Bearer $TOKEN$",
						"Content-Type": "application/json",
						"User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal",
					};
					if (accountID !== "") usageHeaders["Chatgpt-Account-Id"] = accountID;
					const body = unwrapApiCall(await apiCall(instance, {
						auth_index: authIndex,
						method: "GET",
						url: UPSTREAM.codexUsage,
						header: usageHeaders,
					}));
					account.windows = parseCodexWindows(body);
					account.plan = extractPlan(body) || account.plan;
				} else if (provider === "claude") {
					const [usageResult, profileResult] = await Promise.allSettled([
						apiCall(instance, {
							auth_index: authIndex,
							method: "GET",
							url: UPSTREAM.claudeUsage,
							header: {
								Authorization: "Bearer $TOKEN$",
								"Content-Type": "application/json",
								"anthropic-beta": "oauth-2025-04-20",
							},
						}),
						apiCall(instance, {
							auth_index: authIndex,
							method: "GET",
							url: UPSTREAM.claudeProfile,
							header: {
								Authorization: "Bearer $TOKEN$",
								"Content-Type": "application/json",
								"anthropic-beta": "oauth-2025-04-20",
							},
						}),
					]);
					if (usageResult.status === "rejected") throw usageResult.reason;
					account.windows = parseClaudeRows(unwrapApiCall(usageResult.value));
					if (profileResult.status === "fulfilled" && (numberOrNull(profileResult.value?.status_code ?? profileResult.value?.statusCode) ?? 0) >= 200 && (numberOrNull(profileResult.value?.status_code ?? profileResult.value?.statusCode) ?? 0) < 300) {
						try {
							const profile = unwrapApiCall(profileResult.value);
							const hasMax = flagOf(getPath(profile, ["account", "has_claude_max"]));
							const hasPro = flagOf(getPath(profile, ["account", "has_claude_pro"]));
							const organizationType = text(getPath(profile, ["organization", "organization_type"])).toLowerCase();
							const subscriptionStatus = text(getPath(profile, ["organization", "subscription_status"])).toLowerCase();
							const profilePlan = hasMax === true
								? "plan_max"
								: hasPro === true
									? "plan_pro"
									: organizationType === "claude_team" && subscriptionStatus === "active"
										? "plan_team"
										: hasMax === false && hasPro === false ? "plan_free" : "";
							account.plan = profilePlan || extractPlan(profile) || account.plan;
						} catch {
							/* usage is authoritative; a malformed profile must not hide it */
						}
					}
				} else if (provider === "antigravity") {
					let projectID = firstText(
						entry.project_id,
						entry.projectId,
						getPath(entry, ["metadata", "project_id"]),
						getPath(entry, ["metadata", "projectId"]),
						getPath(entry, ["attributes", "project_id"]),
						getPath(entry, ["attributes", "projectId"]),
						getPath(entry, ["attributes", "gemini_virtual_project"]),
					);
					let optionalTierPromise = null;
					if (projectID === "") {
						const loaded = await loadCodeAssist(instance, authIndex, AG_META, "");
						projectID = loaded.projectID;
						account.plan = extractPlan(loaded.body) || account.plan;
					} else if (account.plan === "") {
						// The auth-file often has the project ID but not the
						// subscription tier. Load it opportunistically; quota
						// fetching must continue while this optional lookup runs.
						// Match the official subscription request: the tier endpoint only
						// needs Antigravity metadata, not the quota project id.
						optionalTierPromise = loadCodeAssist(instance, authIndex, AG_META, "")
							.then((loaded) => extractPlan(loaded.body))
							.catch(() => "");
						resolveOptionalPlan(optionalTierPromise);
					}
					if (projectID === "") {
						account.error = ZH ? "缺少 project_id" : "missing project_id";
						return account;
					}
					let lastError = "";
					const agCacheKey = baseKey(instance.baseURL);
					const agUrls = [...UPSTREAM.antigravityQuota, ...UPSTREAM.antigravityModels];
					const agPreferred = agEndpointByBase.get(agCacheKey);
					const agOrdered = agPreferred === undefined ? agUrls : [agPreferred, ...agUrls.filter((url) => url !== agPreferred)];
					for (const url of agOrdered) {
						try {
							const summaryEndpoint = url.includes("retrieveUserQuotaSummary");
							const body = unwrapNestedPayload(unwrapApiCall(await apiCall(instance, {
								auth_index: authIndex,
								method: "POST",
								url,
								header: {
									Authorization: "Bearer $TOKEN$",
									"Content-Type": "application/json",
									"User-Agent": summaryEndpoint
										? "antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)"
										: "antigravity/1.11.5 windows/amd64",
								},
								data: JSON.stringify({ project: projectID }),
							})));
							account.plan = extractPlan(body) || account.plan;
							const summaryRows = summaryEndpoint ? antigravitySummaryRows(body) : [];
							if (summaryRows.length > 0) {
								account.windows = summaryRows;
								agEndpointByBase.set(agCacheKey, url);
								rememberPlan();
								return account;
							}
							const modelRows = antigravityModelRows(body);
							if (modelRows.length > 0) {
								account.windows = modelRows;
								agEndpointByBase.set(agCacheKey, url);
								rememberPlan();
								return account;
							}
						} catch (error) {
							lastError = error instanceof Error ? error.message : String(error);
						}
					}
					account.error = lastError;
				} else if (provider === "gemini-cli" || provider === "gemini") {
					let projectID = firstText(
						entry.project_id,
						entry.projectId,
						getPath(entry, ["metadata", "project_id"]),
						getPath(entry, ["metadata", "projectId"]),
						getPath(entry, ["attributes", "project_id"]),
						getPath(entry, ["attributes", "projectId"]),
						getPath(entry, ["attributes", "gemini_virtual_project"]),
					);
					if (projectID === "") {
						const loaded = await loadCodeAssist(instance, authIndex, GEMINI_META, "");
						projectID = loaded.projectID;
					}
					if (projectID === "") {
						account.error = ZH ? "缺少 project_id" : "missing project_id";
						return account;
					}
					const body = unwrapApiCall(await apiCall(instance, {
						auth_index: authIndex,
						method: "POST",
						url: UPSTREAM.googleQuota,
						header: googleHeaders({ ...GEMINI_META, duetProject: projectID }),
						data: JSON.stringify({ project: projectID }),
					}));
					account.windows = geminiBucketRows(body);
				} else if (provider === "kimi") {
					const body = unwrapApiCall(await apiCall(instance, {
						auth_index: authIndex,
						method: "GET",
						url: UPSTREAM.kimiUsage,
						header: { Authorization: "Bearer $TOKEN$" },
					}));
					account.windows = parseKimiRows(body);
				} else if (provider === "xai") {
					const headers = {
						Authorization: "Bearer $TOKEN$",
						"x-xai-token-auth": "xai-grok-cli",
						"x-grok-client-version": "0.2.91",
						accept: "*/*",
						"user-agent": "grok-pager/0.2.91 grok-shell/0.2.91 (windows; amd64)",
					};
					const userId = firstText(
						entry.sub,
						entry.subject,
						entry.user_id,
						entry.userId,
						getPath(entry, ["metadata", "sub"]),
						getPath(entry, ["metadata", "user_id"]),
						getPath(entry, ["attributes", "sub"]),
					);
					if (userId !== "") headers["x-userid"] = userId;
					const [weeklyResult, monthlyResult] = await Promise.allSettled([
						apiCall(instance, { auth_index: authIndex, method: "GET", url: UPSTREAM.xaiBillingWeekly, header: headers }),
						apiCall(instance, { auth_index: authIndex, method: "GET", url: UPSTREAM.xaiBillingMonthly, header: headers }),
					]);
					const rows = new Map();
					const addBillingRows = (result, periodType) => {
						if (result.status !== "fulfilled") return;
						try {
							for (const row of parseXaiRows(unwrapNestedPayload(unwrapApiCall(result.value)), periodType)) rows.set(row.id, row);
						} catch {
							/* a 401/empty billing response falls through to paid health */
						}
					};
					addBillingRows(weeklyResult, "weekly");
					addBillingRows(monthlyResult, "monthly");
					account.windows = [...rows.values()];
					if (account.windows.length === 0) {
						try {
							account.windows = [await queryXaiPaidHealth(instance, authIndex, headers)];
							account.plan = account.plan || "paid";
						} catch (healthError) {
							if (weeklyResult.status === "rejected" && monthlyResult.status === "rejected") throw weeklyResult.reason ?? healthError;
						}
					}
				}
				// Other CLIProxyAPI providers still appear with account status and
				// recent request buckets even when their upstream has no quota API.
			} catch (error) {
				account.error = error instanceof Error ? error.message : String(error);
			}
			rememberPlan();
			return account;
		}

		async function refreshInstance(instance) {
			if (instance.managementKey === "") {
				return { state: "nokey", error: ZH ? "未配置 managementKey" : "management key not configured", accounts: [], fetchedAt: Date.now() };
			}
			const files = await fetchJSON(`${instance.base}/v0/management/auth-files`, {
				headers: { Authorization: `Bearer ${instance.managementKey}` },
			});
			const entries = Array.isArray(files?.files) ? files.files : [];
			// Best effort: pop the usage queue and fold it into the local ledger
			// (needs usage-statistics enabled in CPA; silently skipped otherwise).
			try {
				const statsEnabled = await usageStatsEnabledFor(instance, baseKey(instance.baseURL));
				shared.usageStatsByBase[baseKey(instance.baseURL)] = statsEnabled;
				if (statsEnabled !== false) await pollUsageEvents(instance, baseKey(instance.baseURL), entries);
			} catch {
				/* usage bookkeeping must never break the quota refresh */
			}
			const accounts = await pooledAll(entries
				.filter((entry) => entry !== null && typeof entry === "object"), ACCOUNT_PROBE_CONCURRENCY, (entry) => queryAccount(instance, entry));
			return { state: "ok", error: "", accounts, fetchedAt: Date.now() };
		}
		//#endregion

		//#region aggregation
		function modelFamily(modelId) {
			const lower = text(modelId).toLowerCase();
			if (lower === "") return "";
			if (/(?:grok|xai)/.test(lower)) return "xai";
			if (/(?:kimi|moonshot)/.test(lower)) return "kimi";
			if (/(?:qwen|qwq)/.test(lower)) return "qwen";
			if (/(?:iflow)/.test(lower)) return "iflow";
			if (/(?:glm|chatglm|zhipu)/.test(lower)) return "glm";
			if (/(?:deepseek)/.test(lower)) return "deepseek";
			if (/(?:gemini|gemma)/.test(lower)) return "gemini";
			if (/(?:claude|sonnet|opus|haiku|fable)/.test(lower)) return "claude";
			if (/(?:gpt|openai|codex)/.test(lower) || /(?:^|[-_:/.])o[1-4](?:$|[-_:/.])/.test(lower)) return "gpt";
			return "";
		}

		/**
		 * Second signal for the account filter: the DSH provider id that serves
		 * the model. Custom route names ("team-claude", "fast-tier") reveal
		 * nothing on their own, but the provider usually does.
		 */
		function providerFamilyFromId(providerId) {
			const p = text(providerId).toLowerCase();
			if (/(?:anthropic|claude)/.test(p)) return "claude";
			if (/(?:gemini)/.test(p)) return "gemini";
			if (/(?:codex|openai|gpt)/.test(p)) return "gpt";
			if (/(?:kimi|moonshot)/.test(p)) return "kimi";
			if (/(?:grok|xai)/.test(p)) return "xai";
			if (/(?:qwen)/.test(p)) return "qwen";
			if (/(?:iflow)/.test(p)) return "iflow";
			if (/(?:deepseek)/.test(p)) return "deepseek";
			if (/(?:glm|zai|zhipu)/.test(p)) return "glm";
			return "";
		}

		function modelSpecificWindows(account, modelId) {
			const lower = text(modelId).toLowerCase();
			if (lower === "") return [];
			const series = seriesKey(lower);
			const rows = Array.isArray(account.windows) ? account.windows : [];
			return rows.filter((row) => {
				if (row.modelId !== null) {
					const rowModel = text(row.modelId).toLowerCase();
					if (rowModel === lower || seriesKey(rowModel) === series) return true;
				}
				if (Array.isArray(row.modelIds) && row.modelIds.some((id) => {
					const candidate = text(id).toLowerCase();
					return candidate === lower || seriesKey(candidate) === series;
				})) return true;
				return Array.isArray(row.prefixes) && row.prefixes.some((prefix) => lower.startsWith(text(prefix).toLowerCase()));
			});
		}

		function providerMatchesFamily(provider, family) {
			if (family === "") return true;
			switch (provider) {
				case "antigravity": return ["gemini", "claude", "gpt"].includes(family);
				case "gemini":
				case "gemini-cli": return family === "gemini";
				case "claude": return family === "claude";
				case "codex":
				case "openai": return family === "gpt";
				case "kimi": return family === "kimi";
				case "xai": return family === "xai";
				case "qwen": return family === "qwen";
				case "iflow": return family === "iflow";
				case "glm": return family === "glm";
				case "deepseek": return family === "deepseek";
				case "vertex": return family === "gemini" || family === "claude";
				case "interactions": return ["gemini", "claude", "gpt"].includes(family);
				default: return false;
			}
		}

		/**
		 * Accounts whose served models match the selected one. `active` holds
		 * ONLY usage-verified accounts (the 24h ledger says CPA is rotating
		 * quota onto them); `others` holds registry/family candidates. Callers
		 * decide display: the tooltip pins actives and collapses others, the
		 * ring level aggregates both.
		 */
		function accountsForModelDetailed(accounts, modelId, providerHint = "", usage = null, activeOnly = true) {
			if (!Array.isArray(accounts)) return { active: [], others: [] };
			const usable = (list) => list.filter((account) => !account.disabled && !account.unavailable);

			// Tier 1 — in use right now (usage ledger, 24h window, loose model match).
			if (usage !== null && usage !== undefined && usage.activeNames.size > 0) {
				const act = usable(accounts)
					.filter((account) => usage.activeNames.has(account.name))
					.sort((x, y) => (usage.lastByAccount.get(y.name) ?? 0) - (usage.lastByAccount.get(x.name) ?? 0));
				for (const account of act) account.__usageActive = true;
				const rest = usable(accounts).filter((account) => !usage.activeNames.has(account.name));
				return { active: act, others: accountsFallback(rest, modelId, providerHint) };
			}

			let family = modelFamily(modelId);
			if (family === "") family = providerFamilyFromId(providerHint);
			const listed = accounts.filter((account) => Array.isArray(account.modelList) && account.modelList.length > 0);
			const exact = usable(listed).filter((account) => account.modelList.some((id) => modelListMatches(id, modelId)));
			if (exact.length > 0) return { active: [], others: exact };
			const unlisted = accounts.filter((account) => !(Array.isArray(account.modelList) && account.modelList.length > 0));

			if (family === "") return { active: [], others: usable(unlisted) };
			return { active: [], others: familyMatches(usable(unlisted), modelId, family) };
		}

		/** Registry-exact ∪ family candidates — the tier-2/3 fallback the
		 * "in use" tier folds its non-active accounts into. */
		function accountsFallback(accounts, modelId, providerHint) {
			let family = modelFamily(modelId);
			if (family === "") family = providerFamilyFromId(providerHint);
			const usable = (list) => list.filter((account) => !account.disabled && !account.unavailable);
			const listed = accounts.filter((account) => Array.isArray(account.modelList) && account.modelList.length > 0);
			const exact = usable(listed).filter((account) => account.modelList.some((id) => modelListMatches(id, modelId)));
			if (exact.length > 0) return exact;
			const unlisted = accounts.filter((account) => !(Array.isArray(account.modelList) && account.modelList.length > 0));
			if (family === "") return usable(unlisted);
			return familyMatches(usable(unlisted), modelId, family);
		}

		/** Registry-exact ∪ (specific-window ∪ generic family matches). */
		function familyMatches(list, modelId, family) {
			const specific = list.filter((account) => modelSpecificWindows(account, modelId).length > 0);
			const generic = list.filter((account) => {
				if (!providerMatchesFamily(account.provider, family)) return false;
				const rows = Array.isArray(account.windows) ? account.windows : [];
				// An account with model/prefix-tagged rows for another family must not
				// fall through as a generic provider account for this model.
				const hasTaggedRows = rows.some((row) => row.modelId !== null || Array.isArray(row.modelIds) || Array.isArray(row.prefixes));
				return !hasTaggedRows;
			});
			return [...specific, ...generic];
		}

		/** The ring aggregates actives when there are any, otherwise the
		 * registry/family candidates. */
		function accountsForModel(accounts, modelId, providerHint = "", usage = null) {
			const split = accountsForModelDetailed(accounts, modelId, providerHint, usage, true);
			return split.active.length > 0 ? split.active : split.others;
		}

		function modelRowsForAccount(account, modelId) {
			const rows = relevantWindows(account, modelId);
			const specific = modelSpecificWindows(account, modelId);
			return specific.length > 0 ? specific : rows;
		}

		function groupedRows(account, modelId = "") {
			const rows = modelRowsForAccount(account, modelId);
			const groups = new Map();
			for (const row of rows) {
				const fallback = row.modelId === null
					? { id: "__account", label: "", description: "" }
					: antigravityGroupForModel(row.modelId, row.label);
				const groupId = row.groupId || fallback.id;
				let group = groups.get(groupId);
				if (group === undefined) {
					group = {
						id: groupId,
						label: row.groupLabel || fallback.label,
						description: row.groupDescription || fallback.description,
						rows: [],
					};
					groups.set(groupId, group);
				}
				group.rows.push(row);
			}
			for (const group of groups.values()) {
				group.rows.sort((left, right) =>
					windowSortRank(left) - windowSortRank(right) ||
					left.label.localeCompare(right.label),
				);
			}
			return [...groups.values()];
		}

		function displayGroupDescription(value) {
			const raw = text(value);
			const match = raw.match(/^models within this group:\s*(.+)$/i);
			if (match !== null && ZH) return `此分组包含：${match[1].trim()}`;
			return raw;
		}

		/** Rows that govern the current model: account-level windows plus matching model rows. */
		function relevantWindows(account, modelId) {
			const rows = Array.isArray(account.windows) ? account.windows : [];
			const lower = text(modelId).toLowerCase();
			const series = seriesKey(lower);
			return rows.filter((w) => {
				if (modelId === "") return true;
				if (w.modelId === null) return w.prefixes === undefined || w.prefixes.some((prefix) => lower.startsWith(text(prefix).toLowerCase()));
				if (Array.isArray(w.modelIds) && w.modelIds.some((id) => {
					const candidate = text(id).toLowerCase();
					return candidate === lower || seriesKey(candidate) === series;
				})) return true;
				const rowModel = w.modelId.toLowerCase();
				return rowModel === lower || seriesKey(rowModel) === series;
			});
		}

			/** Ring level for one instance given the current model. */
			function levelFor(state, modelId, providerHint = "", usage = null) {
				if (state === undefined) return { level: "pending", remaining: null };
				if (state.state === "nokey") return { level: "pending", remaining: null };
				if (state.state === "error") return { level: "error", remaining: null };
				const matchingAccounts = accountsForModel(state.accounts, modelId, providerHint, usage);
			const rows = [];
			let enabledMatches = 0;
			for (const account of matchingAccounts) {
				if (account.disabled || account.unavailable) continue;
				enabledMatches += 1;
				for (const w of modelRowsForAccount(account, modelId)) rows.push(w);
			}
			// Every match disabled/unavailable with no other signal: gray is the
			// honest ring — "ok" (green) would promise quota that is not usable.
			if (rows.length === 0) return { level: enabledMatches > 0 ? "ok" : "pending", remaining: null };
			const quotaRows = rows.filter((row) => row.remainingPercent !== null);
			if (quotaRows.length === 0) return { level: "pending", remaining: null };
			// The ring represents one window. Prefer the shortest/most immediate
			// window exposed by the provider, then fall back to weekly/monthly.
			// Multiple accounts still aggregate conservatively within that window.
			const preferredRank = Math.min(...quotaRows.map(windowSortRank));
			const selectedRows = quotaRows.filter((row) => windowSortRank(row) === preferredRank);
			let min = 100;
			let exhausted = false;
			for (const row of selectedRows) {
				if (row.remainingPercent < min) min = row.remainingPercent;
				if (row.exhausted || row.remainingPercent <= 0) exhausted = true;
			}
			if (exhausted) return { level: "exhausted", remaining: min };
			if (min < LOW_PCT) return { level: "low", remaining: min };
			return { level: "ok", remaining: min };
		}

		const LEVEL_COLOR = {
			ok: "var(--dsw-alias-state-success-primary, #22c55e)",
			low: "#f59e0b",
			exhausted: "#ef4444",
			error: "#ef4444",
			pending: "var(--dsw-alias-label-disabled, #9ca3af)",
		};
		//#endregion

		//#region CSS
		function styleText() {
			return `
[${DOT_ATTR}]{box-sizing:border-box;display:grid;place-items:center;position:absolute;flex:none;width:28px;height:28px;padding:0;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid transparent;border-radius:999px;pointer-events:auto;cursor:pointer;z-index:1;transition:background-color .12s,border-color .12s}
[${DOT_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.14));backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
[${DOT_ATTR}] svg{display:block;flex:none;width:14px;height:14px;pointer-events:none}
[${DOT_ATTR}] .cpa-q-track{fill:none;stroke:var(--dsw-alias-border-l3,rgba(127,127,127,.4));stroke-width:2px}
[${DOT_ATTR}] .cpa-q-arc{fill:none;stroke:var(--dsw-alias-state-success-primary,#22c55e);stroke-width:2px;stroke-linecap:butt}
[${TIP_ATTR}]{position:fixed;z-index:9999;max-width:360px;min-width:230px;max-height:min(70vh,560px);overflow-y:auto;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#20242b);box-shadow:0 8px 28px rgba(0,0,0,.35);padding:10px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#e8eaed);pointer-events:auto}
[${TIP_ATTR}] .cpa-q-acc{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));padding:6px 0 2px}
[${TIP_ATTR}] .cpa-q-acc:first-child{border-top:none;padding-top:0}
[${TIP_ATTR}] .cpa-q-acc-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
[${TIP_ATTR}] .cpa-q-acc-name{font-weight:500;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[${TIP_ATTR}] .cpa-q-plan{margin-left:auto}
[${TIP_ATTR}] .cpa-q-group-head{border-top:1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.18));padding:8px 0 3px}
[${TIP_ATTR}] .cpa-q-group-head:first-child{border-top:none;padding-top:2px}
[${TIP_ATTR}] .cpa-q-group-label{color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
[${TIP_ATTR}] .cpa-q-group-desc{color:var(--dsw-alias-label-caption,#9aa0a6);font-size:11px;line-height:16px;margin-top:1px}
[${TIP_ATTR}] .cpa-q-badge{font-size:10.5px;line-height:14px;padding:0 6px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-caption,#9aa0a6);white-space:nowrap}
[${TIP_ATTR}] .cpa-q-badge.ok{color:var(--dsw-alias-state-success-primary,#22c55e);border-color:currentColor}
[${TIP_ATTR}] .cpa-q-badge.bad{color:#ef4444;border-color:currentColor}
[${TIP_ATTR}] .cpa-q-row{display:flex;justify-content:space-between;gap:10px;color:var(--dsw-alias-label-secondary,#c4c7cb);padding:1px 0}
[${TIP_ATTR}] .cpa-q-row .cpa-q-win-label{white-space:nowrap}
[${TIP_ATTR}] .cpa-q-row .cpa-q-win-val{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
[${TIP_ATTR}] .cpa-q-rowbar{height:4px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.2));margin:3px 0 5px;overflow:hidden}
[${TIP_ATTR}] .cpa-q-rowbar>i{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-state-success-primary,#22c55e)}
[${TIP_ATTR}] .cpa-q-err{color:#f87171;padding:2px 0}
[${TIP_ATTR}] .cpa-q-hint{color:var(--dsw-alias-label-caption,#9aa0a6);font-size:11px;padding:2px 0}
.cpa-q-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;flex-direction:column;padding:14px 16px;display:flex;gap:12px;color:var(--dsw-alias-label-primary)}
.cpa-q-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.cpa-q-card-toggle{display:flex;width:100%;align-items:center;justify-content:space-between;gap:16px;background:transparent;border:0;margin:0;padding:0;font:inherit;line-height:inherit;color:inherit;text-align:left;cursor:pointer}
.cpa-q-card-toggle:focus-visible{outline:2px solid var(--dsw-alias-border-l3);outline-offset:4px;border-radius:6px}
.cpa-q-card-heading{display:flex;align-items:flex-start;gap:10px;min-width:0}
.cpa-q-card-chevron{flex:none;display:grid;place-items:center;color:var(--dsw-alias-label-tertiary,#9aa0a6);transition:transform .14s ease}
.cpa-q-card-chevron[data-open="true"]{transform:rotate(180deg)}
.cpa-q-card-body{display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--dsw-alias-border-l2);margin-top:12px;padding-top:12px}
.cpa-q-card-head{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}
.cpa-q-card-title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.cpa-q-card-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.cpa-q-refresh-control{display:flex;align-items:center;gap:8px;flex:none;white-space:nowrap}
.cpa-q-refresh-label{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;white-space:nowrap}
.cpa-q-refresh-status{border-top:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;padding-top:8px;display:flex}
.cpa-q-refresh-age{color:var(--dsw-alias-label-secondary);white-space:nowrap}
.cpa-q-refresh-next{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);margin-left:auto;white-space:nowrap}
.cpa-q-refresh-now{height:28px;margin-left:4px;padding:0 10px}
.cpa-q-inst{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;transition:border-color .16s,background .16s}
.cpa-q-inst:hover{border-color:var(--dsw-alias-label-dimmed)}
.cpa-q-inst-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cpa-q-inst-host{font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary)}
.cpa-q-inst-note{font-size:11px;color:var(--dsw-alias-label-caption)}
.cpa-q-inst .cpa-q-badge{font-size:11px;font-weight:500;line-height:17px;padding:1px 8px;border:0;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.cpa-q-inst .cpa-q-badge.ok{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-bg-module-platform)}
.cpa-q-inst .cpa-q-badge.bad{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-module-platform)}
.cpa-q-input{height:32px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:0 10px;font-size:12px;min-width:0;flex:1}
.cpa-q-input:focus{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.cpa-q-btn{height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);padding:0 12px;font-size:12px;cursor:pointer;white-space:nowrap}
.cpa-q-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.cpa-q-btn.primary{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-border-l2)}
.cpa-q-select{box-sizing:border-box;height:32px;min-width:104px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;padding:0 8px;color-scheme:light dark}
body[data-ds-dark-theme] .cpa-q-select{color-scheme:dark}
.cpa-q-toggle-row{align-items:center}
.cpa-q-toggle-row input[type="checkbox"]{accent-color:var(--dsw-alias-state-success-primary,#22c55e);margin:0 2px}
.cpa-q-toggle-row{color:var(--dsw-alias-label-secondary,#c4c7cb);font-size:12px}
.cpa-q-badge.cpa-q-active{color:var(--dsw-alias-state-success-primary,#22c55e);border-color:currentColor}
.cpa-q-usage-line{color:var(--dsw-alias-label-caption,#9aa0a6);font-size:11px;line-height:16px;margin-top:2px}
.cpa-q-others-head{cursor:pointer;color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:11px;font-weight:600;letter-spacing:.06em;padding:6px 0 2px;user-select:none}
.cpa-q-others-head:hover{color:var(--dsw-alias-label-secondary,#c4c7cb)}
.cpa-q-others-body{border-top:1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.18));margin-top:4px;padding-top:4px}
.cpa-q-select option{background:var(--dsw-alias-bg-layer-2,#303136);color:var(--dsw-alias-label-primary,#e8eaed)}
.cpa-q-accounts-slot{display:contents}
.cpa-q-accounts{box-sizing:border-box;max-height:340px;overflow-y:auto;overscroll-behavior:contain;border-top:1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.18));margin-top:2px;padding:6px 2px 0;display:flex;flex-direction:column;gap:2px}
.cpa-q-accounts-note{color:var(--dsw-alias-label-caption,#9aa0a6);font-size:11px;line-height:17px;padding:2px 0}
.cpa-q-accounts-error{color:#f87171;font-size:12px;line-height:18px;padding:2px 0}
/* Account rows reuse the tooltip's markup inside the settings card, so the
   same rules are mirrored under this container (emitted last to win the tie
   against the compact .cpa-q-inst badge styles above). */
.cpa-q-accounts .cpa-q-acc{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));padding:6px 0 2px}
.cpa-q-accounts .cpa-q-acc:first-child{border-top:none;padding-top:0}
.cpa-q-accounts .cpa-q-acc-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.cpa-q-accounts .cpa-q-acc-name{font-weight:500;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cpa-q-accounts .cpa-q-plan{margin-left:auto}
.cpa-q-accounts .cpa-q-group-head{border-top:1px dashed var(--dsw-alias-border-l1,rgba(127,127,127,.18));padding:8px 0 3px}
.cpa-q-accounts .cpa-q-group-head:first-child{border-top:none;padding-top:2px}
.cpa-q-accounts .cpa-q-group-label{color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.cpa-q-accounts .cpa-q-group-desc{color:var(--dsw-alias-label-caption,#9aa0a6);font-size:11px;line-height:16px;margin-top:1px}
.cpa-q-accounts .cpa-q-badge{font-size:10.5px;line-height:14px;padding:0 6px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));color:var(--dsw-alias-label-caption,#9aa0a6);white-space:nowrap}
.cpa-q-accounts .cpa-q-badge.ok{color:var(--dsw-alias-state-success-primary,#22c55e);border-color:currentColor}
.cpa-q-accounts .cpa-q-badge.bad{color:#ef4444;border-color:currentColor}
.cpa-q-accounts .cpa-q-row{display:flex;justify-content:space-between;gap:10px;color:var(--dsw-alias-label-secondary,#c4c7cb);padding:1px 0}
.cpa-q-accounts .cpa-q-row .cpa-q-win-label{white-space:nowrap}
.cpa-q-accounts .cpa-q-row .cpa-q-win-val{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
.cpa-q-accounts .cpa-q-rowbar{height:4px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.2));margin:3px 0 5px;overflow:hidden}
.cpa-q-accounts .cpa-q-rowbar>i{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-state-success-primary,#22c55e)}
.cpa-q-accounts .cpa-q-err{color:#f87171;padding:2px 0}
.cpa-q-accounts .cpa-q-hint{color:var(--dsw-alias-label-caption,#9aa0a6);font-size:11px;padding:2px 0}
`;
		}
		//#endregion

		//#region tooltip render helpers
		function pctText(value) {
			return value === null ? "--" : `${Math.round(value)}%`;
		}

		function windowRowText(window) {
			const reset = window.resetLabel !== "" && window.resetLabel !== "可用" && window.resetLabel !== "available"
				? ` · ${window.resetLabel}`
				: "";
			return window.remainingPercent === null
				? (ZH ? "无数据" : "no data")
				: `${window.remainingPercent >= 100 ? (ZH ? "额度可用" : "quota available") : pctText(window.remainingPercent)}${reset}`;
		}

		function el(tag, className, textContent) {
			const node = document.createElement(tag);
			if (className !== undefined && className !== "") node.className = className;
			if (textContent !== undefined) node.textContent = textContent;
			return node;
		}

		function appendQuotaRow(section, rowData) {
			const row = el("div", "cpa-q-row");
			row.appendChild(el("span", "cpa-q-win-label", rowData.label));
			row.appendChild(el("span", "cpa-q-win-val", windowRowText(rowData)));
			section.appendChild(row);
			const remaining = rowData.remainingPercent;
			const bar = el("div", "cpa-q-rowbar");
			const fill = el("i");
			if (remaining !== null) {
				fill.style.width = clampPct(remaining) + "%";
				fill.style.background = remaining <= 0 ? LEVEL_COLOR.exhausted : remaining < LOW_PCT ? LEVEL_COLOR.low : LEVEL_COLOR.ok;
			} else if (rowData.usedPercent !== null) {
				fill.style.width = clampPct(100 - rowData.usedPercent) + "%";
				fill.style.background = LEVEL_COLOR.ok;
			} else {
				fill.style.width = "0%";
			}
			bar.appendChild(fill);
			section.appendChild(bar);
		}
		//#endregion

		//#region settings card (Settings → Plugins → CliProxyAPI Quota)
		const h = react.createElement;

		/**
		 * One account's quota card: header (name, provider, status, plan) plus
		 * its quota window rows. Shared by the hover tooltip and the settings
		 * card's all-accounts panel; `modelId === ""` renders every window.
		 */
		function accountSection(account, modelId, usageInfo = null) {
			const section = el("div", "cpa-q-acc");
			const head = el("div", "cpa-q-acc-head");
			head.appendChild(el("span", "cpa-q-acc-name", account.name));
			head.appendChild(el("span", "cpa-q-badge", PROVIDER_LABELS[account.provider] ?? account.provider));
			if (usageInfo !== null && usageInfo.active === true) head.appendChild(el("span", "cpa-q-badge cpa-q-active", ZH ? "使用中" : "in use"));
			if (account.disabled) head.appendChild(el("span", "cpa-q-badge bad", ZH ? "已禁用" : "disabled"));
			else if (account.unavailable) head.appendChild(el("span", "cpa-q-badge bad", ZH ? "不可用" : "unavailable"));
			else if (account.status !== "" && account.status !== "available") head.appendChild(el("span", "cpa-q-badge", account.status));
			else if (account.error === "") head.appendChild(el("span", "cpa-q-badge ok", ZH ? "可用" : "available"));
			if (account.plan !== "") {
				const plan = planLabel(account.plan);
				head.appendChild(el("span", "cpa-q-badge cpa-q-plan", plan));
			}
			section.appendChild(head);

			if (account.error !== "") {
				section.appendChild(el("div", "cpa-q-err", account.error));
				return section;
			}

			let rendered = false;
			for (const group of groupedRows(account, modelId)) {
				if (group.label !== "") {
					const groupHead = el("div", "cpa-q-group-head");
					groupHead.appendChild(el("div", "cpa-q-group-label", group.label));
					const description = displayGroupDescription(group.description);
					if (description !== "") groupHead.appendChild(el("div", "cpa-q-group-desc", description));
					section.appendChild(groupHead);
				}
				for (const row of group.rows) {
					appendQuotaRow(section, row);
					rendered = true;
				}
			}

			if (!rendered && account.recent !== null && (account.recent.h5 > 0 || account.recent.d7 > 0)) {
				for (const [label, count] of [[ZH ? "5小时窗口" : "5-hour window", account.recent.h5], [ZH ? "7天窗口" : "7-day window", account.recent.d7]]) {
					const row = el("div", "cpa-q-row");
					row.appendChild(el("span", "cpa-q-win-label", label));
					row.appendChild(el("span", "cpa-q-win-val", ZH ? `${count} 次请求` : `${count} requests`));
					section.appendChild(row);
				}
				rendered = true;
			}
				if (!rendered) {
					section.appendChild(el("div", "cpa-q-row", ZH ? "该厂商无额度查询接口" : "no quota probe for this provider"));
				}
				if (usageInfo !== null && (usageInfo.active === true || usageInfo.count > 0)) {
					const parts = [ZH ? `近24h ${usageInfo.count} 次` : `24h: ${usageInfo.count} req`];
					if (usageInfo.tokens > 0) parts.push(fmtTokensCompact(usageInfo.tokens) + (ZH ? " tokens" : " tok"));
					if (usageInfo.lastTs > 0) parts.push(usageLastUsedText(usageInfo.lastTs));
					section.appendChild(el("div", "cpa-q-usage-line", parts.join(" · ")));
				}
				return section;
			}

		/**
		 * The settings card's all-accounts panel for one instance, mirroring the
		 * CPA management center: every account with all of its quota windows
		 * (no model filter), so the whole deployment is readable in one place.
		 */
		function instanceAccountsPanel(instanceKey, quota) {
			if (quota === undefined || quota.state === "nokey") {
				return el("div", "cpa-q-accounts-note", ZH
					? "填入 management key 后，这里会像 CPA 管理页一样列出该实例全部账号的额度窗口。"
					: "Paste the management key and every account's quota windows will be listed here, like CPA's management center.");
			}
			if (quota.state === "error") {
				return el("div", "cpa-q-accounts cpa-q-accounts-error", quota.error);
			}
			if (!Array.isArray(quota.accounts) || quota.accounts.length === 0) {
				return el("div", "cpa-q-accounts-note", ZH ? "该实例没有账号（auth-files 为空）。" : "no auth files on this instance.");
			}
			const panel = el("div", "cpa-q-accounts");
			panel.dataset.cpaAccounts = instanceKey;
			for (const account of quota.accounts) panel.appendChild(accountSection(account, ""));
			return panel;
		}

		/**
		 * React bridge for the shared DOM account renderer: accountSection (and
		 * the tooltip) build real DOM nodes, so the settings card mounts them
		 * through a ref instead of duplicating the markup in JSX. The node is
		 * memoized on the quota snapshot's identity — the card re-renders every
		 * second for the refresh clock, and rebuilding here each tick would reset
		 * the panel's scroll position while browsing many accounts.
		 */
		function DomSlot({ instanceKey, quota }) {
			const ref = react.useRef(null);
			const node = react.useMemo(() => instanceAccountsPanel(instanceKey, quota), [instanceKey, quota]);
			react.useEffect(() => {
				const host = ref.current;
				if (host === null || node === null) return undefined;
				host.replaceChildren(node);
				return () => {
					node.remove();
				};
			}, [node]);
			return h("div", { ref, className: "cpa-q-accounts-slot" });
		}
		//#endregion settings card

		function instanceStatus(instance) {
			const key = baseKey(instance.baseURL);
			const quota = quotaByKey.get(key);
			const probe = discoveredByKey.get(key);
			if (quota?.state === "ok") {
				return { tone: "ok", text: ZH ? `可用 · ${quota.accounts.length} 个账号` : `ok · ${quota.accounts.length} account(s)` };
			}
			if (quota?.state === "error") {
				if (/\b401\b|invalid management/i.test(quota.error)) return { tone: "bad", text: ZH ? "管理密钥无效" : "invalid management key" };
				return { tone: "bad", text: quota.error.slice(0, 80) };
			}
			if (quota?.state === "nokey") return { tone: "", text: ZH ? "未配置密钥" : "key not set" };
			if (probe?.verdict === "unreachable") return { tone: "bad", text: ZH ? "无法连接" : "unreachable" };
			if (probe?.verdict === "no") return { tone: "", text: ZH ? "未检测到管理 API（非 CliProxyAPI 或未启用）" : "no management API detected (not CPA, or disabled)" };
			return { tone: "", text: ZH ? "待检测/加载中" : "probing/loading" };
		}

		function saveLocalInstances(rows, refreshMinutes, usageWindowMinutes) {
			writeLocalConfig({
				instances: rows
					.filter((row) => row.baseURL !== "")
					.map((row) => ({ baseURL: row.baseURL, managementKey: row.key })),
				...(refreshMinutes !== undefined ? { refreshMinutes } : {}),
				...(usageWindowMinutes !== undefined ? { usageWindowMinutes } : {}),
			});
		}

		function QuotaSettingsCard() {
			const [, force] = react.useReducer((n) => n + 1, 0);
			const [clock, setClock] = react.useState(() => Date.now());
			const [open, setOpen] = react.useState(false);
			react.useEffect(() => {
				const onUpdate = () => force();
				window.addEventListener(EV_UPDATED, onUpdate);
				window.addEventListener(EV_CONFIG, onUpdate);
				// The 1s clock only matters while the card is expanded (the refresh
				// age/next labels); collapsed, it would just burn re-renders.
				const ticker = open ? window.setInterval(() => setClock(Date.now()), 1000) : 0;
				return () => {
					window.removeEventListener(EV_UPDATED, onUpdate);
					window.removeEventListener(EV_CONFIG, onUpdate);
					if (ticker !== 0) window.clearInterval(ticker);
				};
			}, [open]);

			// Rows = configured instances (yaml+local merged) ∪ discovered-CPA provider baseURLs.
			const config = readConfig();
			const rows = config.instances.map((instance) => ({
					baseURL: instance.baseURL,
					key: instance.managementKey,
					manual: instance.source === "local",
					discovered: false,
				}));
			for (const [key, info] of discoveredByKey) {
				if (info.cpa && !rows.some((row) => baseKey(row.baseURL) === key)) {
					rows.push({ baseURL: info.baseURL, key: "", manual: false, discovered: true });
				}
			}
			const [drafts, setDrafts] = react.useState({});
			const draftOf = (key) => drafts[key] ?? {};
			const setDraft = (key, patch) => setDrafts((prev) => ({ ...prev, [key]: { ...draftOf(key), ...patch } }));
			// A draft exists only once the user types; untouched rows keep their stored key.
			const keyOf = (row) => draftOf(baseKey(row.baseURL)).keyText ?? row.key ?? "";

			const commit = (rows) => {
				// Discovered rows ride along saves; persisting them with an empty key
				// only bloats localStorage — they re-discover on their own.
				saveLocalInstances(rows
					.filter((r) => !(r.discovered === true && keyOf(r) === ""))
					.map((r) => ({ baseURL: r.baseURL, key: keyOf(r) })), undefined);
			};
			const saveRow = (row) => commit(rows);
			const removeRow = (row) => {
				commit(rows.filter((r) => baseKey(r.baseURL) !== baseKey(row.baseURL)));
			};
			const addDraftRow = () => {
				const draft = draftOf("__new");
				if (draft.baseURL === "") return;
				commit([...rows, { baseURL: draft.baseURL, key: draft.keyText ?? "" }]);
				setDrafts((prev) => ({ ...prev, __new: { baseURL: "" } }));
			};
			const setRefresh = (minutes) => {
				saveLocalInstances(rows.map((r) => ({ baseURL: r.baseURL, key: keyOf(r) })), minutes);
			};
			const setUsageWindow = (minutes) => {
				saveLocalInstances(rows.map((r) => ({ baseURL: r.baseURL, key: keyOf(r) })), undefined, minutes);
			};

			// Collapsed by default, mirroring the built-in plugin cards: a
			// title/description header toggles the settings and the per-account
			// quota panel.
			const chevron = h("span", { className: "cpa-q-card-chevron", "data-open": String(open), "aria-hidden": true },
				h("svg", { viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": true },
					h("path", {
						d: "M3.5 6l4.5 4.5L12.5 6",
						fill: "none",
						stroke: "currentColor",
						strokeWidth: "1.5",
						strokeLinecap: "round",
						strokeLinejoin: "round",
					}),
				),
			);

			return h("div", { className: "cpa-q-card" },
				h("button", {
					type: "button",
					className: "cpa-q-card-toggle",
					"aria-expanded": open,
					onClick: () => setOpen((v) => !v),
				},
					h("div", { className: "cpa-q-card-heading" },
						h("div", null,
							h("div", { className: "cpa-q-card-title" }, ZH ? "CliProxyAPI 额度" : "CliProxyAPI Quota"),
							h("div", { className: "cpa-q-card-desc" },
								ZH
									? "自动检测 DSH 提供方 baseURL 中的 CliProxyAPI 实例；填入管理密钥后，模型名左侧的圆点会显示各厂商的 5 小时 / 每周 / 每月额度。"
									: "CliProxyAPI instances are auto-detected from your DSH provider baseURLs. Paste each instance's management key and the dot left of the model name shows provider-specific 5-hour / weekly / monthly quota windows."),
						),
					),
					chevron,
				),
				open ? h("div", { className: "cpa-q-card-body" },
					h("div", { className: "cpa-q-refresh-control", style: { alignSelf: "flex-end" } },
						h("span", { className: "cpa-q-refresh-label" }, ZH ? "刷新间隔" : "refresh"),
						h("select", {
							className: "cpa-q-select",
							value: String(config.refreshMinutes),
							onChange: (event) => setRefresh(Number(event.target.value)),
						},
							h("option", { value: "1" }, ZH ? "1 分钟（近实时）" : "1 min (near real-time)"),
							h("option", { value: "5" }, "5 min"),
							h("option", { value: "10" }, "10 min"),
							h("option", { value: "30" }, "30 min"),
							h("option", { value: "60" }, "60 min"),
						),
						h("span", { className: "cpa-q-refresh-label" }, ZH ? "使用中窗口" : "in-use window"),
						h("select", {
							className: "cpa-q-select",
							value: String(config.usageWindowMinutes),
							onChange: (event) => setUsageWindow(Number(event.target.value)),
						},
							h("option", { value: "30" }, ZH ? "30 分钟" : "30 min"),
							h("option", { value: "360" }, ZH ? "6 小时" : "6 h"),
							h("option", { value: "1440" }, ZH ? "24 小时" : "24 h"),
							h("option", { value: "10080" }, ZH ? "7 天" : "7 days"),
						),
					),
					h("div", { className: "cpa-q-refresh-status" },
						h("span", { className: "cpa-q-refresh-age" }, fmtRefreshAge(clock)),
						h("span", { className: "cpa-q-refresh-next" }, fmtNextRefresh(clock)),
						h("button", {
							className: "cpa-q-btn cpa-q-refresh-now",
							onClick: () => window.dispatchEvent(new CustomEvent(EV_REFRESH)),
						}, ZH ? "立即刷新" : "refresh now"),
					),
					h("div", { className: "cpa-q-inst-row cpa-q-toggle-row" },
						h("input", {
							type: "checkbox",
							checked: usageActiveOnly(),
							onChange: (event) => {
								try {
									window.localStorage.setItem(LS_ACTIVE_ONLY, event.target.checked ? "1" : "0");
								} catch {
									/* storage off — toggle stays session-only */
								}
								window.dispatchEvent(new CustomEvent(EV_CONFIG));
							},
						}),
						ZH ? "只显示使用中的账号（使用中窗口内用过当前模型）" : "Only show accounts that served the current model within the in-use window"),
					...rows.map((row) => {
						const key = baseKey(row.baseURL);
						const status = instanceStatus(row);
						return h("div", { className: "cpa-q-inst", key: key },
						h("div", { className: "cpa-q-inst-row" },
							h("span", { className: "cpa-q-inst-host", title: row.baseURL }, hostOf(row.baseURL)),
							h("span", { className: `cpa-q-badge ${status.tone}`, title: status.text }, status.text),
							shared.usageStatsByBase[key] === false ? h("span", { className: "cpa-q-inst-note", title: ZH ? "CPA 配置中开启 usage-statistics 后，可识别使用中的账号" : "Enable usage-statistics in CPA to identify accounts in use" }, ZH ? "用量统计未开启" : "usage stats off") : null,
							shared.usageStatsByBase[key] === false && keyOf(row) !== "" ? h("button", {
								className: "cpa-q-btn",
								title: ZH ? "一键写入 CPA 配置：usage-statistics-enabled = true" : "Writes usage-statistics-enabled = true into the CPA config",
								onClick: () => {
									enableUsageStats({ baseURL: row.baseURL, managementKey: keyOf(row) }).then(() => {
										window.dispatchEvent(new CustomEvent(EV_CONFIG));
									});
								},
							}, ZH ? "开启" : "enable") : null,
							row.discovered ? h("span", { className: "cpa-q-inst-note" }, ZH ? "自动发现" : "auto-detected") : null,
							row.manual ? h("button", { className: "cpa-q-btn", onClick: () => removeRow(row) }, ZH ? "移除" : "remove") : null,
						),
							h("div", { className: "cpa-q-inst-row" },
							h("input", {
								className: "cpa-q-input",
								type: "password",
								placeholder: ZH ? "management key（仅存本浏览器 localStorage）" : "management key (stored in this browser's localStorage only)",
								value: draftOf(key).keyText ?? row.key ?? "",
								onChange: (event) => setDraft(key, { keyText: event.target.value }),
								onBlur: () => saveRow(row),
							}),
								h("button", { className: "cpa-q-btn primary", onClick: () => saveRow(row) }, ZH ? "保存" : "save"),
							),
							h(DomSlot, { instanceKey: key, quota: quotaByKey.get(key) }),
						);
					}),
					shared.probing ? h("div", { className: "cpa-q-inst-note" }, ZH ? "正在检测提供方 baseURL…" : "probing provider baseURLs…") : null,
					h("div", { className: "cpa-q-inst-row" },
						h("input", {
							className: "cpa-q-input",
							placeholder: ZH ? "手动添加实例 baseURL（可选）" : "add an instance baseURL manually (optional)",
							value: draftOf("__new").baseURL,
							onChange: (event) => setDraft("__new", { baseURL: event.target.value }),
						}),
						h("button", { className: "cpa-q-btn", onClick: addDraftRow }, ZH ? "添加" : "add"),
					),
					h("div", { className: "cpa-q-inst-row" },
						h("button", {
							className: "cpa-q-btn",
							title: ZH ? "把实例与密钥导出为 JSON 文件（明文，注意保管）" : "export instances and keys as a JSON file (plaintext — keep it safe)",
							onClick: () => {
								const blob = new Blob([JSON.stringify(readLocalConfig(), null, 2)], { type: "application/json" });
								const url = URL.createObjectURL(blob);
								const anchor = document.createElement("a");
								anchor.href = url;
								anchor.download = "dsh-cpa-quota-config.json";
								anchor.click();
								window.setTimeout(() => URL.revokeObjectURL(url), 1000);
							},
						}, ZH ? "导出配置" : "export config"),
						h("button", {
							className: "cpa-q-btn",
							title: ZH ? "从 JSON 文件导入实例与密钥（覆盖现有配置）" : "import instances and keys from a JSON file (replaces the current config)",
							onClick: (event) => {
								const picker = document.createElement("input");
								picker.type = "file";
								picker.accept = "application/json,.json";
								picker.onchange = () => {
									const file = picker.files && picker.files[0];
									if (file === undefined || file === null) return;
									const reader = new FileReader();
									reader.onload = () => {
										try {
											const imported = parseImportedConfig(String(reader.result));
											saveLocalInstances(imported.instances.map((i) => ({ baseURL: i.baseURL, key: i.managementKey })), imported.refreshMinutes);
										} catch (error) {
											window.setTimeout(() => { throw error instanceof Error ? error : new Error(String(error)); }, 0);
										}
									};
									reader.readAsText(file);
								};
								picker.click();
							},
						}, ZH ? "导入配置" : "import config"),
					),
					h("div", { className: "cpa-q-card-desc" },
						ZH
							? "圆点颜色：绿 ≥20% 剩余 · 黄 <20% · 红 已耗尽 · 灰 加载中/未配置。密钥与设置仅保存在本浏览器；额度请求由浏览器直达对应实例。"
							: "Dot colors: green ≥20% remaining · amber <20% · red exhausted · gray loading/not configured. Keys and settings stay in this browser; quota requests go straight from the browser to each instance."),
				) : null,
			);
		}
		//#endregion

		//#region plugin body
		// 'connection' carries the RPC face on dsh ≤0.1.1 (rc.x); 'slots' is
		// required before ctx.slots is readable on the proxy context. dsh 0.1.2
		// removed ConnectionHandle.api and serves the same calls from the
		// gateway's remote namespace services, which mount asynchronously once
		// the host contributes its API — declaring them (exactly what the
		// built-in settings plugins declare) makes the runner hold apply() until
		// they are usable on both dsh generations.
		const inject = ["connection", "slots", "remote", "remote.llm", "remote.settings"];

		function apply(ctx, configArg) {
			// NB: never touch ctx.config — the cordis context proxy throws on
			// uninjected properties; plugin config arrives via this argument only.
			let config = readConfig(configArg);
			let refreshMs = config.refreshMinutes * 60 * 1000;
			// The in-use window is independent of the refresh interval: it decides
			// how long an account stays "in use" after serving the model.
			usageWindowMs = config.usageWindowMinutes * 60 * 1000;

			/** model label/id (lowercased) → { baseURL, modelId, providerId } */
			let modelIndex = new Map();
			/** baseKey → { baseURL, providerId } from the llm provider directory */
			let providerBases = new Map();
			/** baseKey → instance (configured ∪ discovered CPA) */
			let instanceByKey = new Map();
			let modelIndexAt = 0;
			let refreshing = false;
			let indexReloadQueued = false;
			let disposed = false;
			let quotaTimer = 0;

			const styleTag = document.createElement("style");
			styleTag.dataset.plugin = "dsh-client-ui-cpa-quota";
			styleTag.textContent = styleText();
			document.head.appendChild(styleTag);

			let tip = null;
			let tipHideTimer = 0;
			let tipAnchor = null;

			function rebuildInstances() {
				const merged = new Map();
				for (const instance of config.instances) {
					const key = baseKey(instance.baseURL);
					const verdict = discoveredByKey.get(key);
					// A configured base is only quota-enabled after its management
					// endpoint confirms that it is actually CliProxyAPI. A manually
					// entered base that is not present in the provider directory has
					// no probe target and remains trusted for backwards compatibility.
					if (key !== "" && (verdict === undefined || verdict.cpa === true)) merged.set(key, instance);
				}
				// Auto-detected CPA instances the user has not configured yet join keyless.
				for (const [key, info] of discoveredByKey) {
					if (!info.cpa || merged.has(key)) continue;
					merged.set(key, { baseURL: info.baseURL, base: mgmtBase(info.baseURL), managementKey: "", manual: false });
				}
				instanceByKey = merged;
				shared.instances = [...merged.values()];
				// Retire quota snapshots of instances that left the directory/config.
				for (const cachedKey of [...quotaByKey.keys()]) {
					if (!merged.has(cachedKey)) quotaByKey.delete(cachedKey);
				}
			}

			function restartQuotaTimer() {
				if (quotaTimer !== 0) window.clearInterval(quotaTimer);
				quotaTimer = disposed ? 0 : window.setInterval(() => void refreshQuota(), refreshMs);
			}

			function applyConfig(next) {
				config = next;
				refreshMs = config.refreshMinutes * 60 * 1000;
				usageWindowMs = config.usageWindowMinutes * 60 * 1000;
				rebuildInstances();
				scheduleDecorate();
				restartQuotaTimer();
				void refreshQuota();
			}

			function instanceFor(baseURL) {
				const key = baseKey(baseURL);
				return instanceByKey.get(key);
			}

			/**
			 * The RPC face moved between dsh generations: rc.x exposes it as
			 * `ConnectionHandle.api`, 0.1.2 removed `.api` and serves the same
			 * calls from `remote.llm` / `remote.settings`. Returns whichever is
			 * available, or null when neither is (loadModelIndex turns that into
			 * a normal failure and the caller keeps its last-good index).
			 */
			function rpcFace() {
				try {
					const connection = ctx.get("connection");
					if (connection?.api !== undefined) return connection.api;
				} catch { /* connection service not available on this host */ }
				try {
					const llm = ctx.get("remote.llm");
					const settings = ctx.get("remote.settings");
					if (llm !== undefined && settings !== undefined) return { llm, settings };
				} catch { /* remote namespaces not mounted on this host */ }
				return null;
			}

			async function refreshModelIndex(forceProbe = false) {
				try {
					const loaded = await loadModelIndex(rpcFace());
					// A React/provider transition can briefly expose an empty directory.
					// Keep the last-good snapshot so existing rings remain resolvable.
					if (loaded.index.size > 0 || loaded.providerBases.size > 0) {
						modelIndex = loaded.index;
						providerBases = loaded.providerBases;
						modelIndexAt = Date.now();
					}
				} catch {
					/* keep the last good index; the DOM pass keeps using it */
				}
				if (disposed) return;
				rebuildInstances();
				// "Refresh now" also re-fingerprints every provider base: a stale
				// negative verdict (server briefly down, management API just enabled)
				// would otherwise keep hiding a real CPA instance for up to an hour.
				await probeProviderBases(providerBases, forceProbe);
				if (disposed) return;
				rebuildInstances();
				scheduleDecorate();
			}

			async function refreshQuota() {
				if (refreshing || disposed) return;
				refreshing = true;
				shared.refreshing = true;
				shared.nextRefreshAt = Date.now() + refreshMs;
				try {
					const targets = [...instanceByKey.values()];
					await Promise.all(targets.map(async (instance) => {
						const key = baseKey(instance.baseURL);
						// An empty key is always "not configured" — even when the
						// instance row was persisted (e.g. a discovered row that rode
						// along an unrelated save); hitting the management API without
						// it would only produce a raw 401.
						if (instance.managementKey === "") {
							quotaByKey.set(key, { state: "nokey", error: ZH ? "未配置 managementKey" : "management key not configured", accounts: [], fetchedAt: Date.now() });
							return;
						}
						try {
							quotaByKey.set(key, await refreshInstance(instance));
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							const previous = quotaByKey.get(key);
							// Keep the last good snapshot through a transient network/provider
							// failure. Replacing it with an empty error state made the ring
							// flash red/gray during refreshes and React screen switches.
							if (previous?.state === "ok" && Array.isArray(previous.accounts) && previous.accounts.length > 0) {
								quotaByKey.set(key, { ...previous, stale: true, lastError: message });
							} else {
								quotaByKey.set(key, {
									state: "error",
									error: message,
									accounts: [],
									fetchedAt: Date.now(),
								});
							}
						}
					}));
				} finally {
					refreshing = false;
					shared.refreshing = false;
					shared.lastRefreshedAt = Date.now();
					shared.nextRefreshAt = shared.lastRefreshedAt + refreshMs;
				}
				if (disposed) return;
				scheduleDecorate();
				emitUpdated();
				if (tip !== null && tipAnchor !== null && isConnected(tipAnchor)) showTooltip(tipAnchor);
			}

			function maybeReloadIndex() {
				if (indexReloadQueued || Date.now() - modelIndexAt < 90_000) return;
				indexReloadQueued = true;
				window.setTimeout(() => {
					indexReloadQueued = false;
					void refreshModelIndex();
				}, 400);
			}

			//#region tooltip render
			/**
			 * Clicking the ring opens Settings → Plugins with our card expanded.
			 * Best-effort DOM walk: every step gives up quietly when the surface
			 * it needs is not mounted.
			 */
			function openSettingsCard() {
				const cardToggle = document.querySelector(".cpa-q-card-toggle");
				if (cardToggle !== null) {
					if (cardToggle.getAttribute("aria-expanded") !== "true") cardToggle.click();
					cardToggle.scrollIntoView({ block: "center" });
					return;
				}
				const labelOf = (node) => (node.textContent || "").trim();
				const settingsLabels = ZH ? ["设置", "Settings"] : ["Settings", "设置"];
				const settingsButton = [...document.querySelectorAll("button")].find((b) => settingsLabels.includes(labelOf(b)));
				if (settingsButton === undefined) return;
				settingsButton.click();
				window.setTimeout(() => {
					const tabLabels = ZH ? ["插件", "Plugins"] : ["Plugins", "插件"];
					const tabButton = [...document.querySelectorAll("button")].find((b) => tabLabels.includes(labelOf(b)));
					if (tabButton === undefined) return;
					tabButton.click();
					window.setTimeout(() => {
						const freshToggle = document.querySelector(".cpa-q-card-toggle");
						if (freshToggle === null) return;
						if (freshToggle.getAttribute("aria-expanded") !== "true") freshToggle.click();
						freshToggle.scrollIntoView({ block: "center" });
					}, 200);
				}, 200);
			}

			function hideTooltip() {
				if (tip !== null) {
					tip.remove();
					tip = null;
					tipAnchor = null;
				}
			}

			function showTooltip(dot) {
				const key = dot.getAttribute("data-cpa-base") ?? "";
				const modelId = dot.getAttribute("data-cpa-model") ?? "";
				const providerHint = dot.getAttribute("data-cpa-provider") ?? "";
				const instance = instanceByKey.get(key);
				const state = quotaByKey.get(key);
				if (instance === undefined) return;

				if (tip === null) {
					tip = el("div");
					tip.setAttribute(TIP_ATTR, "");
					document.body.appendChild(tip);
					// Hovering the card keeps it open; leaving it closes (shared hide timer).
					tip.addEventListener("mouseenter", () => {
						if (tipHideTimer !== 0) {
							window.clearTimeout(tipHideTimer);
							tipHideTimer = 0;
						}
					});
					tip.addEventListener("mouseleave", () => {
						if (tipHideTimer !== 0) window.clearTimeout(tipHideTimer);
						tipHideTimer = window.setTimeout(() => {
							tipHideTimer = 0;
							hideTooltip();
						}, 180);
					});
				}
				if (tipHideTimer !== 0) {
					window.clearTimeout(tipHideTimer);
					tipHideTimer = 0;
				}
				tipAnchor = dot;
				tip.textContent = "";

				if (state === undefined) {
					tip.appendChild(el("div", "cpa-q-row", ZH ? "额度数据尚未加载" : "quota data not loaded yet"));
				} else if (state.state === "nokey") {
					tip.appendChild(el("div", "cpa-q-err", ZH ? "未配置管理密钥" : "management key not configured"));
					const hint = el("div", "cpa-q-hint");
					hint.textContent = ZH
						? "在 设置 → 插件 → CliProxyAPI 额度 中填入该实例的 management key"
						: "Paste this instance's management key in Settings → Plugins → CliProxyAPI Quota";
					tip.appendChild(hint);
				} else if (state.state === "error") {
					tip.appendChild(el("div", "cpa-q-err", state.error));
					if (/\b401\b|invalid management/i.test(state.error)) {
						const hint = el("div", "cpa-q-hint");
						hint.textContent = ZH
							? "管理密钥无效，请在 设置 → 插件 → CliProxyAPI 额度 中更新"
							: "Invalid management key — update it in Settings → Plugins → CliProxyAPI Quota";
						tip.appendChild(hint);
					}
				} else if (state.accounts.length === 0) {
					tip.appendChild(el("div", "cpa-q-row", ZH ? "该实例没有账号（auth-files 为空）" : "no auth files on this instance"));
				} else {
					const statsOff = shared.usageStatsByBase[key] === false;
					if (statsOff) {
						tip.appendChild(el("div", "cpa-q-hint", ZH ? "CPA 用量统计未开启，无法识别使用中的账号" : "CPA usage statistics are off — accounts in use cannot be detected"));
					}
					const usage = usageFor(key, modelId);
					const split = accountsForModelDetailed(state.accounts, modelId, providerHint, usage, usageActiveOnly());
					if (split.active.length === 0 && split.others.length === 0) {
						tip.appendChild(el("div", "cpa-q-row", ZH ? "该模型没有匹配的厂商额度" : "no matching provider quota for this model"));
					} else {
						if (modelFamily(modelId) === "" && providerFamilyFromId(providerHint) === "" && split.active.length === 0) {
							tip.appendChild(el("div", "cpa-q-hint", ZH
								? "无法从模型名识别账号归属，以下为该实例全部可用账号"
								: "model family unknown — listing every usable account on this instance"));
						}
					for (const account of split.active) {
						const stats = usageAccountStats(key, account.name);
						tip.appendChild(accountSection(account, modelId, {
							count: stats.count,
							tokens: stats.tokens,
							lastTs: usage.lastByAccount.get(account.name) ?? stats.lastTs,
							active: true,
						}));
					}
					// The collapsed "other accounts" group only makes sense when
					// in-use accounts exist to pin above it; a pure fallback list
					// (no usage-verified accounts) renders plainly.
					if (split.others.length > 0 && split.active.length > 0) {
						const othersCount = split.others.length;
						const othersHead = el("div", "cpa-q-others-head", ZH ? `其它账号 (${othersCount}) ▸` : `Other accounts (${othersCount}) ▸`);
						const othersBody = el("div", "cpa-q-others-body");
						othersBody.style.display = "none";
						for (const account of split.others) {
							othersBody.appendChild(accountSection(account, modelId, null));
						}
						othersHead.addEventListener("click", () => {
							const open = othersBody.style.display !== "none";
							othersBody.style.display = open ? "none" : "block";
							othersHead.textContent = (open ? "▸ " : "▾ ") + (ZH ? `其它账号 (${othersCount})` : `Other accounts (${othersCount})`);
						});
						tip.appendChild(othersHead);
						tip.appendChild(othersBody);
					} else if (split.others.length > 0) {
						for (const account of split.others) {
							tip.appendChild(accountSection(account, modelId, null));
						}
					}
					}
					if (state.stale && state.lastError) {
						const hint = el("div", "cpa-q-hint");
						hint.textContent = ZH ? "暂时无法刷新，显示上次成功数据" : "refresh temporarily unavailable; showing the last good snapshot";
						tip.appendChild(hint);
					}

				}

				// Position: prefer above the dot, clamp into the viewport.
				const rect = dot.getBoundingClientRect();
				tip.style.visibility = "hidden";
				tip.style.left = "0px";
				tip.style.top = "0px";
				window.requestAnimationFrame(() => {
					if (tip === null || disposed || tipAnchor !== dot) return;
					const box = tip.getBoundingClientRect();
					const margin = 8;
					let left = rect.left + rect.width / 2 - box.width / 2;
					left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
					let top = rect.top - box.height - 8;
					if (top < margin) top = rect.bottom + 8;
					tip.style.left = `${Math.round(left)}px`;
					tip.style.top = `${Math.round(top)}px`;
					tip.style.visibility = "";
				});
			}

			function bindHover(ring) {
				ring.addEventListener("click", () => openSettingsCard());
				ring.addEventListener("mouseenter", () => {
					if (tipHideTimer !== 0) {
						window.clearTimeout(tipHideTimer);
						tipHideTimer = 0;
					}
					showTooltip(ring);
					const state = quotaByKey.get(ring.getAttribute("data-cpa-base") ?? "");
					if (state === undefined || state.state === "nokey" || Date.now() - state.fetchedAt > refreshMs) void refreshQuota();
				});
				ring.addEventListener("mouseleave", () => {
					if (tipHideTimer !== 0) window.clearTimeout(tipHideTimer);
					tipHideTimer = window.setTimeout(() => {
						tipHideTimer = 0;
						hideTooltip();
					}, 180);
				});
			}
			//#endregion

						//#region DOM pass
			/** SVG geometry of the ring, mirroring the stock ContextMeter (14×14, r 5.5, 2px round stroke). */
			const RING_R = 5.5;
			const RING_C = 2 * Math.PI * RING_R;
			const RING_SIZE = 14;
			const RING_HIT_SIZE = 28;

			/** Parents we switched to position:relative, restored on dispose. */
			const positionedParents = new Map();

			function buildRing() {
				const wrap = document.createElement("span");
				wrap.setAttribute(DOT_ATTR, "");
				wrap.setAttribute("aria-hidden", "true");
				wrap.setAttribute("role", "presentation");
				const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
				svg.setAttribute("viewBox", "0 0 14 14");
				svg.setAttribute("width", "14");
				svg.setAttribute("height", "14");
				const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
				track.setAttribute("class", "cpa-q-track");
				track.setAttribute("cx", "7");
				track.setAttribute("cy", "7");
				track.setAttribute("r", String(RING_R));
				const arc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
				arc.setAttribute("class", "cpa-q-arc");
				arc.setAttribute("cx", "7");
				arc.setAttribute("cy", "7");
				arc.setAttribute("r", String(RING_R));
				// Start at 12 o'clock; SVG's positive circle direction then advances
				// clockwise, so the green arc shrinks from the top as quota is used.
				arc.setAttribute("transform", "rotate(-90 7 7)");
				arc.setAttribute("stroke-dasharray", "0 " + String(RING_C));
				arc.setAttribute("stroke-dashoffset", "0");
				svg.appendChild(track);
				svg.appendChild(arc);
				wrap.appendChild(svg);
				return wrap;
			}

			function applyDotState(ring) {
				const key = ring.getAttribute("data-cpa-base") ?? "";
				const modelId = ring.getAttribute("data-cpa-model") ?? "";
				const agg = levelFor(quotaByKey.get(key), modelId, ring.getAttribute("data-cpa-provider") ?? "", usageFor(key, modelId));
				ring.setAttribute("data-cpa-level", agg.level);
				const arc = ring.querySelector(".cpa-q-arc");
				if (arc !== null) {
					const remaining = agg.remaining === null ? null : clampPct(agg.remaining);
					// pending/no data: track only; error: full red ring; otherwise the arc IS the remaining share.
					const percent = agg.level === "error" ? 100 : remaining === null ? 0 : Math.max(remaining, agg.level === "exhausted" ? 4 : 2);
					arc.setAttribute("stroke", LEVEL_COLOR[agg.level]);
					arc.setAttribute("stroke-dasharray", String((RING_C * percent) / 100) + " " + String(RING_C));
					// The missing/consumed share starts at 12 o'clock and advances
					// clockwise; a negative offset moves the remaining green arc to
					// the end of the path instead of leaving it anchored at the top.
					const consumedPercent = agg.level === "error" ? 0 : 100 - percent;
					arc.setAttribute("stroke-dashoffset", String(-(RING_C * consumedPercent) / 100));
				}
			}

			/**
			 * Anchor the ring just LEFT of the model button with absolute positioning —
			 * zero footprint in the tool row's flex layout, so the stock context meter
			 * (and every other control) stays exactly where DSH puts it. The gap mirrors
			 * the context meter's distance on the button's right, making the two rings
			 * symmetric around the model name.
			 */
			function placeRing(ring, button) {
				const parent = button.parentNode;
				if (parent === null || typeof parent.appendChild !== "function") return;
				if (!positionedParents.has(parent)) {
					positionedParents.set(parent, parent.style.position || "");
					if (positionedParents.get(parent) === "" || positionedParents.get(parent) === "static") parent.style.position = "relative";
				}
				if (ring.parentNode !== parent) parent.appendChild(ring);
				const pr = parent.getBoundingClientRect();
				const br = button.getBoundingClientRect();
				// The 28px hit target extends 7px beyond the 14px ring on each
				// side, so keep a 15px geometric gap to leave 8px of visible
				// clearance between the hit target and the model button.
				let gap = 15;
				const next = button.nextElementSibling;
				if (next !== null) {
					const nr = next.getBoundingClientRect();
					if (nr.width > 0 && nr.left >= br.right - 1) gap = Math.min(Math.max(nr.left - br.right, 15), 22);
				}
				const hitOffset = (RING_HIT_SIZE - RING_SIZE) / 2;
				const left = br.left - pr.left - RING_SIZE - gap - hitOffset;
				const top = br.top - pr.top + (br.height - RING_HIT_SIZE) / 2;
				// Negative coordinates are intentional: the parent hugs the
				// button, so clamping to zero makes the hit target overlap it.
				ring.style.left = left + "px";
				ring.style.top = Math.max(top, 0) + "px";
			}

			let decorateRaf = 0;
			function scheduleDecorate() {
				if (decorateRaf !== 0) return;
				decorateRaf = window.requestAnimationFrame(() => {
					decorateRaf = 0;
					decorate();
				});
			}

			/** rings by model button, so placement can refresh without re-creating */
			const ringByButton = new Map();
			/** Rings detached during a React screen switch, reusable by model identity. */
			const orphanRings = new Map();
			const ringRemovalTimers = new Map();
			const RING_GRACE_MS = 1800;

			function ringIdentity(ring) {
				const key = ring.getAttribute("data-cpa-base") ?? "";
				const model = ring.getAttribute("data-cpa-model") ?? "";
				return key === "" || model === "" ? "" : `${key}\u0000${model.toLowerCase()}`;
			}

			function isConnected(node) {
				if (node === null || node === undefined) return false;
				if (typeof node.isConnected === "boolean") return node.isConnected;
				return node.parentNode !== null;
			}

			function clearRingRemoval(ring) {
				const timer = ringRemovalTimers.get(ring);
				if (timer !== undefined) {
					window.clearTimeout(timer);
					ringRemovalTimers.delete(ring);
				}
			}

			function cacheOrphanRing(ring) {
				clearRingRemoval(ring);
				const identity = ringIdentity(ring);
				ring.remove();
				if (identity === "") return;
				const previous = orphanRings.get(identity);
				if (previous !== undefined && previous !== ring) previous.remove();
				orphanRings.set(identity, ring);
				const timer = window.setTimeout(() => {
					ringRemovalTimers.delete(ring);
					if (orphanRings.get(identity) !== ring) return;
					orphanRings.delete(identity);
					ring.remove();
				}, RING_GRACE_MS * 2);
				ringRemovalTimers.set(ring, timer);
			}

			function takeOrphanRing(identity) {
				if (identity === "") return undefined;
				const ring = orphanRings.get(identity);
				if (ring === undefined) return undefined;
				orphanRings.delete(identity);
				clearRingRemoval(ring);
				for (const [button, mapped] of ringByButton) {
					if (mapped === ring) ringByButton.delete(button);
				}
				ring.remove();
				return ring;
			}

			function deferRingRemoval(button, ring) {
				if (ringRemovalTimers.has(ring)) return;
				const timer = window.setTimeout(() => {
					ringRemovalTimers.delete(ring);
					if (ringByButton.get(button) !== ring) return;
					ringByButton.delete(button);
					cacheOrphanRing(ring);
				}, RING_GRACE_MS);
				ringRemovalTimers.set(ring, timer);
			}

			function removeRingForButton(button) {
				const ring = ringByButton.get(button);
				if (ring === undefined) return;
				clearRingRemoval(ring);
				ringByButton.delete(button);
				if (tipAnchor === ring) hideTooltip();
				ring.remove();
			}

			function prunePositionedParents() {
				for (const [parent, previous] of positionedParents) {
					if (isConnected(parent)) continue;
					parent.style.position = previous;
					positionedParents.delete(parent);
				}
			}

			function decorate() {
				if (disposed) return;
				const liveButtons = new Set();
				for (const button of document.querySelectorAll('button[aria-haspopup="menu"]')) {
					const labelNode = button.firstElementChild;
					const label = labelNode !== null && labelNode.tagName === "SPAN" ? labelNode.textContent.trim() : "";
					if (label === "") continue;
					const model = modelIndex.get(label.toLowerCase());
					const instance = model !== undefined && model.baseURL !== "" ? instanceFor(model.baseURL) : undefined;
					if (instance === undefined) {
						// This model is known, but its provider base was not confirmed as
						// CliProxyAPI. Remove an old ring immediately instead of leaving
						// an empty placeholder while the button itself remains mounted.
						if (model !== undefined && model.baseURL !== "") removeRingForButton(button);
						continue;
					}
					liveButtons.add(button);

					let ring = ringByButton.get(button);
					if (ring === undefined || ring.parentNode === null) {
						const identity = `${baseKey(instance.baseURL)}\u0000${model.modelId.toLowerCase()}`;
						ring = takeOrphanRing(identity);
						if (ring === undefined) {
							for (const [oldButton, oldRing] of ringByButton) {
								if (liveButtons.has(oldButton) || ringIdentity(oldRing) !== identity) continue;
								clearRingRemoval(oldRing);
								ringByButton.delete(oldButton);
								ring = oldRing;
								ring.remove();
								break;
							}
						}
						ring ??= buildRing();
						ringByButton.set(button, ring);
						bindHover(ring);
						// Two settle passes so the anchor lands after the composer's layout.
						placeRing(ring, button);
						window.requestAnimationFrame(() => {
							if (ringByButton.get(button) === ring) placeRing(ring, button);
						});
					}
					clearRingRemoval(ring);
					const modelId = model.modelId;
					const key = baseKey(instance.baseURL);
					if (ring.getAttribute("data-cpa-model") !== modelId) {
						ring.setAttribute("data-cpa-model", modelId);
						ring.setAttribute("data-cpa-base", key);
						ring.setAttribute("data-cpa-provider", model.providerId ?? "");
						if (tipAnchor === ring) showTooltip(ring);
					}
					ring.setAttribute("data-cpa-base", key);
					ring.setAttribute("data-cpa-provider", model.providerId ?? "");
					placeRing(ring, button);
					applyDotState(ring);
				}
				// Keep a ring alive briefly while DSH swaps the model trigger. React
				// commonly removes the old button one mutation before mounting the new
				// one; immediate removal caused a visible gray/empty flash on every
				// screen switch. Detached rings are cached by model identity and reused.
				for (const [button, ring] of ringByButton) {
					if (liveButtons.has(button)) continue;
					if (isConnected(button) && isConnected(ring)) deferRingRemoval(button, ring);
					else {
						ringByButton.delete(button);
						cacheOrphanRing(ring);
					}
				}
				// A label we could not resolve may be a provider added after the last index load.
				if (modelIndexAt === 0 || Date.now() - modelIndexAt > 90_000) maybeReloadIndex();
				prunePositionedParents();
			}

			function restorePositions() {
				for (const [parent, prev] of positionedParents) {
					if (isConnected(parent)) parent.style.position = prev;
				}
				positionedParents.clear();
				for (const [, ring] of ringByButton) ring.remove();
				ringByButton.clear();
				for (const timer of ringRemovalTimers.values()) window.clearTimeout(timer);
				ringRemovalTimers.clear();
				for (const [, ring] of orphanRings) ring.remove();
				orphanRings.clear();
			}
			//#endregion

			const observer = new MutationObserver(() => scheduleDecorate());
			observer.observe(document.documentElement, { childList: true, subtree: true });
			const onScrollOrResize = () => {
				if (tip !== null && tipAnchor !== null) showTooltip(tipAnchor);
			};
			window.addEventListener("scroll", onScrollOrResize, true);
			window.addEventListener("resize", scheduleDecorate);
			window.addEventListener("resize", onScrollOrResize);
			const onConfigChanged = () => applyConfig(readConfig(configArg));
			const onRefreshRequested = () => {
					void refreshModelIndex(true).then(() => refreshQuota());
				};
			window.addEventListener(EV_CONFIG, onConfigChanged);
			window.addEventListener(EV_REFRESH, onRefreshRequested);

			void refreshModelIndex().then(() => refreshQuota());
			restartQuotaTimer();
			const indexTimer = window.setInterval(() => void refreshModelIndex(), Math.max(refreshMs, 5 * 60 * 1000));

			// Settings card: Settings → Plugins → “CliProxyAPI Quota”. Current dsh
			// dispatches this slot by the settings namespace the Host serves, so
			// the registration must claim the `cpa-quota` namespace declared by
			// the node half — a keyless card is never rendered by the tab.
			if (ctx.slots !== undefined && typeof ctx.slots.inject === "function") {
				ctx.slots.inject("settings.plugin.item", () => ctx.slots.register(
					{ name: "settings.plugin.item", key: "cpa-quota" },
					QuotaSettingsCard,
				));
			}

			// cordis effect semantics: the callback runs immediately and its return
			// value is the disposer — so register setup work, return the teardown.
			ctx.effect(() => () => {
				disposed = true;
				observer.disconnect();
				window.clearInterval(quotaTimer);
				window.clearInterval(indexTimer);
				if (decorateRaf !== 0) window.cancelAnimationFrame(decorateRaf);
				window.removeEventListener("scroll", onScrollOrResize, true);
				window.removeEventListener("resize", scheduleDecorate);
				window.removeEventListener("resize", onScrollOrResize);
				window.removeEventListener(EV_CONFIG, onConfigChanged);
				window.removeEventListener(EV_REFRESH, onRefreshRequested);
				hideTooltip();
				restorePositions();
				styleTag.remove();

				quotaByKey.clear();
					planByAccountKey.clear();
					discoveredByKey.clear();
					accountModelsByKey.clear();
					agEndpointByBase.clear();
			}, "ui-cpa-quota: dot, tooltip, card, observer, timers");
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
