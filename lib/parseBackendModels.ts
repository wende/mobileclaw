import type { ModelChoice } from "@/types/chat";

/** Parse model choices from an OpenClaw config.get response payload. */
export function parseBackendModels(resPayload: Record<string, unknown>): ModelChoice[] {
  const raw = (resPayload as { raw?: string })?.raw;
  if (!raw) return [];

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    console.error("[config.get] Failed to parse raw config:", e);
    return [];
  }

  const providers = (config.models as any)?.providers;
  if (!providers) return [];

  // Flatten provider models into a single list
  const models = Object.entries(providers).flatMap(([providerKey, providerConfig]: [string, any]) => {
    const providerModels = providerConfig.models;
    if (!Array.isArray(providerModels)) return [];

    return providerModels
      .filter((m: any) => m.id)
      .map((m: any) => ({
        id: `${providerKey}/${m.id}`,
        name: m.name || m.id,
        provider: providerKey,
        contextWindow: m.contextWindow,
        reasoning: m.reasoning,
      }));
  });

  console.log("[config.get] Parsed models:", models);
  return models;
}
