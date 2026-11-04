/* Contract check: the profile planClone produces must satisfy the real pi-ai
 * adapter Config, not just our own expectations. Resolves the adapter from the
 * DSH installation this machine runs, so the check exercises the shipped schema.
 *
 * Run: node .scratch/schema-check.mjs [path-to-dsh-llm-pi-ai/lib/index.js]
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const clientSource = readFileSync(new URL("../client.js", import.meta.url), "utf8");
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (registration) => (captured = registration) } };
const ReactStub = {
  createElement: () => null,
  useState: () => [null, () => {}],
  useEffect: () => {},
  useMemo: () => null,
  useCallback: (fn) => fn,
  useRef: () => ({ current: null }),
  useId: () => "stub",
  useSyncExternalStore: () => null,
};
eval(clientSource);
const T = captured.factory((name) => {
  if (name === "react") return ReactStub;
  throw new Error(`unexpected require(${name})`);
})._test;

/** Locate the shipped pi-ai adapter: explicit path, env override, then the global dsh install. */
const adapterPath = process.argv[2] ?? process.env.DSH_LLM_PI_AI ?? join(
  execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(),
  "@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js"
);
const piAi = await import(adapterPath);
assert.equal(typeof piAi.Config, "function", "the adapter must export its Config schema");

const SOURCE = {
  displayName: "acme-gateway",
  apiKeyEnv: "ACME_GATEWAY_API_KEY",
  api: "openai-completions",
  baseURL: "https://gateway.example/v1",
  models: [
    { id: "chat-a", name: "chat-a" },
    { id: "chat-b", name: "chat-b" },
  ],
};
const view = {
  ns: "llm-pi-ai",
  revision: 1,
  base: { providers: { "acme-gateway": SOURCE } },
  value: { providers: { "acme-gateway": SOURCE } },
};
const plan = T.planClone({
  view,
  settingsPath: ["providers", "acme-gateway"],
  taken: new Set(["acme-gateway"]),
  route: "acme-gateway-2",
  displayName: "acme-gateway (2)",
  apiKey: "sk-second-key",
});
assert.equal(plan.ok, true);

const parsed = piAi.Config({ providers: { "acme-gateway-2": plan.profile } });
/* `providers` is a schemastery volatile reference: the validated snapshot lives
   behind get(), and an invalid profile throws above this line. */
const cloned = parsed.providers.get()["acme-gateway-2"];
assert.equal(cloned.apiKeyEnv, "ACME_GATEWAY_2_API_KEY");
assert.equal(cloned.api, SOURCE.api);
assert.equal(cloned.baseURL, SOURCE.baseURL);
assert.equal(cloned.displayName, "acme-gateway (2)");
assert.deepEqual(cloned.models.map((model) => model.id), SOURCE.models.map((model) => model.id));

/* The same Config must reject a value it does not describe, proving the parse
   above was a real validation rather than a pass-through. (A missing endpoint is
   a serviceability refusal the adapter raises separately when it resolves
   profiles — the clone carries the source's api/baseURL/models unchanged.) */
let refused = false;
try {
  piAi.Config({ providers: { "acme-gateway-2": { api: "not-a-wire-protocol" } } });
} catch (_rejected) {
  refused = true;
}
assert.equal(refused, true, "the adapter Config must reject an unknown wire protocol");

console.log("schema accepts the cloned profile:", JSON.stringify({
  apiKeyEnv: cloned.apiKeyEnv,
  api: cloned.api,
  baseURL: cloned.baseURL,
  displayName: cloned.displayName,
  models: cloned.models.map((model) => model.id),
}, null, 2));
console.log("schema rejects an unknown wire protocol: true");
console.log("SCHEMA CHECK PASSED");