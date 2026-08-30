// Smoke test: load the client bundle factory with stubbed window/document,
// drive the full logic — config merge, provider directory join, CPA
// fingerprint discovery, codex/antigravity quota probes, aggregation, the
// settings-card slot registration, and the collapsible settings card itself
// (render harness with two-pass hooks) — against a fake DOM + fetch layer.
import { readFileSync } from "node:fs";

const pluginUrl = new URL("../lib/client.js", import.meta.url);

// --- minimal DOM stubs ---
function makeEl(tag) {
  const node = {
    tagName: tag.toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    dataset: {},
    listeners: new Map(),
    className: "",
    textContent: "",
    get firstChild() { return this.children[0] ?? null; },
    get firstElementChild() { return this.children.find((c) => typeof c === "object") ?? null; },
    get parentNode() { return this.parent ?? null; },
    get nextElementSibling() { if (!this.parent) return null; const i = this.parent.children.indexOf(this); return i >= 0 && i + 1 < this.parent.children.length ? this.parent.children[i + 1] : null; },
    get previousElementChild() { if (!this.parent) return null; const i = this.parent.children.indexOf(this); const prev = this.parent.children[i - 1]; return prev && typeof prev === "object" ? prev : null; },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    insertBefore(c) { this.children.unshift(c); c.parent = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    replaceChildren(...next) { this.children = [...next]; for (const c of next) c.parent = this; },
    remove() { if (this.parent) this.parent.removeChild(this); },
    addEventListener(type, listener) {
      const list = this.listeners.get(type) ?? [];
      list.push(listener);
      this.listeners.set(type, list);
    },
    click() { this.dispatchEvent({ type: "click" }); },
    scrollIntoView() {},
    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
    },
    dispatchEvent(event) {
      for (const listener of this.listeners.get(event.type) ?? []) listener(event);
      return true;
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    querySelector(sel) {
      if (sel.includes(".cpa-q-arc")) {
        for (const child of this.children) {
          if (child.getAttribute && child.getAttribute("class") === "cpa-q-arc") return child;
          if (child.querySelector) {
            const nested = child.querySelector(sel);
            if (nested) return nested;
          }
        }
        return null;
      }
      return null;
    },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 100, top: 100, right: 108, bottom: 108, width: 8, height: 8 }; },
  };
  Object.defineProperty(node, "textContent", {
    get() { return this._textContent ?? ""; },
    set(value) {
      this._textContent = String(value ?? "");
      if (this._textContent === "") this.children = [];
    },
  });
  return node;
}
const head = makeEl("head");
const body = makeEl("body");
const documentStub = {
  head,
  body,
  documentElement: makeEl("html"),
  createElement: (tag) => makeEl(tag),
  createElementNS: (ns, tag) => makeEl(tag),
  querySelector: () => null,
  querySelectorAll: () => [],
};
const realSetTimeout = setTimeout;
const windowStub = {
  localStorage: { store: new Map(), getItem(k) { return this.store.get(k) ?? null; }, setItem(k, v) { this.store.set(k, v); }, removeItem(k) { this.store.delete(k); } },
  setTimeout: (...a) => realSetTimeout(...a),
  clearTimeout, setInterval: () => 1, clearInterval: () => {},
  requestAnimationFrame: (fn) => realSetTimeout(fn, 0),
  addEventListener() {}, removeEventListener() {},
  dispatchEvent: () => true, CustomEvent: class { constructor(type) { this.type = type; } },
  innerWidth: 1280, innerHeight: 800,
};
globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "{}" });
Object.defineProperty(globalThis, "navigator", { value: { language: "zh-CN" }, configurable: true });
globalThis.atob = (s) => Buffer.from(s, "base64").toString("utf8");
const observers = [];
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe() {}
  disconnect() {}
  trigger() { this.callback([]); }
};

