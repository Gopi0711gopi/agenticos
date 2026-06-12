// ============================================================================
// Peripheral Agentic OS — Forge Type Definitions
// ============================================================================

import type { TopologyType } from './topology.js';
import type { TaskType } from './task.js';

/** Team design produced by Forge */
export interface TeamDesign {
  id: string;
  taskType: TaskType;
  topology: TopologyType;
  agents: ForgeAgentDef[];
  toolMappings: Record<string, string[]>;  // agentName → tools
  modelMappings: Record<string, string>;   // agentName → model
  metadata: Record<string, unknown>;
  score?: number;
  createdAt: string;
}

/** Agent definition within a Forge team design */
export interface ForgeAgentDef {
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model?: string;
  order?: number;        // For sequential/circular
  position?: GridPosition; // For grid topology
  treeId?: number;       // For forest topology
  parentAgent?: string;  // For hierarchical/forest
}

/** Grid position for grid topology agents */
export interface GridPosition {
  row: number;
  col: number;
}

/** Forge configuration for team design */
export interface ForgeConfig {
  maxRedesigns: number;
  designQualityThreshold: number;
  defaultTopology: TopologyType;
  forceTopology?: TopologyType;
  availableTools: string[];
  availableModels: string[];
  budget: number;
}

/** Forge design history entry */
export interface ForgeDesignRecord {
  id: string;
  taskType: TaskType;
  taskPrompt: string;
  design: TeamDesign;
  score: number;
  verdict: 'approved' | 'rejected';
  feedback?: string;
  redesignOf?: string;
  createdAt: string;
}

/** Forge redesign request */
export interface RedesignRequest {
  taskId: string;
  previousDesign: TeamDesign;
  verdict: string;
  feedback: string;
  redesignCount: number;
  maxRedesigns: number;
}

/** Forge strategy recommendation from RL */
export interface StrategyRecommendation {
  taskType: TaskType;
  recommendedTopology: TopologyType;
  confidence: number;
  basedOn: number;  // Number of historical observations
}
