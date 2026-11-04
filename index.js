/**
 * Host half of the provider-variants bundle.
 *
 * The whole capability lives in the Client module declared by `dsh.client`: the
 * Models page dispatches its provider cards to us through the
 * `settings.models.provider-card` slot, and every read and write crosses the
 * public `settings` / `credentials` / `llm` Remote namespaces. Nothing here
 * needs a Host service, a Config, or a restart — the row exists so the package
 * owns a bundle patch and can carry its browser module.
 */
export function apply() {}