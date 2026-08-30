/**
 * CliProxyAPI quota indicator, node half. Deliberately dependency-free: the
 * dsh plugin flow materializes local packages through pnpm, which links a
 * `file:` dependency back to its source directory, so any node_modules import
 * here would have to resolve from wherever this checkout lives. Keeping the
 * host half import-free makes every install mode (dsh plugin add, direct
 * copy, the shared profiles node_modules) work identically.
 *
 * The half exists to declare the `cpa-quota` settings namespace: current dsh
 * dispatches `settings.plugin.item` cards by the settings namespaces the Host
 * serves, so without this registration the browser card would never render in
 * Settings → Plugins. The entry config (the cordis.patch.yml `config:` block)
 * is installed as the namespace's base layer. The browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration; all quota data is fetched browser-side directly from the
 * CliProxyAPI management API (CORS is open).
 */

/** The settings namespace the Plugins tab dispatches our card under. */
export const CpaQuotaNamespace = "cpa-quota";

/** Lenient shape of one configured instance; junk falls back to defaults. */
function normalizeInstance(value) {
	const source = value !== null && typeof value === "object" ? value : {};
	return {
		baseURL: typeof source.baseURL === "string" ? source.baseURL : "",
		managementKey: typeof source.managementKey === "string" ? source.managementKey : "",
	};
}

/** Mirror the browser half's readConfig defaults; idempotent over its own output. */
export function normalizeConfig(value) {
	const source = value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
	const refreshMinutes = Number(source.refreshMinutes);
	return {
		refreshMinutes: Number.isFinite(refreshMinutes) && refreshMinutes >= 1 ? Math.min(1440, refreshMinutes) : 10,
		instances: Array.isArray(source.instances) ? source.instances.map(normalizeInstance) : [],
	};
}

/**
 * Schema node descriptors matching the shape dsh-settings' redaction walker
 * and `describe()` serialization read (`type`/`dict`/`inner`/`meta`), so the
 * served namespace redacts management keys without importing schemastery.
 */
const INSTANCE_NODE = {
	type: "object",
	dict: {
		baseURL: { type: "string" },
		managementKey: { type: "string", meta: { role: "secret" } },
	},
};
const INSTANCES_NODE = { type: "array", inner: INSTANCE_NODE };
export const Config = Object.assign(
	(value) => normalizeConfig(value),
	{
		type: "object",
		dict: {
			refreshMinutes: { type: "number" },
			instances: INSTANCES_NODE,
		},
		toJSON() {
			return { type: this.type, dict: this.dict };
		},
		// Cordis resolves a plugin's entry config through the Standard Schema
		// interface (`Config["~standard"].validate`); the lenient normalizer
		// never reports issues, so a malformed entry config degrades to
		// defaults instead of failing plugin activation.
		["~standard"]: {
			version: 1,
			vendor: "dsh-client-ui-cpa-quota",
			validate(value) {
				return { value: normalizeConfig(value) };
			},
		},
	},
);

export const name = "dsh-client-ui-cpa-quota";
export const inject = [];

/** Host plugin body: serve the settings section that lists the browser card. */
export function apply(ctx, config) {
	// Deferred so composition order does not matter and profiles without a
	// settings service (headless/desktop without it) simply skip the section.
	ctx.inject(["settings"], (sctx) => {
		sctx.settings.register(CpaQuotaNamespace, Config, { base: Config(config) });
	});
}
