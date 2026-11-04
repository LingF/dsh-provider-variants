/* Offline structural test for dsh-provider-variants.
 *
 * Loads client.js under a stubbed module loader / React so the browser artifact
 * can be exercised from Node, then checks:
 *   1. the registered module id and the declared service inject list
 *   2. zh/en dictionary key parity
 *   3. the pure clone planner (identity, profile merge, validation, write path)
 *   4. apply() against a mock ctx: locale dictionary + keyed slot registration
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const clientSource = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/* ---- stub environment -------------------------------------------------- */
let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      captured = registration;
    },
  },
};
globalThis.document = undefined;

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  useEffect: () => {},
  useMemo: () => null,
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init === undefined ? null : init }),
  useId: () => "stub",
  useSyncExternalStore: () => null,
};
const requireStub = (name) => {
  if (name === "react") return ReactStub;
  throw new Error(`unexpected require(${JSON.stringify(name)})`);
};

eval(clientSource); // registers into globalThis.window.__ModuleLoader__

assert.ok(captured !== null, "client.js must register a module with the loader");
assert.equal(captured.id, "dsh-provider-variants", "module id equals the package name");

const mod = captured.factory(requireStub);
const T = mod._test;

const passed = [];
function check(name, fn) {
  fn();
  passed.push(name);
}

/* ---- 1. declared surface ---------------------------------------------- */
check("inject lists the remotes and the slot service", () => {
  assert.deepEqual(mod.inject, [
    "slots",
    "locale",
    "remote",
    "remote.settings",
    "remote.credentials",
    "remote.llm",
  ]);
  assert.equal(T.SETTINGS_NS, "llm-pi-ai");
  assert.equal(T.SLOT, "settings.models.provider-card");
});

/* ---- 2. dictionary parity --------------------------------------------- */
check("zh/en dictionaries declare the same keys", () => {
  const zh = Object.keys(T.dictionaries.zh).sort();
  const en = Object.keys(T.dictionaries.en).sort();
  assert.deepEqual(zh, en);
  for (const [locale, dict] of Object.entries(T.dictionaries)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, "string", `${locale}.${key} must be a string`);
      assert.ok(value.length > 0, `${locale}.${key} must not be empty`);
    }
  }
});

/* ---- 3. pure helpers --------------------------------------------------- */
check("deriveKeyRef mirrors the settings page derivation", () => {
  assert.equal(T.deriveKeyRef("acme-gateway"), "ACME_GATEWAY_API_KEY");
  assert.equal(T.deriveKeyRef("acme-gateway-2"), "ACME_GATEWAY_2_API_KEY");
  assert.equal(T.deriveKeyRef("openai"), "OPENAI_API_KEY");
});

check("getPath reads nested records and stops on missing hops", () => {
  const root = { providers: { "acme-gateway": { api: "openai-completions" } } };
  assert.equal(T.getPath(root, ["providers", "acme-gateway", "api"]), "openai-completions");
  assert.equal(T.getPath(root, ["providers", "absent"]), undefined);
  assert.equal(T.getPath(root, ["providers", "acme-gateway", "api", "deep"]), undefined);
  assert.equal(T.getPath(undefined, ["a"]), undefined);
});

check("apiKeyFailure rejects the same shapes the page rejects", () => {
  assert.equal(T.apiKeyFailure(""), "error.keyBlank");
  assert.equal(T.apiKeyFailure("   "), "error.keyBlank");
  assert.equal(T.apiKeyFailure("sk-good-key_123"), null);
  assert.equal(T.apiKeyFailure("OPENAI_API_KEY=sk-abc"), "error.keyFormat");
  assert.equal(T.apiKeyFailure('"sk-quoted"'), "error.keyFormat");
  assert.equal(T.apiKeyFailure("sk-with space"), "error.keyFormat");
  assert.equal(T.apiKeyFailure("sk-中文"), "error.keyFormat");
});

/* ---- fixture: a hand-declared provider profile ------------------------- */
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
const SETTINGS_PATH = ["providers", "acme-gateway"];
function viewFixture(overrides) {
  return Object.assign(
    {
      ns: "llm-pi-ai",
      revision: 12,
      base: { providers: { "acme-gateway": SOURCE } },
      user: undefined,
      value: { providers: { "acme-gateway": SOURCE } },
    },
    overrides
  );
}

