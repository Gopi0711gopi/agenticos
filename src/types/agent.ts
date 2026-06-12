// ============================================================================
// Peripheral Agentic OS — Agent Type Definitions
// ============================================================================

/** Agent lifecycle states (5-state FSM) */
export type AgentState = 'idle' | 'working' | 'paused' | 'error' | 'terminated';

/** Agent capability tiers for routing and judge weighting */
export type AgentTier = 'frontier' | 'standard' | 'lightweight';

/** Agent role in a team */
export interface AgentRole {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model?: string;
  tier?: AgentTier;
}

/** Full agent specification (created by Forge or imported) */
export interface AgentSpec {
  id: string;
  name: string;
  role: AgentRole;
  state: AgentState;
  teamId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Agent execution result */
export interface AgentResult {
  agentId: string;
  agentName: string;
  output: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: TokenUsage;
  cost: number;
  durationMs: number;
  error?: string;
}

/** Record of a tool call made by an agent */
export interface ToolCallRecord {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
  timestamp: string;
}

/** Token usage tracking */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Agent state transition */
export interface AgentTransition {
  agentId: string;
  fromState: AgentState;
  toState: AgentState;
  reason: string;
  timestamp: string;
}

/** Agent behavioral pattern (stored in procedural memory) */
export interface AgentBehavior {
  agentId: string;
  taskType: string;
  pattern: string;
  successRate: number;
  sampleSize: number;
  lastUsed: string;
}