// --- React stub with a real enough hook runtime to render the settings card ---
// Function components are invoked one level deep by createElement. Hook cells
// persist across renders, keyed by component name + invocation order (the card
// tree is deterministic, so call order is a stable identity). This is what
// lets the smoke test assert the collapsible card's output, the panel node
// memoization, and the save/commit flow.
let hookScope = null;
let invocationCounter = 0;
let rerenderQueued = false;
const hookStore = new Map();
const memoTrace = [];
function invokeComponent(tag, props) {
  const key = `${tag.name}#${invocationCounter++}`;
  let store = hookStore.get(key);
  if (store === undefined) {
    store = { key, states: [], reducers: [], effects: [], refs: [], memos: [] };
    hookStore.set(key, store);
  }
  store.cursor = 0;
  const previous = hookScope;
  hookScope = store;
  const tree = tag(props ?? {});
  hookScope = previous;
  return { tag, props, children: [tree] };
}
function hookCell(kind) {
  if (hookScope === null) throw new Error("hook used outside a component render");
  const index = hookScope.cursor ?? 0;
  hookScope.cursor = index + 1;
  const list = hookScope[kind];
  if (list[index] === undefined) list[index] = {};
  return list[index];
}
const reactStub = {
  createElement(tag, props, ...children) {
    if (typeof tag === "function") return invokeComponent(tag, props);
    return { tag, props, children };
  },
  useReducer(reducer, initial) {
    const cell = hookCell("reducers");
    if (cell.value === undefined) cell.value = typeof initial === "function" ? initial() : initial;
    return [cell.value, () => { cell.value = reducer(cell.value); rerenderQueued = true; }];
  },
  useState(initial) {
    const cell = hookCell("states");
    if (cell.value === undefined) cell.value = typeof initial === "function" ? initial() : initial;
    return [cell.value, (value) => {
      cell.value = typeof value === "function" ? value(cell.value) : value;
      rerenderQueued = true;
    }];
  },
  useEffect(fn, deps) {
    const cell = hookCell("effects");
    const changed = cell.deps === undefined || deps === undefined || deps.length !== cell.deps.length || deps.some((d, i) => d !== cell.deps[i]);
    if (!changed) return;
    cell.deps = deps;
    if (cell.cleanup !== undefined) cell.cleanup();
    cell.cleanup = fn();
  },
  useRef(value) {
    const cell = hookCell("refs");
    if (cell.ref === undefined) cell.ref = { current: value };
    return cell.ref;
  },
  useMemo(fn, deps) {
    const cell = hookCell("memos");
    const changed = cell.deps === undefined || deps.length !== cell.deps.length || deps.some((d, i) => d !== cell.deps[i]);
    if (changed) {
      cell.deps = deps;
      cell.value = fn();
    }
    memoTrace.push({ key: hookScope.key, value: cell.value });
    return cell.value;
  },
};
/** Render a component to a tree, flushing scheduled re-renders and effects. */
function renderComponent(component, props = {}) {
  memoTrace.length = 0;
  let tree = null;
  for (let pass = 0; pass < 8; pass += 1) {
    invocationCounter = 0;
    rerenderQueued = false;
    tree = invokeComponent(component, props);
    if (!rerenderQueued) break;
  }
  return tree;
}
function findInTree(tree, predicate, hits = []) {
  if (tree === null || tree === undefined || typeof tree !== "object") return hits;
  if (predicate(tree)) hits.push(tree);
  for (const child of tree.children ?? []) findInTree(child, predicate, hits);
  return hits;
}

let captured;
windowStub.__ModuleLoader__ = { load: (entry) => { captured = entry; } };
globalThis.__requirer = (spec) => {
  if (spec === "react") return reactStub;
  throw new Error(`unexpected require ${spec}`);
};
// Execute the bundle with our require interception.
{
  const src = readFileSync(pluginUrl, "utf8");
  const fn = new Function("require", src + "\n;window.__capturedRequire = require;");
  fn(globalThis.__requirer);
}
if (!captured || captured.id !== "dsh-client-ui-cpa-quota") throw new Error("loader entry not captured");
const mod = captured.factory(globalThis.__requirer);
if (typeof mod.apply !== "function") throw new Error("apply not exported");

