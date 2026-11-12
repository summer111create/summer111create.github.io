import { KimiProvider } from "./kimi.js";
import { DeepSeekProvider } from "./deepseek.js";
import { QwenProvider } from "./qwen.js";
import { DoubaoProvider } from "./doubao.js";
import { GlmProvider } from "./glm.js";

const PROVIDER_TYPES = {
  deepseek: DeepSeekProvider,
  doubao: DoubaoProvider,
  glm: GlmProvider,
  kimi: KimiProvider,
  qwen: QwenProvider,
};

export class ProviderRegistry {
  constructor(config, browser) {
    this.providers = new Map();
    this.models = new Map();

    for (const providerConfig of config.providers) {
      const Provider = PROVIDER_TYPES[providerConfig.type];
      if (!Provider) {
        throw new Error(`Unknown provider type: ${providerConfig.type}`);
      }
      const provider = new Provider(providerConfig, browser);
      this.providers.set(provider.id, provider);

      for (const model of provider.listModels()) {
        if (this.models.has(model.id)) {
          throw new Error(`Duplicate public model id: ${model.id}`);
        }
        this.models.set(model.id, { provider, model: model.upstreamModel, publicModel: model });
      }
    }
  }

  listModels() {
    return [...this.models.values()].map(({ provider, publicModel }) => ({
      id: publicModel.id,
      object: "model",
      created: 0,
      owned_by: provider.id,
    }));
  }

  resolve(modelRef) {
    const normalized = String(modelRef || "").trim();
    const direct = this.models.get(normalized);
    if (direct) {
      return { provider: direct.provider, model: direct.model };
    }

    for (const { provider, model, publicModel } of this.models.values()) {
      if (publicModel.aliases?.includes(normalized)) {
        return { provider, model };
      }
    }

    throw new Error(
      `Unknown model '${modelRef}'. Available: ${[...this.models.keys()].join(", ")}`,
    );
  }
}
