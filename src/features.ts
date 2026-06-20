// Feature flags / edição (núcleo sempre livre; avançados gateáveis no futuro).
// Lido UMA vez no boot. Os botões de features avançadas consultam isto pra
// aparecer/desabilitar. Hoje (open-source) tudo vem ligado.
import { invoke } from "@tauri-apps/api/core";

export type Tier = "core" | "pro";

export interface FeatureFlags {
  tier: Tier;
  ai_analysis: boolean;
  color_plan: boolean;
  oficina_encode: boolean;
  motionsilk: boolean;
  sync_catalog: boolean;
}

// Default permissivo: se a leitura falhar, o núcleo continua 100% e os avançados
// não somem por engano (degradação segura — nunca trava o app por causa do gate).
const DEFAULT_FLAGS: FeatureFlags = {
  tier: "core",
  ai_analysis: true,
  color_plan: true,
  oficina_encode: true,
  motionsilk: true,
  sync_catalog: true,
};

let cached: FeatureFlags = DEFAULT_FLAGS;

export async function loadFeatureFlags(): Promise<FeatureFlags> {
  try {
    cached = await invoke<FeatureFlags>("feature_flags");
  } catch {
    cached = DEFAULT_FLAGS;
  }
  return cached;
}

// Acesso síncrono ao último valor lido (pra usar em render sem await).
export function features(): FeatureFlags {
  return cached;
}