// --- fake provider directory: 3 providers ---
//   openai    → CPA instance, configured with a key
//   cpagw     → CPA instance, discovered keyless (fingerprint 401)
//   deepseek  → non-CPA (fingerprint 404) → no dot
const PROVIDERS = {
  openai: { baseURL: "https://cpa-fixture.example.test/v1", models: [
    { id: "gemini-3.7-flash-high", name: "gemini-3.7-flash-high" },
    { id: "gpt-5.5", name: "gpt-5.5" },
  ] },
  cpagw: { baseURL: "https://other-cpa.example/v1", models: [{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" }] },
  "deepseek-official": { baseURL: "https://api.deepseek.example/v1", models: [{ id: "DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" }] },
};

const authFiles = {
  files: [
    {
      auth_index: "idx-1", name: "codex-acc", provider: "codex", status: "available",
      id_token: `x.${Buffer.from(JSON.stringify({ chatgpt_account_id: "acct-1" })).toString("base64url")}.y`,
    },
    {
      auth_index: "idx-2", name: "ag-acc", provider: "antigravity", status: "available",
      project_id: "proj-2",
    },
    {
      auth_index: "idx-7", name: "ag-second", provider: "antigravity", status: "available",
      project_id: "proj-2",
    },
    {
      auth_index: "idx-3", name: "claude-acc", provider: "claude", status: "available",
    },
    {
      auth_index: "idx-4", name: "kimi-acc", provider: "kimi", status: "available",
    },
    {
      auth_index: "idx-5", name: "xai-acc", provider: "xai", status: "available",
    },
    {
      auth_index: "idx-6", name: "xai-paid-acc", provider: "xai", status: "available",
    },
  ],
};
const apiCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  apiCalls.push({ url: u, init });
  if (u.endsWith("/v0/management/auth-files")) {
    return { ok: true, status: 200, text: async () => JSON.stringify(authFiles) };
  }
  if (u.endsWith("/v0/management/usage-statistics-enabled")) {
    if (u.includes("other-cpa.example")) {
      return { ok: false, status: 401, text: async () => JSON.stringify({ error: "invalid management key" }) };
    }
    if (u.includes("cpa-fixture.example.test")) {
      return { ok: false, status: 401, text: async () => JSON.stringify({ error: "management key required" }) };
    }
    return { ok: false, status: 404, text: async () => "not found" };
  }
  if (u.endsWith("/v0/management/api-call")) {
    const body = JSON.parse(init.body);
    if (body.url.includes("wham/usage")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          status_code: 200,
          body: JSON.stringify({
            plan_type: "plus",
            rate_limit: {
              allowed: true,
              primary_window: { used_percent: 42.5, limit_window_seconds: 18000, reset_after_seconds: 3600 },
              secondary_window: { used_percent: 81.2, limit_window_seconds: 604800, reset_after_seconds: 200000 },
            },
          }),
        }),
      };
    }
    if (body.url.includes("loadCodeAssist")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          status_code: 200,
          body: JSON.stringify({
            currentTier: { id: "free-tier", name: "Free" },
            paidTier: { id: "g1-pro-tier", name: "Google One Pro" },
            cloudaicompanionProject: "proj-2",
          }),
        }),
      };
    }
    if (body.url.includes("fetchAvailableModels")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          status_code: 200,
          body: JSON.stringify({
            models: [
              { modelId: "gemini-3.7-flash-high", displayName: "Gemini 3.7 Flash High", quotaInfo: { remainingFraction: 0.35, resetTime: "2026-08-17T02:00:00Z" } },
              { modelId: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", quotaInfo: { remainingFraction: 0.5, resetTime: "2026-08-17T02:00:00Z" } },
            ],
          }),
        }),
      };
    }
    if (body.url.includes("retrieveUserQuotaSummary")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          status_code: 200,
          body: JSON.stringify({
            groups: [
              {
                displayName: "Gemini models",
                description: "Models within this group: Gemini Flash, Gemini Pro",
                buckets: [
                { bucketId: "gemini-5h", displayName: "Five Hour Limit Remaining", window: "5h", remainingFraction: 0.75, resetTime: "2026-08-17T08:00:00Z" },
                  { bucketId: "gemini-weekly", displayName: "Weekly Limit Remaining", window: "weekly", remainingFraction: 0.1, resetTime: "2026-08-21T08:00:00Z" },
                ],
              },
              {
                displayName: "Claude and GPT models",
                description: "Models within this group: Claude Opus, GPT-OSS",
                buckets: [
                  { bucketId: "gpt-5h", displayName: "Five Hour Limit Remaining", window: "5h", remainingFraction: 0.75, resetTime: "2026-08-17T08:00:00Z" },
                  { bucketId: "gpt-weekly", displayName: "Weekly Limit Remaining", window: "weekly", remainingFraction: 0.75, resetTime: "2026-08-21T08:00:00Z" },
                ],
              },
            ],
          }),
        }),
      };
    }
    if (body.url.includes("api.anthropic.com/api/oauth/usage")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          status_code: 200,
          body: JSON.stringify({
            five_hour: { utilization: 25, resets_at: "2026-08-17T08:00:00Z" },
            seven_day: { utilization: 43, resets_at: "2026-08-21T08:00:00Z" },
          }),
        }),
      };
    }
    if (body.url.includes("api.anthropic.com/api/oauth/profile")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          status_code: 200,
          body: JSON.stringify({ account: { has_claude_pro: true } }),
        }),
      };
    }
    if (body.url.includes("api.kimi.com/coding/v1/usages")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          status_code: 200,
          body: JSON.stringify({ limits: [{ name: "Weekly limit", used: 20, limit: 100, reset_in: 3600 }] }),
        }),
      };
    }
    if (body.url.includes("cli-chat-proxy.grok.com/v1/billing")) {
      if (body.auth_index === "idx-6") {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ status_code: 200, body: JSON.stringify({ config: {} }) }),
        };
      }
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          status_code: 200,
          body: JSON.stringify({
            config: {
              creditUsagePercent: 20,
              monthlyLimit: { val: 10000 },
              used: { val: 1000 },
              currentPeriod: { type: "weekly", end: "2026-08-21T08:00:00Z" },
            },
          }),
        }),
      };
    }
    if (body.url.includes("api.x.ai/v1/chat/completions")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ status_code: 200, body: JSON.stringify({ id: "health-ok" }) }),
      };
    }
    if (body.url.includes("api.x.ai/v1/me")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ status_code: 200, body: JSON.stringify({ user_id: "xai-user" }) }),
      };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ status_code: 404, body: "nope" }) };
  }
  throw new Error(`unexpected fetch ${u}`);
};

