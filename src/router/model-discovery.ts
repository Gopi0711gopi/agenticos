// ============================================================================
// Peripheral Agentic OS — Model Discovery Engine (~380 lines)
// ============================================================================

import { eventBus } from '../core/event-bus.js';
import type { ModelInfo, ModelProvider, DiscoveryResult } from '../types/model.js';

/** Discovery configuration per provider */
interface DiscoveryConfig {
  provider: ModelProvider;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
}

/**
 * Dynamic model discovery engine.
 * Queries 10 provider catalog APIs at startup to build a live model catalog.
 * Results cache with configurable TTL.
 */
export class ModelDiscovery {
  private configs: Map<ModelProvider, DiscoveryConfig>;
  private cache: Map<ModelProvider, { models: ModelInfo[]; expiry: number }>;
  private cacheTTL: number;

  constructor(cacheTTL = 3600000) { // 1 hour default
    this.configs = new Map();
    this.cache = new Map();
    this.cacheTTL = cacheTTL;
  }

  /** Configure a provider for discovery */
  configureProvider(config: DiscoveryConfig): void {
    this.configs.set(config.provider, config);
  }

  /** Discover models from all configured providers */
  async discoverAll(): Promise<DiscoveryResult[]> {
    eventBus.emit('system:discovery_started', { providers: this.configs.size }, 'ModelDiscovery');
    const results: DiscoveryResult[] = [];

    const discoveries = await Promise.allSettled(
      [...this.configs.values()]
        .filter(c => c.enabled)
        .map(c => this.discoverProvider(c))
    );

    for (const result of discoveries) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }

    const totalModels = results.reduce((sum, r) => sum + r.models.length, 0);
    eventBus.emit('system:discovery_completed', {
      providers: results.length,
      totalModels,
    }, 'ModelDiscovery');

