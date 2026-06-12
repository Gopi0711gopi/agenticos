// ============================================================================
// Peripheral Agentic OS — Topology Type Definitions
// ============================================================================

/** All 12 supported execution topologies */
export type TopologyType =
  | 'sequential'
  | 'parallel'
  | 'hierarchical'
  | 'dag'
  | 'mixture'
  | 'debate'
  | 'mesh'
  | 'star'
  | 'circular'
  | 'grid'
  | 'forest'
  | 'maker';

/** Topology execution context passed to every topology implementation */
export interface TopologyContext {
  /** Execute a single agent with a prompt, handling model routing and tool calls */
  executeAgent: (agentId: string, prompt: string, systemPrompt?: string) => Promise<string>;
  /** Send a message through the centralized MsgHub */
  sendMessage: (from: string, to: string, content: string) => void;
  /** Get all messages for an agent */
  getMessages: (agentId: string) => TopologyMessage[];
  /** Broadcast message to all agents */
  broadcast: (from: string, content: string, exclude?: string[]) => void;
  /** Max rounds for iterative topologies */
  maxRounds: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/** Message passed between agents in a topology */
export interface TopologyMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  round: number;
  timestamp: string;
}

/** Result of topology execution */
export interface TopologyResult {
  topologyType: TopologyType;
  finalOutput: string;
  agentOutputs: Record<string, string>;
  rounds: number;
  totalMessages: number;
  convergenceReason: string;
  durationMs: number;
}

/** DAG node for DAG topology */
export interface DAGNode {
  agentId: string;
  dependencies: string[];
  prompt?: string;
}

/** Grid cell for grid topology */
export interface GridCell {
  row: number;
  col: number;
  agentId: string;
  output: string;
  stable: boolean;
}

/** Forest tree node */
export interface TreeNode {
  agentId: string;
  children: TreeNode[];
  output?: string;
}

/** Maker vote result */
export interface MakerVote {
  voterId: string;
  approved: boolean;
  feedback: string;
}

/** Topology configuration */
export interface TopologyConfig {
  type: TopologyType;
  maxRounds: number;
  convergenceThreshold?: number;
  majorityThreshold?: number;  // For maker topology (default 0.66)
  gridDimensions?: { rows: number; cols: number };
  dagNodes?: DAGNode[];
  trees?: TreeNode[];
}