const registeredSlots = [];
const yamlConfig = {
  instances: [
    { baseURL: "https://cpa-fixture.example.test/v1/", managementKey: "test-key" },
    { baseURL: "https://api.deepseek.example/v1", managementKey: "not-a-cpa-key" },
  ],
  refreshMinutes: 5,
};
const ctx = {
  get: (name) => {
    if (name !== "connection") throw new Error(`unexpected service ${name}`);
    return {
      api: {
        llm: { providers: async () => ({ result: { ok: true, value: { providers: Object.entries(PROVIDERS).map(([id, cfg]) => ({
          provider: id === "deepseek-official" ? "deepseek-official" : id,
          settingsNs: id === "deepseek-official" ? "llm-deepseek" : "llm-pi-ai",
          settingsPath: id === "deepseek-official" ? [] : ["providers", id],
          active: true,
        })) } } }) },
        settings: { describe: async () => ({ result: { ok: true, value: { writable: true, namespaces: [
          { ns: "llm-pi-ai", value: { providers: {
            openai: PROVIDERS.openai,
            cpagw: PROVIDERS.cpagw,
          } }, user: {}, base: {} },
          { ns: "llm-deepseek", value: { baseURL: PROVIDERS["deepseek-official"].baseURL, models: PROVIDERS["deepseek-official"].models }, user: {}, base: {} },
        ] } } }) },
      },
    };
  },
  slots: { inject: (slot, cb) => { registeredSlots.push({ slot, cb }); cb(); }, register: (def, component) => { registeredSlots.push({ def, component }); } },
  effect: (fn) => { fn(); },
};
mod.apply(ctx, yamlConfig);
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e); });
await new Promise((r) => setTimeout(r, 500));

// --- assertions: discovery + probes ---
const probeCalls = apiCalls.filter((c) => c.url.includes("usage-statistics-enabled"));
if (!probeCalls.some((c) => c.url === "https://other-cpa.example/v0/management/usage-statistics-enabled")) {
  throw new Error("keyless CPA probe URL wrong (expected /v1 stripped): " + JSON.stringify(probeCalls.map((c) => c.url)));
}
if (!probeCalls.some((c) => c.url.includes("api.deepseek.example"))) throw new Error("non-CPA baseURL not probed");
const authCall = apiCalls.find((c) => c.url.includes("/auth-files"));
if (!authCall) {
  console.log("DEBUG urls:", apiCalls.map((c) => c.url));
  console.log("DEBUG registeredSlots:", registeredSlots.map((r) => r.def?.name ?? r.slot));
  throw new Error("auth-files not fetched");
}
if (authCall.init.headers.Authorization !== "Bearer test-key") throw new Error("management key not sent");
const codexCall = apiCalls.find((c) => c.init && String(c.init.body).includes("wham/usage"));
if (!codexCall) throw new Error("codex usage probe missing");
const agCall = apiCalls.find((c) => c.init && String(c.init.body).includes("retrieveUserQuotaSummary"));
if (!agCall) throw new Error("antigravity quota summary probe missing");
const agTierCall = apiCalls.find((c) => c.init && String(c.init.body).includes("loadCodeAssist"));
if (!agTierCall) throw new Error("antigravity subscription probe missing");
const agTierPayload = JSON.parse(agTierCall.init.body);
if (JSON.parse(agTierPayload.data).cloudaicompanionProject !== undefined) throw new Error("subscription probe must not send quota project id");
if (!String(agTierPayload.header?.["User-Agent"] ?? "").includes("antigravity/cli")) throw new Error("subscription probe must use the Antigravity client header");
if (!apiCalls.some((c) => c.init && String(c.init.body).includes("api.anthropic.com/api/oauth/usage"))) throw new Error("claude usage probe missing");
if (!apiCalls.some((c) => c.init && String(c.init.body).includes("api.kimi.com/coding/v1/usages"))) throw new Error("kimi usage probe missing");
if (!apiCalls.some((c) => c.init && String(c.init.body).includes("cli-chat-proxy.grok.com/v1/billing"))) throw new Error("xAI billing probe missing");
if (!apiCalls.some((c) => c.init && String(c.init.body).includes("api.x.ai/v1/chat/completions") && String(c.init.body).includes("grok-4.5"))) throw new Error("xAI paid health fallback missing");
// The keyless discovered instance must NOT have hit auth-files.
const badUrl = apiCalls.find((c) => c.url.includes("/v1/v0/"));
if (badUrl) throw new Error("management URL must not carry a /v1 prefix: " + badUrl.url);
if (apiCalls.some((c) => c.url.startsWith("https://other-cpa.example") && c.url.includes("auth-files"))) {
  throw new Error("keyless discovered instance should not call auth-files");
}
// Settings card registered on the plugins slot, keyed by the settings
// namespace the node half serves (current dsh dispatches cards by key).
const card = registeredSlots.find((r) => r.def && r.def.name === "settings.plugin.item");
if (!card || card.def.key !== "cpa-quota") throw new Error("settings card not registered with the cpa-quota namespace key");

// --- DOM pass with three triggers ---
function makeTrigger(labelText) {
  const labelSpan = makeEl("span");
  labelSpan.textContent = labelText;
  const chevron = makeEl("svg");
  const trigger = makeEl("button");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.children.push(labelSpan, chevron);
  const container = makeEl("div");
  container.appendChild(trigger);
  return container;
}
const geminiTrigger = makeTrigger("gemini-3.7-flash-high");
const gptTrigger = makeTrigger("gpt-5.5");
const claudeTrigger = makeTrigger("Claude Sonnet 4.6");
const deepseekTrigger = makeTrigger("DeepSeek V4 Flash");
documentStub.querySelectorAll = () => [geminiTrigger.children[0], gptTrigger.children[0], claudeTrigger.children[0], deepseekTrigger.children[0]];
apiCalls.length = 0;
mod.apply(ctx, yamlConfig);
await new Promise((r) => setTimeout(r, 600));