check("sourceProfileOf merges base under user and falls back to value", () => {
  const merged = T.sourceProfileOf(
    viewFixture({
      user: { providers: { "acme-gateway": { displayName: "工作号", apiKeyEnv: "WORK_KEY" } } },
    }),
    SETTINGS_PATH
  );
  assert.equal(merged.displayName, "工作号");
  assert.equal(merged.apiKeyEnv, "WORK_KEY");
  assert.equal(merged.baseURL, SOURCE.baseURL, "base fields survive a partial user override");

  const fallback = T.sourceProfileOf(
    viewFixture({ base: undefined, user: undefined, value: { providers: { "acme-gateway": SOURCE } } }),
    SETTINGS_PATH
  );
  assert.equal(fallback.api, "openai-completions");

  assert.equal(T.sourceProfileOf(viewFixture(), []), null);
  assert.equal(T.sourceProfileOf(viewFixture({ base: { providers: {} }, user: undefined, value: { providers: {} } }), SETTINGS_PATH), null);
});

check("suggestIdentity skips ids the directory already owns", () => {
  const free = T.suggestIdentity("acme-gateway", "acme-gateway", new Set(["acme-gateway"]));
  assert.deepEqual(free, { route: "acme-gateway-2", name: "acme-gateway (2)" });

  const shifted = T.suggestIdentity("acme-gateway", "工作号", new Set(["acme-gateway", "acme-gateway-2", "acme-gateway-3"]));
  assert.deepEqual(shifted, { route: "acme-gateway-4", name: "工作号 (4)" });
});

