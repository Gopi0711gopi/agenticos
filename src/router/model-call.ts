// ============================================================================
// Peripheral Agentic OS — Model Call Layer (10 Providers, ~1122 lines)
// ============================================================================

import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type {
  ModelCallRequest, ModelCallResponse, ModelProvider,
  CircuitBreaker, CircuitBreakerState, ChatMessage
} from '../types/model.js';

/** Provider configuration */
export interface ProviderConfig {
  provider: ModelProvider;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
}

/**
 * Model Call Layer supporting 10 providers with circuit breakers
 * and exponential backoff retry.
 */
export class ModelCallService {
  private providers: Map<ModelProvider, ProviderConfig>;
  private circuitBreakers: Map<ModelProvider, CircuitBreaker>;
  private maxRetries = 3;
  private baseRetryMs = 100;
  private maxRetryMs = 5000;
  private jitter = 0.25;

  constructor() {
    this.providers = new Map();
    this.circuitBreakers = new Map();
  }

  /** Configure a provider */
  configureProvider(config: ProviderConfig): void {
    this.providers.set(config.provider, config);
    this.circuitBreakers.set(config.provider, {
      provider: config.provider,
      state: 'closed',
      failureCount: 0,
      maxFailures: 5,
      resetTimeoutMs: 60000,
    });
  }

  /** Call a model with automatic retry and circuit breaking */
  async call(request: ModelCallRequest): Promise<ModelCallResponse> {
    const provider = request.provider || this.detectProvider(request.model);
    const config = this.providers.get(provider);

    if (!config?.enabled) {
      throw new Error(`Provider ${provider} is not configured or enabled`);
    }

    const breaker = this.circuitBreakers.get(provider)!;
    if (breaker.state === 'open') {
      if (Date.now() < new Date(breaker.resetAt!).getTime()) {
        throw new Error(`Circuit breaker open for ${provider}`);
      }
      breaker.state = 'half-open';
      eventBus.emit('router:circuit_half_open', { provider }, 'ModelCallService');
    }

    const start = Date.now();

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        eventBus.emit('router:model_called', {
          model: request.model,
          provider,
          attempt,
        }, 'ModelCallService');

        const response = await this.callProvider(provider, config, request);

        // Success — reset circuit breaker
        breaker.state = 'closed';
        breaker.failureCount = 0;
        eventBus.emit('router:circuit_closed', { provider }, 'ModelCallService');

        // Record performance
        const db = getDatabase().getDb();
        db.prepare(`
          INSERT INTO model_performance (model_id, provider, latency_ms, success, tokens_used, cost, quality_score)
          VALUES (?, ?, ?, 1, ?, ?, ?)
        `).run(request.model, provider, response.durationMs, response.tokenUsage.totalTokens, response.cost, 0);

        eventBus.emit('router:model_responded', {
          model: request.model,
          provider,
          durationMs: response.durationMs,
          tokens: response.tokenUsage.totalTokens,
        }, 'ModelCallService');

        return response;

      } catch (error) {
        breaker.failureCount++;
        breaker.lastFailure = new Date().toISOString();

        if (breaker.failureCount >= breaker.maxFailures) {
          breaker.state = 'open';
          breaker.resetAt = new Date(Date.now() + breaker.resetTimeoutMs).toISOString();
          eventBus.emit('router:circuit_opened', { provider, failures: breaker.failureCount }, 'ModelCallService');
        }

        if (attempt < this.maxRetries - 1) {
          const delay = Math.min(
            this.baseRetryMs * Math.pow(2, attempt) * (1 + Math.random() * this.jitter),
            this.maxRetryMs
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          eventBus.emit('router:model_error', {
            model: request.model,
            provider,
            error: String(error),
          }, 'ModelCallService');
          throw error;
        }
      }
    }

