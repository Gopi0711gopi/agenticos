// ============================================================================
// Peripheral Agentic OS — Model & Routing Type Definitions
// ============================================================================

/** Supported LLM providers */
export type ModelProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'azure'
  | 'ollama'
  | 'lmstudio'
  | 'llamacpp'
  | 'vllm'
  | 'bedrock'
  | 'huggingface';

/** Routing strategy options */
export type RoutingStrategy = 'quality' | 'balanced' | 'cost' | 'cascade' | 'pomdp';

/** Model information from discovery */
export interface ModelInfo {
  id: string;
  name: string;
  provider: ModelProvider;
  qualityScore: number;    // 0.0 - 1.0
  costPerInputToken: number;
  costPerOutputToken: number;
  contextWindow: number;
  capabilities: string[];
  isLocal: boolean;
  discoveredAt: string;
  lastVerified?: string;
}

/** Model call request */
export interface ModelCallRequest {
  model: string;
  provider?: ModelProvider;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  responseFormat?: 'text' | 'json';
  budget?: number;
}

/** Chat message format */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/** Tool definition for model calls */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Tool call from model response */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Model call response */
export interface ModelCallResponse {
  content: string;
  model: string;
  provider: ModelProvider;
  tokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: number;
  durationMs: number;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

/** Circuit breaker state */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/** Circuit breaker for provider reliability */
export interface CircuitBreaker {
  provider: ModelProvider;
  state: CircuitBreakerState;
  failureCount: number;
  lastFailure?: string;
  resetAt?: string;
  maxFailures: number;
  resetTimeoutMs: number;
}

/** Q-table entry for RL routing */
export interface QTableEntry {
  state: string;   // taskTypeHash_modelCountBucket_budgetClass
  action: RoutingStrategy;
  value: number;
  visits: number;
  lastUpdated: string;
}

/** POMDP belief state */
export type QualityLevel = 'low' | 'medium' | 'high';

export interface POMDPBelief {
  low: number;
  medium: number;
  high: number;
}

/** Model discovery result */
export interface DiscoveryResult {
  provider: ModelProvider;
  models: ModelInfo[];
  discoveredAt: string;
  error?: string;
}

/** Routing decision record */
export interface RoutingDecision {
  taskId: string;
  strategy: RoutingStrategy;
  selectedModel: string;
  selectedProvider: ModelProvider;
  reason: string;
  candidates: number;
  cost: number;
  timestamp: string;
}
