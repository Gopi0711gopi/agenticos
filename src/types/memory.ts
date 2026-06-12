// ============================================================================
// Peripheral Agentic OS — Memory Type Definitions (SLM-Lite)
// ============================================================================

/** Memory layer types */
export type MemoryLayer = 'working' | 'episodic' | 'semantic' | 'procedural';

/** Base memory entry */
export interface MemoryEntry {
  id: string;
  layer: MemoryLayer;
  content: string;
  metadata: Record<string, unknown>;
  accessCount: number;
  trustScore: number;
  createdAt: string;
  lastAccessedAt: string;
  expiresAt?: string;
}

/** Working memory entry (volatile, in-memory Map) */
export interface WorkingMemoryEntry extends MemoryEntry {
  layer: 'working';
  ttlMs: number;
}

/** Episodic memory entry (event/session based with FTS5) */
export interface EpisodicMemoryEntry extends MemoryEntry {
  layer: 'episodic';
  sessionId: string;
  eventType: string;
  importance: number;
  embedding?: number[];
}

/** Semantic memory entry (long-term knowledge with trust) */
export interface SemanticMemoryEntry extends MemoryEntry {
  layer: 'semantic';
  category: string;
  source: 'user' | 'agent' | 'system';
  credibility: number;
  contradictionScore: number;
  crossValidated: boolean;
}

/** Procedural memory entry (learned patterns) */
export interface ProceduralMemoryEntry extends MemoryEntry {
  layer: 'procedural';
  pattern: string;
  taskType: string;
  successRate: number;
  sampleSize: number;
  strategy: string;
}

/** Memory promotion rule */
export interface PromotionRule {
  from: MemoryLayer;
  to: MemoryLayer;
  condition: string;
  threshold: number;
}

/** Trust score components: T = C · (1-R) · D · V */
export interface TrustComponents {
  credibility: number;      // C: source credibility (user=1.0, agent=0.7)
  contradictionScore: number; // R: contradiction score
  temporalDecay: number;    // D: temporal decay
  crossValidation: number;  // V: cross-validation agreement
}

/** Belief graph node */
export interface BeliefNode {
  id: string;
  content: string;
  confidence: number;
  source: string;
  createdAt: string;
  decayRate: number;
}

/** Belief graph edge (causal relationship) */
export interface BeliefEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationship: 'supports' | 'contradicts' | 'causes' | 'correlates';
  strength: number;
  createdAt: string;
}

/** Memory query result */
export interface MemoryQueryResult {
  entries: MemoryEntry[];
  totalCount: number;
  queryTimeMs: number;
  layer: MemoryLayer;
}

/** Memory auto-invoke result (context recall) */
export interface MemoryAutoInvokeResult {
  workingContext: string[];
  episodicContext: string[];
  semanticContext: string[];
  proceduralHints: string[];
  totalRecalled: number;
}

/** Default promotion rules (6 rules from paper) */
export const DEFAULT_PROMOTION_RULES: PromotionRule[] = [
  { from: 'working', to: 'episodic', condition: 'accessCount >= threshold', threshold: 3 },
  { from: 'episodic', to: 'semantic', condition: 'sessions >= 2 && trustScore >= threshold', threshold: 0.6 },
  { from: 'episodic', to: 'procedural', condition: 'isPattern && successRate >= threshold', threshold: 0.7 },
  { from: 'working', to: 'semantic', condition: 'source === "user" && trustScore >= threshold', threshold: 0.8 },
  { from: 'semantic', to: 'procedural', condition: 'isActionable && validated', threshold: 0.9 },
  { from: 'procedural', to: 'semantic', condition: 'generalized && sampleSize >= threshold', threshold: 10 },
];
