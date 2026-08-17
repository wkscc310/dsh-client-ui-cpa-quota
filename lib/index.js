/**
 * CliProxyAPI quota indicator, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration. All quota data is fetched browser-side directly
 * from the CliProxyAPI management API (CORS is open), so the host half owns
 * no behavior and no configuration of its own.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply() {}