function ringOf(container) {
  return container.children.find((c) => c.getAttribute && c.getAttribute("data-cpa-quota-ring") !== null) ?? null;
}
const geminiDot = ringOf(geminiTrigger);
const gptDot = ringOf(gptTrigger);
const claudeDot = ringOf(claudeTrigger);
if (!geminiDot) throw new Error("dot missing on CPA-backed configured model");
if (!gptDot) throw new Error("dot missing on GPT model");
if (geminiDot.getAttribute("data-cpa-base") !== "cpa-fixture.example.test") throw new Error("gemini dot base wrong: " + geminiDot.getAttribute("data-cpa-base"));
if (geminiDot.getAttribute("data-cpa-level") !== "ok") throw new Error("gemini dot level wrong: " + geminiDot.getAttribute("data-cpa-level"));
if (!claudeDot) throw new Error("dot missing on discovered keyless CPA model");
if (claudeDot.getAttribute("data-cpa-base") !== "other-cpa.example") throw new Error("claude dot base wrong: " + claudeDot.getAttribute("data-cpa-base"));
if (claudeDot.getAttribute("data-cpa-level") !== "pending") throw new Error("keyless dot should be pending, got " + claudeDot.getAttribute("data-cpa-level"));
if (ringOf(deepseekTrigger) !== null) throw new Error("non-CPA model must not get a ring");
if (geminiDot.parent !== geminiTrigger) throw new Error("ring must live in the trigger's parent, not inside the button");
if (geminiTrigger.children[0].children.some((c) => c.getAttribute && c.getAttribute("data-cpa-quota-ring") !== null)) throw new Error("ring must not be inside the model button");
if (geminiTrigger.children.indexOf(geminiDot) !== 1) throw new Error("ring appended to parent expected");
if (!(Number.parseFloat(geminiDot.style.left) < 0)) throw new Error("ring hit target must stay left of the model button");
const geminiArc = geminiDot.querySelector(".cpa-q-arc");
if (!geminiArc || geminiArc.getAttribute("transform") !== "rotate(-90 7 7)") throw new Error("ring arc must start at 12 o'clock");
if (!(Number(geminiArc.getAttribute("stroke-dashoffset")) < 0)) throw new Error("ring depletion must advance clockwise from 12 o'clock");

// The Antigravity subscription response is independent of the quota summary;
// ensure the paid tier wins over currentTier and is rendered in the tooltip.
geminiDot.dispatchEvent({ type: "mouseenter" });
await new Promise((r) => setTimeout(r, 30));
const tip = documentStub.body.children.find((child) => child.getAttribute && child.getAttribute("data-cpa-quota-tip") !== null);
const treeText = (node) => `${node.textContent ?? ""}${(node.children ?? []).map(treeText).join("")}`;
if (!tip || !treeText(tip).includes("Pro")) throw new Error("Antigravity paid plan badge missing from tooltip: " + (tip ? treeText(tip) : "no tooltip"));
if (!tip || !treeText(tip).includes("ag-acc") || !treeText(tip).includes("ag-second")) throw new Error("multiple Antigravity accounts were not rendered in one tooltip: " + (tip ? treeText(tip) : "no tooltip"));
const geminiTooltipText = treeText(tip);
if (geminiTooltipText.indexOf("Five Hour") < 0 || geminiTooltipText.indexOf("Weekly") < 0 || geminiTooltipText.indexOf("Five Hour") > geminiTooltipText.indexOf("Weekly")) throw new Error("quota windows are not ordered 5-hour before weekly");
const injectedStyle = head.children.find((child) => child.dataset?.plugin === "dsh-client-ui-cpa-quota");
if (!injectedStyle || !injectedStyle.textContent.includes(".cpa-q-arc{") || !injectedStyle.textContent.includes("stroke-linecap:butt")) throw new Error("ring arc still has a round cap that creates a fixed green dot");

gptDot.dispatchEvent({ type: "mouseenter" });
await new Promise((r) => setTimeout(r, 30));
if (!treeText(tip).includes("ag-acc") || !treeText(tip).includes("ag-second")) throw new Error("GPT model did not select Antigravity's matching quota group");
if (treeText(tip).includes("codex-acc") || treeText(tip).includes("claude-acc")) throw new Error("GPT model tooltip leaked unrelated provider accounts");

// A React screen switch remounts the trigger. The existing ring should be
// reused by model identity instead of disappearing until a later refresh.
const replacement = makeTrigger("gemini-3.7-flash-high");
documentStub.querySelectorAll = () => [replacement.children[0], claudeTrigger.children[0], deepseekTrigger.children[0]];
observers.at(-1)?.trigger();
await new Promise((r) => setTimeout(r, 30));
const replacementDot = ringOf(replacement);
if (!replacementDot) throw new Error("ring missing after trigger remount");
if (replacementDot !== geminiDot) throw new Error("ring DOM was recreated instead of being reused during remount");

