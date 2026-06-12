// ============================================================================
// Peripheral Agentic OS — Bridge Type Definitions
// MCP (Model Context Protocol) & A2A (Agent-to-Agent) Protocol Types
// ============================================================================

// ── MCP Types ─────────────────────────────────────────────────────────────

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<MCPToolResult>;
}

export interface MCPToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: () => Promise<string>;
}

export interface MCPPrompt {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  handler: (args: Record<string, string>) => Promise<{ role: string; content: string }[]>;
}

export type MCPTransport = 'stdio' | 'sse' | 'websocket';

export interface MCPServerConfig {
  name: string;
  version: string;
  transport: MCPTransport;
  port?: number;
  capabilities: {
    tools: boolean;
    resources: boolean;
    prompts: boolean;
  };
}

export interface MCPClientConfig {
  serverUrl: string;
  transport: MCPTransport;
  timeout: number;
}

// ── A2A Types ─────────────────────────────────────────────────────────────

export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: A2ACapability[];
  skills: A2ASkill[];
  authentication?: { schemes: string[]; credentials?: string };
}

export interface A2ACapability {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  inputModes: string[];
  outputModes: string[];
  tags: string[];
}

export interface A2ATask {
  id: string;
  sessionId: string;
  status: A2ATaskStatus;
  messages: A2AMessage[];
  artifacts: A2AArtifact[];
  metadata?: Record<string, unknown>;
}

export interface A2ATaskStatus {
  state: 'submitted' | 'working' | 'input-required' | 'completed' | 'canceled' | 'failed';
  message?: string;
  timestamp: string;
}

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
  timestamp: string;
}

export type A2APart =
  | { type: 'text'; text: string }
  | { type: 'file'; file: { name: string; mimeType: string; bytes: string } }
  | { type: 'data'; data: Record<string, unknown> };

export interface A2AArtifact {
  name: string;
  description?: string;
  parts: A2APart[];
  index: number;
}

// ── Bridge Registry ───────────────────────────────────────────────────────

export interface BridgeConnection {
  id: string;
  protocol: 'mcp' | 'a2a';
  direction: 'inbound' | 'outbound';
  status: 'connected' | 'disconnected' | 'error';
  endpoint: string;
  agentCard?: A2AAgentCard;
  connectedAt: string;
  lastActivity: string;
  messagesExchanged: number;
}