check("planClone copies the source and rebinds the credential", () => {
  const plan = T.planClone({
    view: viewFixture(),
    settingsPath: SETTINGS_PATH,
    taken: new Set(["acme-gateway", "openai"]),
    route: "acme-gateway-2",
    displayName: "acme-gateway (2)",
    apiKey: "  sk-second-key  ",
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.newId, "acme-gateway-2");
  assert.equal(plan.credentialRef, "ACME_GATEWAY_2_API_KEY");
  assert.equal(plan.credentialValue, "sk-second-key", "the key is trimmed");
  assert.equal(plan.profile.api, SOURCE.api);
  assert.equal(plan.profile.baseURL, SOURCE.baseURL);
  assert.deepEqual(plan.profile.models, SOURCE.models);
  assert.equal(plan.profile.displayName, "acme-gateway (2)");
  assert.equal(plan.profile.apiKeyEnv, "ACME_GATEWAY_2_API_KEY");
  assert.deepEqual(plan.ops, [
    { op: "set", path: ["providers", "acme-gateway-2"], value: plan.profile },
  ]);
});

check("planClone with a blank name drops displayName entirely", () => {
  const plan = T.planClone({
    view: viewFixture(),
    settingsPath: SETTINGS_PATH,
    taken: new Set(["acme-gateway"]),
    route: "acme-gateway-2",
    displayName: "   ",
    apiKey: "sk-x",
  });
  assert.equal(plan.ok, true);
  assert.equal("displayName" in plan.profile, false, "the clone falls back to its route id");
});

check("planClone rejects an invalid or occupied route id", () => {
  const base = {
    view: viewFixture(),
    settingsPath: SETTINGS_PATH,
    taken: new Set(["acme-gateway", "openai"]),
    displayName: "",
    apiKey: "sk-x",
  };
  assert.equal(T.planClone({ ...base, route: "" }).messageKey, "error.routeFormat");
  assert.equal(T.planClone({ ...base, route: "Bailian" }).messageKey, "error.routeFormat");
  assert.equal(T.planClone({ ...base, route: "-bad" }).messageKey, "error.routeFormat");
  assert.equal(T.planClone({ ...base, route: "1bad" }).messageKey, "error.routeFormat");
  assert.equal(T.planClone({ ...base, route: "openai" }).messageKey, "error.routeTaken");
});

check("planClone rejects a missing or malformed key", () => {
  const base = {
    view: viewFixture(),
    settingsPath: SETTINGS_PATH,
    taken: new Set(["acme-gateway"]),
    displayName: "",
    route: "acme-gateway-2",
  };
  assert.equal(T.planClone({ ...base, apiKey: "" }).messageKey, "error.keyBlank");
  assert.equal(T.planClone({ ...base, apiKey: "NAME=value" }).messageKey, "error.keyFormat");
});

check("planClone reports an unreadable source", () => {
  assert.equal(
    T.planClone({
      view: viewFixture({ base: undefined, user: undefined, value: { providers: {} } }),
      settingsPath: SETTINGS_PATH,
      taken: new Set(),
      route: "acme-gateway-2",
      displayName: "",
      apiKey: "sk-x",
    }).messageKey,
    "error.sourceMissing"
  );
  assert.equal(
    T.planClone({ view: null, settingsPath: SETTINGS_PATH, taken: new Set(), route: "x-2", apiKey: "sk-x" }).messageKey,
    "error.namespaceMissing"
  );
});

check("fill interpolates without a translation-params dependency", () => {
  assert.equal(T.fill("已创建 {id}，密钥已保存。", { id: "acme-gateway-2" }), "已创建 acme-gateway-2，密钥已保存。");
  assert.equal(T.fill("credential {ref}", { ref: "A_API_KEY" }), "credential A_API_KEY");
});

/* ---- 4. apply() -------------------------------------------------------- */
check("apply registers dictionaries and the keyed provider-card seat", () => {
  const localeCalls = [];
  const registrations = [];
  const injections = [];
  const ctx = {
    effect: (fn) => fn(),
    locale: {
      register: (ns, dicts) => {
        localeCalls.push({ ns, dicts });
        return () => {};
      },
      bind: (ns) => (key) => key,
    },
    slots: {
      inject: (slot, callback) => {
        injections.push(slot);
        return callback();
      },
      register: (options, Component) => {
        registrations.push({ options, Component });
        return () => {};
      },
    },
  };
  mod.apply(ctx);
  assert.deepEqual(injections, ["settings.models.provider-card"]);
  assert.equal(localeCalls.length, 1);
  assert.equal(localeCalls[0].ns, "providerVariants");
  assert.deepEqual(Object.keys(localeCalls[0].dicts).sort(), ["en", "zh"]);
  assert.equal(registrations.length, 1);
  assert.deepEqual(registrations[0].options, {
    name: "settings.models.provider-card",
    id: "provider-variants",
    key: "llm-pi-ai",
  });
  assert.equal(typeof registrations[0].Component, "function");
});

check("the card component renders the trigger and gates on configured", () => {
  const registrations = [];
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => () => {}, bind: () => (key) => `@${key}` },
    slots: {
      inject: (_slot, callback) => callback(),
      register: (options, Component) => {
        registrations.push({ options, Component });
        return () => {};
      },
    },
  };
  mod.apply(ctx);
  const Component = registrations[0].Component;
  const provider = {
    provider: "acme-gateway",
    displayName: "acme-gateway",
    settingsNs: "llm-pi-ai",
    settingsPath: ["providers", "acme-gateway"],
    active: true,
    declared: true,
  };
  const tree = Component({ provider, configured: true, keyConfigured: true });
  assert.ok(tree !== null && tree !== undefined, "a configured row must contribute a node");
  const buttons = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node.type === "button") buttons.push(node);
    walk(node.children);
  };
  walk(tree);
  assert.equal(buttons.length, 1, "exactly one trigger button before opening");
  const label = buttons[0].children[0];
  assert.equal(label, "@action.addKey", "the trigger is localized through the locale service");
  assert.equal(buttons[0].props["aria-expanded"], false);

  assert.equal(Component({ provider, configured: false, keyConfigured: false }), null, "an unconfigured row contributes nothing");
  assert.equal(Component({ provider: null, configured: true }), null, "a malformed owner contributes nothing");
});

console.log(`provider-variants: ${passed.length} checks passed`);
for (const name of passed) console.log(`  ok  ${name}`);
console.log("ALL TESTS PASSED");