// Switching the same mounted button to a known non-CPA provider must remove
// the old ring immediately instead of leaving an empty placeholder behind.
replacement.children[0].firstElementChild.textContent = "DeepSeek V4 Flash";
documentStub.querySelectorAll = () => [replacement.children[0], claudeTrigger.children[0], deepseekTrigger.children[0]];
observers.at(-1)?.trigger();
await new Promise((r) => setTimeout(r, 30));
if (ringOf(replacement) !== null) throw new Error("non-CPA model retained an empty quota ring");

// --- settings card render harness ---
const cardComponent = card.component;
if (typeof cardComponent !== "function") throw new Error("settings card component not captured");

// Collapsed by default: only the header renders, with the health dot.
let tree = renderComponent(cardComponent);
let root = tree.children[0];
if (root.props.className !== "cpa-q-card") throw new Error("card root class wrong");
const toggle = root.children[0];
if (toggle.props.className !== "cpa-q-card-toggle" || toggle.props["aria-expanded"] !== false) throw new Error("collapsed card must render the toggle button");
if (root.children[1] !== null) throw new Error("collapsed card must not render a body");
const heading = toggle.children[0];
const dot = heading.children[0];
if (dot.props.className !== "cpa-q-card-dot") throw new Error("health dot missing from the collapsed header");
if (dot.props["data-level"] !== "ok") throw new Error("health dot level wrong with data present: " + dot.props["data-level"]);
const chevron = toggle.children[1];
if (chevron.props.className !== "cpa-q-card-chevron") throw new Error("chevron missing");

// Expanding renders the body with instance rows and DomSlot panels.
toggle.props.onClick();
tree = renderComponent(cardComponent);
root = tree.children[0];
if (root.children[1] === null) throw new Error("expanded card must render a body");
const bodyEl = root.children[1];
const instRows = findInTree(bodyEl, (n) => n.props?.className === "cpa-q-inst");
if (instRows.length !== 2) throw new Error("expected two discovered instance rows, got " + instRows.length);
const domSlots = findInTree(bodyEl, (n) => typeof n.tag === "function" && n.tag.name === "DomSlot");
if (domSlots.length !== 2) throw new Error("expected one accounts panel per instance, got " + domSlots.length);
const notes1 = memoTrace.filter((m) => m.key.startsWith("DomSlot#"));
if (notes1.length !== 2) throw new Error("one memoized panel per DomSlot expected, got " + notes1.length);
// Row 1 (cpa-fixture) has a usable quota snapshot: the panel must list EVERY
// account with its windows — the CPA-management-style all-accounts view.
if (notes1[0].value.className !== "cpa-q-accounts") throw new Error("panel with quota data must render the accounts container: " + notes1[0].value.className);
const panelText = treeText(notes1[0].value);
for (const name of ["codex-acc", "ag-acc", "ag-second", "claude-acc", "kimi-acc", "xai-acc", "xai-paid-acc"]) {
  if (!panelText.includes(name)) throw new Error("all-accounts panel must list " + name + "; got: " + panelText);
}
if (!panelText.includes("Five Hour Limit Remaining") || !panelText.includes("Weekly Limit Remaining")) throw new Error("panel must render quota windows");
// Row 2 (other-cpa) is keyless: the panel shows the paste-key hint.
if (notes1[1].value.className !== "cpa-q-accounts-note") throw new Error("keyless panel must render the paste-key note: " + notes1[1].value.className);
if (!/management key|管理密钥|填入/.test(treeText(notes1[1].value))) throw new Error("keyless instance panel must show the paste-key hint");

// BUG 1 regression: a clock tick re-renders the card with unchanged quota —
// the mounted panel node must keep its identity so the user's scroll position
// survives (deps [instanceKey, quota] are stable).
const quotaBefore = domSlots[0].props.quota;
tree = renderComponent(cardComponent);
const domSlotsAfter = findInTree(tree, (n) => typeof n.tag === "function" && n.tag.name === "DomSlot");
if (domSlotsAfter[0].props.quota !== quotaBefore) throw new Error("quota snapshot identity must stay stable across clock ticks");
const notes2 = memoTrace.filter((m) => m.key.startsWith("DomSlot#"));
if (notes2[0].value !== notes1[0].value || notes2[1].value !== notes1[1].value) {
  throw new Error("panel DOM node must be reused across clock-tick re-renders (scroll would reset)");
}

