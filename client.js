/* Provider Variants — Client half.
 *
 * The Models settings page dispatches a keyed seat onto every provider card it
 * renders (`settings.models.provider-card`, entryKey = the card's settings
 * namespace). We occupy that seat for the pi-ai family and add one action:
 * clone the provider profile under a new, free sibling route id, bound to a new
 * API key. Nothing below the settings layer is special-cased — the clone is an
 * ordinary second entry in the same `providers` dictionary the adapter already
 * reads, so the adapter, the model picker, and the session log all treat it as
 * what it is: another provider route with its own credential.
 *
 * Every read and write crosses the public Remote namespaces the Models page
 * itself uses (`settings.describe` / `settings.mutate` / `credentials.set` /
 * `llm.listProviders` / `llm.listConfigurableProviders`).
 */
window.__ModuleLoader__.load({
  id: "dsh-provider-variants",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const { useState } = React;

    const NS = "providerVariants";
    const SETTINGS_NS = "llm-pi-ai";
    const SLOT = "settings.models.provider-card";
    const SLOT_ID = "provider-variants";

    /* The route grammar the settings page enforces for a hand-declared provider
       id. It is also the grammar a stored pi-ai credential record accepts, so a
       derived `<ID>_API_KEY` reference always addresses a writable record. */
    const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
    /* A key is an HTTP header value: visible ASCII only. */
    const LEGAL_API_KEY = /^[\x21-\x7E]+$/;
    /* A pasted `NAME=value` environment line, narrowed the same way the settings
       page narrows it so base64 padding on an upper-case key is not mistaken for
       an assignment. */
    const ENV_LINE = /^[A-Z][A-Z0-9_]*=[^=]/;

    const zh = {
      "action.addKey": "添加另一个密钥",
      "action.close": "收起",
      "action.cancel": "取消",
      "action.create": "创建",
      "action.creating": "创建中…",
      "form.intro":
        "为同一个上游提供商再建一个条目：协议、端点、模型目录、兼容选项与超时完全复制，只有 Provider ID 和凭据是新的。两个条目会各自出现在 /model 的提供商分组里。",
      "field.route": "Provider ID",
      "field.routeHint":
        "这是适配器路由键、设置段键和凭据前缀，不能与目录里任何提供商重复（含内置路由）。",
      "field.name": "显示名称",
      "field.nameHint": "留空则显示 Provider ID。填成与源条目相同，两个分组看起来就完全一样。",
      "field.key": "API 密钥",
      "hint.credentialRef": "将保存为凭据 {ref}",
      "error.namespaceMissing": "当前部署没有挂载 llm-pi-ai 设置段，无法复制提供商。",
      "error.sourceMissing": "源提供商的配置不在设置层中，无法复制。",
      "error.routeFormat":
        "Provider ID 只能是小写字母、数字与连字符，且以字母开头（例如 acme-gateway-2）。",
      "error.routeTaken": "已有提供商使用了这个 ID。",
      "error.keyBlank": "请输入这次的 API 密钥。",
      "error.keyFormat": "密钥只能包含可见 ASCII 字符，且不能是 NAME=value 形式或整体被引号包裹。",
      "error.readOnly": "当前配置为只读，无法写入。",
      "error.unavailable": "设置服务不可用，无法复制提供商。",
      "error.generic": "写入失败。",
      "status.created": "已创建提供商 {id}，密钥已保存。",
      "status.profileStoredKeyFailed": "提供商已创建，但密钥保存失败：",
    };

    const en = {
      "action.addKey": "Add another key",
      "action.close": "Close",
      "action.cancel": "Cancel",
      "action.create": "Create",
      "action.creating": "Creating…",
      "form.intro":
        "Create a second entry for the same upstream provider: protocol, endpoint, model catalog, compatibility switches, and timeouts are copied — only the Provider ID and the credential are new. Both entries appear as separate provider groups in /model.",
      "field.route": "Provider ID",
      "field.routeHint":
        "This is the adapter route key, the settings key, and the credential prefix, so it cannot repeat any provider in the directory (built-in routes included).",
      "field.name": "Display name",
      "field.nameHint":
        "Leave it blank to show the Provider ID. Type the source entry's own name to make both groups look identical.",
      "field.key": "API key",
      "hint.credentialRef": "Saved as credential {ref}",
      "error.namespaceMissing":
        "This deployment does not mount the llm-pi-ai settings section, so a provider cannot be copied.",
      "error.sourceMissing": "The source provider's profile is not in the settings layers, so it cannot be copied.",
      "error.routeFormat":
        "A Provider ID is lowercase letters, digits, and hyphens, starting with a letter (for example acme-gateway-2).",
      "error.routeTaken": "A provider already uses this ID.",
      "error.keyBlank": "Enter the API key for this entry.",
      "error.keyFormat":
        "A key may contain only visible ASCII characters, and must not be a NAME=value line or wrapped in quotes.",
      "error.readOnly": "This configuration is read-only, so nothing can be written.",
      "error.unavailable": "The settings service is unavailable, so a provider cannot be copied.",
      "error.generic": "The write failed.",
      "status.created": "Created provider {id} with its own key.",
      "status.profileStoredKeyFailed": "The provider was created, but saving its key failed:",
    };

    /* Module-scoped runtime installed by apply(). Components read it lazily so a
       card that renders before apply() settles simply contributes nothing. */
    let runtime = null;

    /* ------------------------------------------------------------------ */
    /* Pure helpers                                                       */
    /* ------------------------------------------------------------------ */

    function isRecord(value) {
      return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    /** Read one path out of a JSON layer; undefined when any hop is absent. */
    function getPath(root, path) {
      let node = root;
      for (const part of path || []) {
        if (!isRecord(node)) return undefined;
        node = node[part];
      }
      return node;
    }

    /**
     * The credential reference the settings page derives for a route and the
     * adapter resolves per request: `<ROUTE>_API_KEY`. Kept identical so a key
     * stored by this plugin and a key stored by the ordinary editor address the
     * same reference.
     */
    function deriveKeyRef(provider) {
      return `${String(provider).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
    }

    /** Whether a value is wrapped in one matching pair of quotes. */
    function isQuoted(value) {
      const first = value[0];
      if (first !== '"' && first !== "'" && first !== "`") return false;
      return value.length > 1 && value[value.length - 1] === first;
    }

    /**
     * Judge a typed key exactly as the models page judges it.
     * @returns the dictionary key of the failure, or null when the key is usable.
     */
    function apiKeyFailure(draft) {
      if (typeof draft !== "string" || draft.length === 0) return "error.keyBlank";
      const value = draft.trim();
      if (value.length === 0) return "error.keyBlank";
      if (ENV_LINE.test(value) || isQuoted(value)) return "error.keyFormat";
      if (!LEGAL_API_KEY.test(value)) return "error.keyFormat";
      return null;
    }

    /**
     * The profile to copy: the composition base layer under the user layer, so a
     * clone carries exactly what the source's layers declare without
     * materializing schema defaults. Falls back to the resolved value when the
     * route exists in no layer.
     * @returns a detached profile object, or null when the source is unreadable.
     */
    function sourceProfileOf(view, path) {
      if (!isRecord(view) || !Array.isArray(path) || path.length === 0) return null;
      const layers = [getPath(view.base, path), getPath(view.user, path)];
      const profile = {};
      let declared = false;
      for (const layer of layers) {
        if (!isRecord(layer)) continue;
        Object.assign(profile, layer);
        declared = true;
      }
      if (!declared) {
        const resolved = getPath(view.value, path);
        if (!isRecord(resolved)) return null;
        return Object.assign({}, resolved);
      }
      return profile;
    }

    /**
     * The first free `<source>-<n>` id and its default label.
     * @param taken - Set (or array) of ids the provider directory already owns.
     */
    function suggestIdentity(sourceId, sourceName, taken) {
      const isTaken = (id) => (taken && typeof taken.has === "function" ? taken.has(id) : Array.isArray(taken) ? taken.includes(id) : false);
      let index = 2;
      while (isTaken(`${sourceId}-${index}`)) index += 1;
      const label = typeof sourceName === "string" && sourceName.trim().length > 0 ? sourceName.trim() : sourceId;
      return { route: `${sourceId}-${index}`, name: `${label} (${index})` };
    }

    /**
     * Build the settings write that clones one provider route.
     * @param input.view - the `llm-pi-ai` namespace view (base/user/value/revision).
     * @param input.settingsPath - the source route's path from the section root.
     * @param input.taken - ids already owned by the provider directory.
     * @param input.route - the new route id the user typed.
     * @param input.displayName - optional label; blank removes the field.
     * @param input.apiKey - the new credential literal.
     * @returns `{ ok: true, newId, credentialRef, credentialValue, profile, ops }`
     *   or `{ ok: false, messageKey }`.
     */
    function planClone(input) {
      const view = input ? input.view : undefined;
      if (!isRecord(view)) return { ok: false, messageKey: "error.namespaceMissing" };
      const path = Array.isArray(input.settingsPath) ? input.settingsPath : [];
      const source = sourceProfileOf(view, path);
      if (source === null) return { ok: false, messageKey: "error.sourceMissing" };

      const id = typeof input.route === "string" ? input.route.trim() : "";
      if (id.length === 0 || !ROUTE_PATTERN.test(id)) return { ok: false, messageKey: "error.routeFormat" };
      const taken = input.taken;
      const isTaken = taken && typeof taken.has === "function" ? taken.has(id) : Array.isArray(taken) ? taken.includes(id) : false;
      if (isTaken) return { ok: false, messageKey: "error.routeTaken" };

      const keyFailure = apiKeyFailure(input.apiKey);
      if (keyFailure !== null) return { ok: false, messageKey: keyFailure };
      const key = input.apiKey.trim();

      const credentialRef = deriveKeyRef(id);
      const profile = Object.assign({}, source, { apiKeyEnv: credentialRef });
      const name = typeof input.displayName === "string" ? input.displayName.trim() : "";
      if (name.length > 0) profile.displayName = name;
      else delete profile.displayName;

      const parent = path.slice(0, -1);
      return {
        ok: true,
        newId: id,
        credentialRef,
        credentialValue: key,
        profile,
        ops: [{ op: "set", path: parent.concat([id]), value: profile }],
      };
    }

    /** Fill `{name}` placeholders without depending on a translation-params API. */
    function fill(text, params) {
      let out = String(text);
      for (const name of Object.keys(params)) out = out.split(`{${name}}`).join(String(params[name]));
      return out;
    }

    /* ------------------------------------------------------------------ */
    /* Remote access                                                      */
    /* ------------------------------------------------------------------ */

    function remoteOf() {
      if (runtime === null) return null;
      const remote = runtime.ctx === undefined || runtime.ctx === null ? undefined : runtime.ctx.remote;
      return isRecord(remote) ? remote : null;
    }

    function messageOf(result) {
      if (!isRecord(result) || !isRecord(result.error)) return undefined;
      const message = result.error.message;
      return typeof message === "string" && message.length > 0 ? message : undefined;
    }

    /** Every route id the provider directory already owns: profiles, catalog routes, live routes. */
    async function collectTaken(view) {
      const remote = remoteOf();
      const taken = new Set();
      const add = (id) => {
        if (typeof id === "string" && id.length > 0) taken.add(id);
      };
      const profiles = getPath(view.value, ["providers"]);
      if (isRecord(profiles)) for (const id of Object.keys(profiles)) add(id);
      if (remote === null) return taken;
      const llm = remote.llm;
      if (!isRecord(llm)) return taken;
      if (typeof llm.listProviders === "function") {
        try {
          const registered = await llm.listProviders();
          if (isRecord(registered) && registered.ok === true && Array.isArray(registered.value)) {
            for (const info of registered.value) add(isRecord(info) ? info.id : undefined);
          }
        } catch (ignored) {
          /* a directory read failure only narrows our pre-check; the Host validates anyway */
        }
      }
      if (typeof llm.listConfigurableProviders === "function") {
        try {
          const declared = await llm.listConfigurableProviders();
          if (isRecord(declared) && declared.ok === true && Array.isArray(declared.value)) {
            for (const entry of declared.value) add(isRecord(entry) ? entry.provider : undefined);
          }
        } catch (ignored) {
          /* same: the Host is the authority */
        }
      }
      return taken;
    }

    /**
     * Read everything one clone needs: the pi-ai namespace view (its layers and
     * revision fence), the taken-id set, and the writability flag.
     */
    async function prepareFor(provider) {
      const t = runtime.t;
      const remote = remoteOf();
      if (remote === null || !isRecord(remote.settings) || typeof remote.settings.describe !== "function") {
        return { failure: t("error.unavailable") };
      }
      let described;
      try {
        described = await remote.settings.describe();
      } catch (thrown) {
        return { failure: thrown && thrown.message ? thrown.message : t("error.unavailable") };
      }
      if (!isRecord(described) || described.ok !== true) {
        return { failure: messageOf(described) || t("error.generic") };
      }
      const value = isRecord(described.value) ? described.value : {};
      const namespaces = Array.isArray(value.namespaces) ? value.namespaces : [];
      const view = namespaces.find((entry) => isRecord(entry) && entry.ns === SETTINGS_NS);
      if (view === undefined) return { failure: t("error.namespaceMissing") };
      const taken = await collectTaken(view);
      const suggestion = suggestIdentity(provider.provider, provider.displayName, taken);
      return {
        view,
        taken,
        writable: value.writable === true,
        route: suggestion.route,
        name: suggestion.name,
      };
    }

    /** Validate the draft, then apply its settings write. */
    async function attemptWrite(target, draft, provider) {
      const plan = planClone({
        view: target.view,
        settingsPath: provider.settingsPath,
        taken: target.taken,
        route: draft.route,
        displayName: draft.name,
        apiKey: draft.key,
      });
      if (!plan.ok) return { kind: "invalid", plan };
      const remote = remoteOf();
      if (remote === null || !isRecord(remote.settings) || typeof remote.settings.mutate !== "function") {
        return { kind: "refused", plan, message: runtime.t("error.unavailable") };
      }
      let written;
      try {
        written = await remote.settings.mutate(SETTINGS_NS, plan.ops, target.view.revision);
      } catch (thrown) {
        return { kind: "refused", plan, message: thrown && thrown.message ? thrown.message : runtime.t("error.generic") };
      }
      if (isRecord(written) && written.ok === true) return { kind: "written", plan };
      const code = isRecord(written) && isRecord(written.error) ? written.error.code : undefined;
      return {
        kind: code === "settings/conflict" ? "conflict" : "refused",
        plan,
        message: messageOf(written),
      };
    }

    /** Store the clone's credential; returns a diagnostic, or null on success. */
    async function storeKey(reference, value) {
      const remote = remoteOf();
      if (remote === null || !isRecord(remote.credentials) || typeof remote.credentials.set !== "function") {
        return runtime.t("error.unavailable");
      }
      try {
        const stored = await remote.credentials.set(reference, value);
        if (isRecord(stored) && stored.ok === true) return null;
        return messageOf(stored) || runtime.t("error.generic");
      } catch (thrown) {
        return thrown && thrown.message ? thrown.message : runtime.t("error.generic");
      }
    }

    /* ------------------------------------------------------------------ */
    /* Styles (theme tokens only)                                         */
    /* ------------------------------------------------------------------ */

    const S = {
      wrap: { display: "flex", flexDirection: "column", gap: "10px" },
      row: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
      trigger: {
        boxSizing: "border-box",
        alignSelf: "flex-start",
        height: "28px",
        padding: "0 10px",
        border: "1px dashed var(--dsw-alias-border-l2)",
        borderRadius: "6px",
        background: "transparent",
        color: "var(--dsw-alias-label-primary)",
        font: "inherit",
        fontSize: "12px",
        lineHeight: "18px",
        cursor: "pointer",
      },
      form: {
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        paddingTop: "10px",
        borderTop: "0.5px solid var(--dsw-alias-border-l1)",
      },
      intro: { margin: "0", color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: "18px" },
      field: { display: "flex", flexDirection: "column", gap: "4px" },
      label: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: "18px", fontWeight: "500" },
      input: {
        boxSizing: "border-box",
        width: "100%",
        height: "32px",
        padding: "0 10px",
        border: "0.5px solid var(--dsw-alias-border-l2)",
        borderRadius: "6px",
        background: "var(--dsw-alias-bg-layer-1)",
        color: "var(--dsw-alias-label-primary)",
        font: "inherit",
        fontSize: "14px",
        lineHeight: "22px",
      },
      hint: { color: "var(--dsw-alias-label-secondary)", fontSize: "12px", lineHeight: "18px" },
      error: { margin: "0", color: "var(--dsw-alias-state-error-primary)", fontSize: "12px", lineHeight: "18px" },
      success: { color: "var(--dsw-alias-state-success-primary)", fontSize: "12px", lineHeight: "18px" },
      actions: { display: "flex", justifyContent: "flex-end", gap: "8px" },
      secondary: {
        boxSizing: "border-box",
        height: "28px",
        padding: "0 10px",
        border: "0.5px solid var(--dsw-alias-border-l2)",
        borderRadius: "6px",
        background: "transparent",
        color: "var(--dsw-alias-label-secondary)",
        font: "inherit",
        fontSize: "12px",
        lineHeight: "18px",
        cursor: "pointer",
      },
      primary: {
        boxSizing: "border-box",
        height: "28px",
        padding: "0 10px",
        border: "1px solid var(--dsw-alias-brand-primary)",
        borderRadius: "6px",
        background: "transparent",
        color: "var(--dsw-alias-brand-primary)",
        font: "inherit",
        fontSize: "12px",
        lineHeight: "18px",
        cursor: "pointer",
      },
      primaryDisabled: {
        boxSizing: "border-box",
        height: "28px",
        padding: "0 10px",
        border: "1px solid var(--dsw-alias-border-l2)",
        borderRadius: "6px",
        background: "transparent",
        color: "var(--dsw-alias-label-secondary)",
        font: "inherit",
        fontSize: "12px",
        lineHeight: "18px",
        cursor: "default",
        opacity: "0.6",
      },
    };

    /** One labelled text field: wrapping <label> associates the input without ids. */
    function fieldOf(labelText, inputProps, hintText) {
      return h(
        "label",
        { key: labelText, style: S.field },
        h("span", { style: S.label }, labelText),
        h("input", Object.assign({ "aria-label": labelText, spellCheck: false }, inputProps, { style: S.input })),
        hintText === null || hintText === undefined ? null : h("span", { style: S.hint }, hintText)
      );
    }

    /* ------------------------------------------------------------------ */
    /* Card extension                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * The provider-card seat: one action plus, once opened, an inline form that
     * clones this card's provider under a new id and its own key.
     */
    function ProviderCardExtras(props) {
      const [open, setOpen] = useState(false);
      const [busy, setBusy] = useState(false);
      const [prepared, setPrepared] = useState(null);
      const [draft, setDraft] = useState(null);
      const [failure, setFailure] = useState(null);
      const [notice, setNotice] = useState(null);

      const active = runtime;
      const provider = isRecord(props) && isRecord(props.provider) ? props.provider : null;
      const configured = isRecord(props) && props.configured === true;
      if (active === null || provider === null || !configured) return null;
      const t = active.t;

      const updateDraft = (patch) => {
        setDraft((current) => (current === null ? current : Object.assign({}, current, patch)));
      };

      const toggle = async () => {
        if (busy) return;
        if (open) {
          setOpen(false);
          setFailure(null);
          return;
        }
        setOpen(true);
        setFailure(null);
        setNotice(null);
        setBusy(true);
        try {
          const next = await prepareFor(provider);
          if (next.failure !== undefined) {
            setPrepared(null);
            setFailure(next.failure);
          } else {
            setPrepared(next);
            setDraft({ route: next.route, name: next.name, key: "" });
          }
        } catch (thrown) {
          setPrepared(null);
          setFailure(thrown && thrown.message ? thrown.message : t("error.generic"));
        } finally {
          setBusy(false);
        }
      };

      const submit = async () => {
        if (busy) return;
        if (prepared === null || draft === null) return;
        if (prepared.writable !== true) {
          setFailure(t("error.readOnly"));
          return;
        }
        setBusy(true);
        setFailure(null);
        setNotice(null);
        try {
          let outcome = await attemptWrite(prepared, draft, provider);
          if (outcome.kind === "conflict") {
            /* The stored revision moved under us. Re-read once, then re-validate
               the same draft against the refreshed directory. */
            const refreshed = await prepareFor(provider);
            if (refreshed.failure === undefined) outcome = await attemptWrite(refreshed, draft, provider);
          }
          if (outcome.kind === "invalid") {
            setFailure(t(outcome.plan.messageKey));
            return;
          }
          if (outcome.kind !== "written") {
            setFailure(outcome.message === undefined ? t("error.generic") : outcome.message);
            return;
          }
          const stored = await storeKey(outcome.plan.credentialRef, outcome.plan.credentialValue);
          setOpen(false);
          setPrepared(null);
          setDraft(null);
          if (stored !== null) {
            setNotice(`${t("status.profileStoredKeyFailed")} ${stored}`);
            return;
          }
          setNotice(fill(t("status.created"), { id: outcome.plan.newId }));
        } catch (thrown) {
          setFailure(thrown && thrown.message ? thrown.message : t("error.generic"));
        } finally {
          setBusy(false);
        }
      };

      const rows = [
        h(
          "div",
          { key: "trigger", style: S.row },
          h(
            "button",
            {
              type: "button",
              style: S.trigger,
              disabled: busy,
              "aria-expanded": open,
              onClick: toggle,
            },
            open ? t("action.close") : t("action.addKey")
          ),
          notice === null
            ? null
            : h("span", { role: "status", "aria-live": "polite", style: S.success, key: "notice" }, notice)
        ),
      ];

      if (open) {
        if (prepared === null) {
          rows.push(
            h(
              "div",
              { key: "form", style: S.form },
              h("p", { role: "alert", style: S.error }, failure === null ? t("error.generic") : failure),
              h(
                "div",
                { style: S.actions },
                h("button", { type: "button", style: S.secondary, disabled: busy, onClick: toggle }, t("action.cancel"))
              )
            )
          );
        } else {
          const routeText = draft === null ? "" : draft.route.trim();
          const referencePreview = routeText.length > 0 && ROUTE_PATTERN.test(routeText) ? deriveKeyRef(routeText) : "…";
          const canCreate = !busy && prepared.writable === true;
          rows.push(
            h(
              "div",
              { key: "form", style: S.form },
              h("p", { style: S.intro }, t("form.intro")),
              fieldOf(
                t("field.route"),
                {
                  type: "text",
                  value: draft === null ? "" : draft.route,
                  placeholder: "acme-gateway-2",
                  disabled: busy,
                  autoComplete: "off",
                  onChange: (event) => updateDraft({ route: event.target.value }),
                },
                t("field.routeHint")
              ),
              fieldOf(
                t("field.name"),
                {
                  type: "text",
                  value: draft === null ? "" : draft.name,
                  disabled: busy,
                  autoComplete: "off",
                  onChange: (event) => updateDraft({ name: event.target.value }),
                },
                t("field.nameHint")
              ),
              fieldOf(
                t("field.key"),
                {
                  type: "password",
                  value: draft === null ? "" : draft.key,
                  disabled: busy,
                  autoComplete: "new-password",
                  onChange: (event) => updateDraft({ key: event.target.value }),
                },
                fill(t("hint.credentialRef"), { ref: referencePreview })
              ),
              failure === null ? null : h("p", { role: "alert", style: S.error }, failure),
              h(
                "div",
                { style: S.actions },
                h(
                  "button",
                  {
                    type: "button",
                    style: canCreate ? S.primary : S.primaryDisabled,
                    disabled: !canCreate,
                    onClick: submit,
                  },
                  busy ? t("action.creating") : t("action.create")
                ),
                h(
                  "button",
                  { type: "button", style: S.secondary, disabled: busy, onClick: toggle },
                  t("action.cancel")
                )
              )
            )
          );
        }
      }

      return h("div", { style: S.wrap }, rows);
    }

    /* ------------------------------------------------------------------ */
    /* Plugin body                                                        */
    /* ------------------------------------------------------------------ */

    const inject = ["slots", "locale", "remote", "remote.settings", "remote.credentials", "remote.llm"];

    function apply(ctx) {
      runtime = { ctx, t: ctx.locale.bind(NS) };
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "provider-variants: copy dictionaries");
      ctx.slots.inject(SLOT, () =>
        ctx.slots.register({ name: SLOT, id: SLOT_ID, key: SETTINGS_NS }, ProviderCardExtras)
      );
    }

    return {
      inject,
      apply,
      _test: {
        SETTINGS_NS,
        SLOT,
        SLOT_ID,
        dictionaries: { zh, en },
        planClone,
        suggestIdentity,
        sourceProfileOf,
        deriveKeyRef,
        apiKeyFailure,
        getPath,
        fill,
      },
    };
  },
});