    return results;
  }

  /** Discover models from a single provider */
  async discoverProvider(config: DiscoveryConfig): Promise<DiscoveryResult> {
    // Check cache
    const cached = this.cache.get(config.provider);
    if (cached && Date.now() < cached.expiry) {
      return { provider: config.provider, models: cached.models, discoveredAt: new Date().toISOString() };
    }

    eventBus.emit('router:discovery_started', { provider: config.provider }, 'ModelDiscovery');

    try {
      let models: ModelInfo[];

      switch (config.provider) {
        case 'openai':
        case 'lmstudio':
        case 'vllm':
          models = await this.discoverOpenAICompatible(config);
          break;
        case 'anthropic':
          models = await this.discoverAnthropic(config);
          break;
        case 'google':
          models = await this.discoverGoogle(config);
          break;
        case 'ollama':
          models = await this.discoverOllama(config);
          break;
        case 'azure':
          models = await this.discoverAzure(config);
          break;
        case 'llamacpp':
          models = await this.discoverLlamaCpp(config);
          break;
        case 'huggingface':
          models = await this.discoverHuggingFace(config);
          break;
        default:
          models = [];
      }

      // Cache results
      this.cache.set(config.provider, { models, expiry: Date.now() + this.cacheTTL });

      eventBus.emit('router:discovery_completed', { provider: config.provider, modelCount: models.length }, 'ModelDiscovery');
      return { provider: config.provider, models, discoveredAt: new Date().toISOString() };

    } catch (error) {
      eventBus.emit('router:discovery_error', { provider: config.provider, error: String(error) }, 'ModelDiscovery');
      return { provider: config.provider, models: [], discoveredAt: new Date().toISOString(), error: String(error) };
    }
  }

  // ===== Provider-Specific Discovery =====

  private async discoverOpenAICompatible(config: DiscoveryConfig): Promise<ModelInfo[]> {
    const headers: Record<string, string> = {};
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

    const resp = await fetch(`${config.baseUrl}/v1/models`, { headers });
    if (!resp.ok) return [];

    const data = await resp.json() as any;
    return (data.data || []).map((m: any) => this.toModelInfo(m.id, config.provider, m));
  }

  private async discoverAnthropic(config: DiscoveryConfig): Promise<ModelInfo[]> {
    // Anthropic doesn't have a public model listing API — return known models
    return [
      this.createModelInfo('claude-sonnet-4-20250514', 'anthropic', 0.85, 0.000003, 0.000015, 200000),
      this.createModelInfo('claude-haiku-4-20250514', 'anthropic', 0.75, 0.00000025, 0.00000125, 200000),
      this.createModelInfo('claude-opus-4-20250514', 'anthropic', 0.95, 0.000015, 0.000075, 200000),
    ];
  }

  private async discoverGoogle(config: DiscoveryConfig): Promise<ModelInfo[]> {
    try {
      const resp = await fetch(`${config.baseUrl}/models?key=${config.apiKey}`);
      if (!resp.ok) return this.getDefaultGoogleModels();
      const data = await resp.json() as any;
      return (data.models || [])
        .filter((m: any) => m.name?.includes('gemini'))
        .map((m: any) => this.toModelInfo(m.name?.replace('models/', ''), 'google', m));
    } catch {
      return this.getDefaultGoogleModels();
    }
  }

  private async discoverOllama(config: DiscoveryConfig): Promise<ModelInfo[]> {
    try {
      const resp = await fetch(`${config.baseUrl}/api/tags`);
      if (!resp.ok) return [];
      const data = await resp.json() as any;
      return (data.models || []).map((m: any) => this.createModelInfo(
        m.name, 'ollama', 0.6, 0, 0, m.details?.parameter_size ? parseInt(m.details.parameter_size) * 500 : 4096, true
      ));
    } catch {
      return [];
    }
  }

  private async discoverAzure(config: DiscoveryConfig): Promise<ModelInfo[]> {
    // Azure requires specific endpoint format
    try {
      const resp = await fetch(`${config.baseUrl}/models?api-version=2024-02-01`, {
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
      });
      if (!resp.ok) return [];
      const data = await resp.json() as any;
      return (data.data || data.value || []).map((m: any) =>
        this.toModelInfo(m.id || m.model, 'azure', m)
      );
    } catch {
      return [];
    }
  }

  private async discoverLlamaCpp(config: DiscoveryConfig): Promise<ModelInfo[]> {
    try {
      const resp = await fetch(`${config.baseUrl}/v1/models`);
      if (!resp.ok) return [];
      const data = await resp.json() as any;
      return (data.data || []).map((m: any) => this.createModelInfo(m.id, 'llamacpp', 0.5, 0, 0, 4096, true));
    } catch {
      return [];
    }
  }

  private async discoverHuggingFace(config: DiscoveryConfig): Promise<ModelInfo[]> {
    try {
      const resp = await fetch(`${config.baseUrl}/info`, {
        headers: config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {},
      });
      if (!resp.ok) return [];
      const data = await resp.json() as any;
      return [this.createModelInfo(data.model_id || 'hf-model', 'huggingface', 0.5, 0, 0, data.max_total_tokens || 4096)];
    } catch {
      return [];
    }
  }

  // ===== Helpers =====

  private toModelInfo(id: string, provider: ModelProvider, raw: any): ModelInfo {
    return {
      id, name: id, provider,
      qualityScore: this.estimateQuality(id),
      costPerInputToken: 0.000003,
      costPerOutputToken: 0.000015,
      contextWindow: raw?.context_window || raw?.context_length || 4096,
      capabilities: ['chat'],
      isLocal: ['ollama', 'lmstudio', 'llamacpp', 'vllm'].includes(provider),
      discoveredAt: new Date().toISOString(),
    };
  }

  private createModelInfo(
    id: string, provider: ModelProvider, quality: number,
    inputCost: number, outputCost: number, contextWindow: number, isLocal = false
  ): ModelInfo {
    return {
      id, name: id, provider, qualityScore: quality,
      costPerInputToken: inputCost, costPerOutputToken: outputCost,
      contextWindow, capabilities: ['chat'],
      isLocal, discoveredAt: new Date().toISOString(),
    };
  }

  private estimateQuality(modelId: string): number {
    const id = modelId.toLowerCase();
    if (id.includes('opus') || id.includes('gpt-4') || id.includes('gpt-5')) return 0.9;
    if (id.includes('sonnet') || id.includes('gemini-pro') || id.includes('claude-3')) return 0.8;
    if (id.includes('haiku') || id.includes('mini') || id.includes('flash')) return 0.7;
    if (id.includes('llama') || id.includes('mistral')) return 0.65;
    return 0.5;
  }

  private getDefaultGoogleModels(): ModelInfo[] {
    return [
      this.createModelInfo('gemini-2.5-pro', 'google', 0.85, 0.000001, 0.000002, 1000000),
      this.createModelInfo('gemini-2.5-flash', 'google', 0.75, 0.0000001, 0.0000004, 1000000),
    ];
  }

  /** Invalidate cache for a provider */
  invalidateCache(provider?: ModelProvider): void {
    if (provider) {
      this.cache.delete(provider);
    } else {
      this.cache.clear();
    }
  }

  /** Get all cached models */
  getAllCachedModels(): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const cached of this.cache.values()) {
      models.push(...cached.models);
    }
    return models;
  }
}