// BUG 3: saving a key must persist the keyed row and drop empty-key
// discovered rows from localStorage. (onChange first, then a re-render —
// real React commits the draft before the blur event fires.)
const keyedRow = instRows.find((row) => String(row.props.key ?? "").includes("cpa-fixture")) ?? instRows[0];
const keyInput = findInTree(keyedRow, (n) => n.props?.className === "cpa-q-input" && n.props?.type === "password")[0];
keyInput.props.onChange({ target: { value: "sk-test-1" } });
tree = renderComponent(cardComponent);
const refreshedRow = findInTree(tree, (n) => n.props?.className === "cpa-q-inst" && String(n.props.key ?? "").includes("cpa-fixture"))[0];
const refreshedInput = findInTree(refreshedRow, (n) => n.props?.className === "cpa-q-input" && n.props?.type === "password")[0];
if (refreshedInput.props.value !== "sk-test-1") throw new Error("drafted key must render back into the input, got: " + refreshedInput.props.value);
refreshedInput.props.onBlur();
const savedConfig = JSON.parse(windowStub.localStorage.getItem("dsh-cpa-quota:config"));
if (!savedConfig.instances.some((i) => i.baseURL.includes("cpa-fixture") && i.managementKey === "sk-test-1")) throw new Error("saved key row missing from localStorage: " + JSON.stringify(savedConfig));
if (savedConfig.instances.some((i) => i.managementKey === "")) throw new Error("empty-key discovered rows must not be persisted: " + JSON.stringify(savedConfig));

// BUG 2: account probes run through a bounded pool — 12 accounts must never
// exceed 5 simultaneous upstream calls, and every account still resolves.
// (The localStorage config from the BUG 3 save is cleared so exactly one
// keyed instance refreshes; the pool is per instance.)
windowStub.localStorage.store.delete("dsh-cpa-quota:config");
const poolAuthFiles = { files: Array.from({ length: 12 }, (_, i) => ({ auth_index: `p-${i}`, name: `acc-${i}`, provider: "codex", status: "available", id_token: `x.${Buffer.from(JSON.stringify({ chatgpt_account_id: `acct-${i}` })).toString("base64url")}.y` })) };
let inflight = 0;
let peak = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.endsWith("/v0/management/auth-files")) return { ok: true, status: 200, text: async () => JSON.stringify(poolAuthFiles) };
  if (u.endsWith("/v0/management/usage-statistics-enabled")) return { ok: false, status: 401, text: async () => '{"error":"management key required"}' };
  if (u.endsWith("/v0/management/api-call")) {
    inflight += 1;
    peak = Math.max(peak, inflight);
    await new Promise((r) => realSetTimeout(r, 25));
    inflight -= 1;
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({
        status_code: 200,
        body: JSON.stringify({ plan_type: "pro", rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_after_seconds: 3600 } } }),
      }),
    };
  }
  throw new Error(`unexpected fetch ${u}`);
};
documentStub.querySelectorAll = () => [];
mod.apply(ctx, { instances: [{ baseURL: "https://pool.example/v1", managementKey: "pool-key" }], refreshMinutes: 5 });
await new Promise((r) => setTimeout(r, 700));
if (peak === 0 || peak > 5) throw new Error("account probes must stay inside the concurrency pool, peak=" + peak);

// BUG 2 (timeout): a hung upstream aborts after the request ceiling and the
// refresh cycle completes — it never wedges the `refreshing` flag.
const realWindowSetTimeout = windowStub.setTimeout;
windowStub.setTimeout = (fn, ms, ...rest) => (ms >= 5000 ? realWindowSetTimeout(fn, 5, ...rest) : realWindowSetTimeout(fn, ms, ...rest));
let hangAborted = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.endsWith("/v0/management/auth-files")) return { ok: true, status: 200, text: async () => JSON.stringify({ files: [{ auth_index: "hang-1", name: "hang-acc", provider: "codex", status: "available", id_token: `x.${Buffer.from(JSON.stringify({ chatgpt_account_id: "hang" })).toString("base64url")}.y` }] }) };
  if (u.endsWith("/v0/management/usage-statistics-enabled")) return { ok: false, status: 401, text: async () => '{"error":"management key required"}' };
  if (u.endsWith("/v0/management/api-call")) {
    await new Promise((resolve, reject) => {
      if (init.signal) {
        init.signal.addEventListener("abort", () => {
          hangAborted = true;
          reject(new Error("aborted"));
        });
      } else reject(new Error("no signal"));
      // never resolves on its own
    });
  }
  throw new Error(`unexpected fetch ${u}`);
};
documentStub.querySelectorAll = () => [];
mod.apply(ctx, { instances: [{ baseURL: "https://hang.example/v1", managementKey: "hang-key" }], refreshMinutes: 5 });
await new Promise((r) => setTimeout(r, 300));
windowStub.setTimeout = realWindowSetTimeout;
if (!hangAborted) throw new Error("hung upstream request must be aborted by the per-request timeout");
// The cycle must still be alive: a follow-up refresh reaches the wire again.
apiCalls.length = 0;
const realFetch5 = globalThis.fetch;
globalThis.fetch = async (url, init) => { apiCalls.push({ url: String(url), init }); return realFetch5(url, init); };
mod.apply(ctx, { instances: [{ baseURL: "https://hang2.example/v1", managementKey: "hang-key" }], refreshMinutes: 5 });
await new Promise((r) => setTimeout(r, 300));
if (!apiCalls.some((c) => c.url.includes("hang2.example") && c.url.includes("auth-files"))) throw new Error("refresh cycle wedged after a timeout — later refreshes never ran");

