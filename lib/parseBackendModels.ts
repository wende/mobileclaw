import type { ModelChoice } from "@/types/chat";

export interface ConfigParseResult {
  /** Provider keys that have explicit model lists in models.providers */
  explicitProviders: Set<string>;
  /** Models parsed from models.providers (curated list) */
  explicitModels: ModelChoice[];
  /** Provider keys found only in auth.profiles (no models.providers entry) */
  authOnlyProviders: Set<string>;
}

/** Parse config.get response to extract explicit models and auth-only provider keys. */
export function parseConfigProviders(resPayload: Record<string, unknown>): ConfigParseResult {
  const explicitProviders = new Set<string>();
  const explicitModels: ModelChoice[] = [];
  const authOnlyProviders = new Set<string>();

  // Try resolved first (includes env var substitution), fall back to parsing raw
  const config = (resPayload.resolved ?? resPayload.config) as Record<string, unknown> | undefined;
  const rawStr = resPayload.raw as string | undefined;

  let cfg: Record<string, unknown> | undefined;
  if (config && typeof config === "object") {
    cfg = config;
  } else if (rawStr) {
    try { cfg = JSON.parse(rawStr); } catch { /* ignore */ }
  }
  if (!cfg) return { explicitProviders, explicitModels, authOnlyProviders };

  // Explicit model providers — parse their curated model lists
  const modelProviders = (cfg.models as any)?.providers;
  if (modelProviders && typeof modelProviders === "object") {
    for (const [providerKey, providerConfig] of Object.entries(modelProviders) as [string, any][]) {
      explicitProviders.add(providerKey);
      const models = providerConfig?.models;
      if (!Array.isArray(models)) continue;
      for (const m of models) {
        if (!m?.id) continue;
        explicitModels.push({
          id: `${providerKey}/${m.id}`,
          name: m.name || m.id,
          provider: providerKey,
          contextWindow: m.contextWindow,
          reasoning: m.reasoning,
        });
      }
    }
  }

  // Auth profiles reference providers implicitly (e.g. google-antigravity)
  const authProfiles = (cfg.auth as any)?.profiles;
  if (authProfiles && typeof authProfiles === "object") {
    for (const profile of Object.values(authProfiles) as any[]) {
      const provider = profile?.provider;
      if (provider && !explicitProviders.has(provider)) {
        authOnlyProviders.add(provider);
      }
    }
  }

  return { explicitProviders, explicitModels, authOnlyProviders };
}

/** Merge explicit models from config with models.list entries for auth-only providers. */
export function mergeModels(configResult: ConfigParseResult, catalog: any[]): ModelChoice[] {
  // Start with the curated explicit models
  const models = [...configResult.explicitModels];

  // Add models from catalog ONLY for auth-only providers (not in models.providers)
  for (const entry of catalog) {
    if (!entry?.id || !entry?.provider) continue;
    if (!configResult.authOnlyProviders.has(entry.provider)) continue;
    models.push({
      id: `${entry.provider}/${entry.id}`,
      name: entry.name || entry.id,
      provider: entry.provider,
      contextWindow: entry.contextWindow,
      reasoning: entry.reasoning,
    });
  }

  return models;
}