    throw new Error('Max retries exceeded');
  }

  /** Call the specific provider API */
  private async callProvider(
    provider: ModelProvider, config: ProviderConfig, request: ModelCallRequest
  ): Promise<ModelCallResponse> {
    const start = Date.now();

    switch (provider) {
      case 'openai':
      case 'azure':
      case 'lmstudio':
      case 'llamacpp':
      case 'vllm':
        return this.callOpenAICompatible(config, request, start);

      case 'anthropic':
        return this.callAnthropic(config, request, start);

      case 'google':
        return this.callGoogle(config, request, start);

      case 'ollama':
        return this.callOllama(config, request, start);

      case 'bedrock':
        return this.callBedrock(config, request, start);

      case 'huggingface':
        return this.callHuggingFace(config, request, start);

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /** OpenAI-compatible API (OpenAI, Azure, LM Studio, llama.cpp, vLLM) */
  private async callOpenAICompatible(
    config: ProviderConfig, request: ModelCallRequest, start: number
  ): Promise<ModelCallResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

    const body = {
      model: request.model,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.name && { name: m.name }),
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
      })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      ...(request.tools && { tools: request.tools.map(t => ({ type: 'function', function: t })) }),
      ...(request.responseFormat === 'json' && { response_format: { type: 'json_object' } }),
    };

    const url = `${config.baseUrl}/chat/completions`;
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`${config.provider} API error ${resp.status}: ${errorText}`);
    }

    const data = await resp.json() as any;
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content || '',
      model: data.model || request.model,
      provider: config.provider as ModelProvider,
      tokenUsage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      cost: this.calculateCost(config.provider as ModelProvider, data.usage),
      durationMs: Date.now() - start,
      toolCalls: choice?.message?.tool_calls?.map((tc: any) => ({
        id: tc.id, name: tc.function.name, arguments: tc.function.arguments,
      })),
      finishReason: choice?.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
    };
  }

  /** Anthropic Claude API */
  private async callAnthropic(
    config: ProviderConfig, request: ModelCallRequest, start: number
  ): Promise<ModelCallResponse> {
    const systemMsg = request.messages.find(m => m.role === 'system');
    const userMsgs = request.messages.filter(m => m.role !== 'system');

    const body = {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      ...(systemMsg && { system: systemMsg.content }),
      messages: userMsgs.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
      temperature: request.temperature ?? 0.7,
    };

    const resp = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`Anthropic error ${resp.status}: ${await resp.text()}`);

    const data = await resp.json() as any;
    return {
      content: data.content?.[0]?.text || '',
      model: data.model || request.model,
      provider: 'anthropic',
      tokenUsage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      cost: this.calculateCost('anthropic', data.usage),
      durationMs: Date.now() - start,
      finishReason: data.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
    };
  }

  /** Google Gemini API */
  private async callGoogle(
    config: ProviderConfig, request: ModelCallRequest, start: number
  ): Promise<ModelCallResponse> {
    const contents = request.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const systemInstruction = request.messages.find(m => m.role === 'system');

    const body = {
      contents,
      ...(systemInstruction && { systemInstruction: { parts: [{ text: systemInstruction.content }] } }),
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
      },
    };

    const url = `${config.baseUrl}/models/${request.model}:generateContent?key=${config.apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`Google error ${resp.status}: ${await resp.text()}`);

    const data = await resp.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
      content: text,
      model: request.model,
      provider: 'google',
      tokenUsage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      cost: this.calculateCost('google', data.usageMetadata),
      durationMs: Date.now() - start,
      finishReason: 'stop',
    };
  }

  /** Ollama API */
  private async callOllama(
    config: ProviderConfig, request: ModelCallRequest, start: number
  ): Promise<ModelCallResponse> {
    const body = {
      model: request.model,
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 4096,
      },
    };

    const resp = await fetch(`${config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`Ollama error ${resp.status}: ${await resp.text()}`);

    const data = await resp.json() as any;
    return {
      content: data.message?.content || '',
      model: data.model || request.model,
      provider: 'ollama',
      tokenUsage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      cost: 0,
      durationMs: Date.now() - start,
      finishReason: 'stop',
    };
  }

  /** AWS Bedrock (stub) */
  private async callBedrock(
    config: ProviderConfig, request: ModelCallRequest, start: number
  ): Promise<ModelCallResponse> {
    throw new Error('Bedrock provider requires AWS SDK — configure via environment');
  }

  /** HuggingFace TGI */
  private async callHuggingFace(
    config: ProviderConfig, request: ModelCallRequest, start: number
  ): Promise<ModelCallResponse> {
    const lastMsg = request.messages[request.messages.length - 1];
    const body = { inputs: lastMsg.content, parameters: { max_new_tokens: request.maxTokens ?? 512, temperature: request.temperature ?? 0.7 } };

    const resp = await fetch(config.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`HuggingFace error ${resp.status}: ${await resp.text()}`);
    const data = await resp.json() as any;
    const text = Array.isArray(data) ? data[0]?.generated_text || '' : data.generated_text || '';

    return {
      content: text, model: request.model, provider: 'huggingface',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: 0, durationMs: Date.now() - start, finishReason: 'stop',
    };
  }

  /** Detect provider from model name */
  private detectProvider(model: string): ModelProvider {
    if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('gemini') || model.startsWith('models/gemini')) return 'google';
    if (model.includes('llama') || model.includes('mistral') || model.includes('phi')) return 'ollama';
    return 'openai'; // Default fallback
  }

  /** Calculate cost based on usage */
  private calculateCost(provider: ModelProvider, usage: any): number {
    if (!usage) return 0;
    // Simplified pricing (would load from catalog in production)
    const pricing: Record<string, { input: number; output: number }> = {
      openai: { input: 0.000003, output: 0.000015 },
      anthropic: { input: 0.000003, output: 0.000015 },
      google: { input: 0.000001, output: 0.000002 },
      ollama: { input: 0, output: 0 },
      azure: { input: 0.000003, output: 0.000015 },
    };
    const p = pricing[provider] || { input: 0, output: 0 };
    const input = usage.prompt_tokens || usage.input_tokens || usage.promptTokenCount || 0;
    const output = usage.completion_tokens || usage.output_tokens || usage.candidatesTokenCount || 0;
    return input * p.input + output * p.output;
  }

  /** Get configured providers */
  getConfiguredProviders(): ModelProvider[] {
    return [...this.providers.entries()].filter(([, c]) => c.enabled).map(([p]) => p);
  }
}