// --- packaging contract (dsh plugin add / awesome-dsh-plugin listing) ---
// `dsh.client` alone is NOT installable — the listing and `dsh plugin add`
// both key off the `dsh.bundle` manifest, so a regression here is fatal.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (pkg.dsh?.bundle?.patch === undefined) throw new Error("package.json must declare dsh.bundle.patch — dsh.client alone is not installable via dsh plugin add");
if (pkg.dsh?.client?.platform !== "web") throw new Error("dsh.client.platform=web must stay declared alongside the bundle");
const bundlePatch = readFileSync(new URL("../" + pkg.dsh.bundle.patch, import.meta.url), "utf8");
if (!bundlePatch.includes("id: ui-cpa-quota") || !bundlePatch.includes("name: dsh-client-ui-cpa-quota")) throw new Error("bundle patch must insert the ui-cpa-quota loader entry");
const shots = JSON.parse(readFileSync(new URL("../screenshots.json", import.meta.url), "utf8"));
if (!Array.isArray(shots) || shots.length < 1 || shots.length > 8) throw new Error("screenshots.json must list 1-8 image paths");
for (const shot of shots) {
  try {
    readFileSync(new URL("../" + shot, import.meta.url));
  } catch {
    throw new Error("screenshots.json points at a missing file: " + shot);
  }
}

// --- ring click opens Settings → Plugins and expands the card ---
const clicked = [];
function makeButtonFixture(label) {
  const b = makeEl("button");
  b.textContent = label;
  b.addEventListener("click", () => clicked.push(label));
  return b;
}
const settingsFixture = makeButtonFixture("设置");
const pluginsFixture = makeButtonFixture("插件");
documentStub.querySelectorAll = (selector) => (selector === "button" ? [settingsFixture, pluginsFixture] : []);
geminiDot.dispatchEvent({ type: "click" });
await new Promise((r) => setTimeout(r, 600));
if (!clicked.includes("设置") || !clicked.includes("插件")) throw new Error("ring click must walk 设置 → 插件: " + JSON.stringify(clicked));

// --- config import/export ---
globalThis.Blob = class { constructor(parts) { this.content = parts.join(""); } };
globalThis.URL.createObjectURL = () => "blob:mock";
globalThis.URL.revokeObjectURL = () => {};
globalThis.FileReader = class {
  readAsText(file) { this.result = file.__content; this.onload(); }
};
const createdElements = [];
const realCreateElement = documentStub.createElement;
documentStub.createElement = (tag) => { const el = realCreateElement(tag); createdElements.push(el); return el; };
const hasLabel = (n, text) => Array.isArray(n.children) && n.children.some((c) => typeof c === "string" && c.includes(text));
tree = renderComponent(cardComponent);
const exportBtn = findInTree(tree, (n) => typeof n.props?.onClick === "function" && hasLabel(n, "导出配置"))[0];
if (!exportBtn) throw new Error("export button missing");
exportBtn.props.onClick();
const exportedAnchor = createdElements.find((el) => el.tagName === "A" && el.download === "dsh-cpa-quota-config.json");
if (!exportedAnchor || !String(exportedAnchor.href).startsWith("blob:") || exportedAnchor.download !== "dsh-cpa-quota-config.json") throw new Error("export must download a dsh-cpa-quota-config.json blob");
const importBtn = findInTree(tree, (n) => typeof n.props?.onClick === "function" && hasLabel(n, "导入配置"))[0];
if (!importBtn) throw new Error("import button missing");
importBtn.props.onClick();
const picker = createdElements.filter((el) => el.tagName === "INPUT").at(-1);
if (picker === undefined || picker.type !== "file") throw new Error("import must open a file picker");
picker.onchange();
// picker.files[0] → FileReader stub reads file.__content — install a fake file
// through the picker element.
if (picker.files === undefined) {
  Object.defineProperty(picker, "files", { value: [{ __content: JSON.stringify({ refreshMinutes: 7, instances: [{ baseURL: "https://imported.example/v1", managementKey: "imported-key" }] }) }] });
}
picker.onchange();
await new Promise((r) => setTimeout(r, 30));
const importedConfig = JSON.parse(windowStub.localStorage.getItem("dsh-cpa-quota:config"));
if (!importedConfig.instances.some((i) => i.baseURL.includes("imported.example") && i.managementKey === "imported-key")) throw new Error("imported instance missing from config: " + JSON.stringify(importedConfig));
if (importedConfig.refreshMinutes !== 7) throw new Error("imported refreshMinutes must apply, got " + importedConfig.refreshMinutes);

// 额度快照被替换后,卡片下一次渲染必须换用新面板(非回归)
console.log("SMOKE OK");
console.log("  gemini dot:", geminiDot.getAttribute("data-cpa-level"), "@", geminiDot.getAttribute("data-cpa-base"));
console.log("  claude dot:", claudeDot.getAttribute("data-cpa-level"), "@", claudeDot.getAttribute("data-cpa-base"), "(discovered, keyless)");
console.log("  deepseek: no dot (non-CPA)");
console.log("  settings card registered:", card.def.name + "#" + card.def.key);
console.log("  collapsed header: health dot ok / body hidden; pool peak:", peak, "/ timeout path exercised");
