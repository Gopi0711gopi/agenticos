// ============================================================================
// Peripheral Agentic OS — Judge & Quality Type Definitions
// ============================================================================

/** Judge profile types */
export type JudgeProfileType = 'default' | 'code' | 'research' | 'creative';

/** Consensus algorithm options */
export type ConsensusAlgorithm = 'weighted_majority' | 'bft' | 'raft';

/** Verdict outcome */
export type VerdictOutcome = 'approve' | 'revise' | 'reject';

/** Goodhart risk level */
export type GoodhartRiskLevel = 'none' | 'low' | 'medium' | 'high';

/** Judge evaluation criteria with weights */
export interface JudgeCriteria {
  name: string;
  weight: number;
  score?: number;
  feedback?: string;
}

/** Judge profile defining evaluation criteria */
export interface JudgeProfile {
  type: JudgeProfileType;
  name: string;
  criteria: JudgeCriteria[];
}

/** Individual judge verdict */
export interface JudgeVerdict {
  judgeId: string;
  modelUsed: string;
  outcome: VerdictOutcome;
  score: number;
  criteria: JudgeCriteria[];
  feedback: string;
  confidence: number;
  timestamp: string;
}

/** Consensus result from multiple judges */
export interface ConsensusResult {
  algorithm: ConsensusAlgorithm;
  outcome: VerdictOutcome;
  finalScore: number;
  votes: JudgeVerdict[];
  entropy: number;
  agreementRatio: number;
  details: string;
}

/** Goodhart detection signal */
export interface GoodhartSignal {
  type: 'cross_model_entropy' | 'calibration_delta' | 'score_inflation' | 'diversity_collapse';
  value: number;
  threshold: number;
  triggered: boolean;
  details: string;
  timestamp: string;
}

/** Goodhart detection result */
export interface GoodhartDetectionResult {
  riskLevel: GoodhartRiskLevel;
  signals: GoodhartSignal[];
  action: 'none' | 'rotate_judge' | 'discard_round';
  details: string;
}

/** Drift snapshot for JSD monitoring */
export interface DriftSnapshot {
  judgeId: string;
  referenceDistribution: number[];
  currentDistribution: number[];
  jsd: number;
  threshold: number;
  drifted: boolean;
  timestamp: string;
}

/** Trilemma status */
export interface TrilemmaStatus {
  optimizationBounded: boolean;
  safetyPreserved: boolean;
  alignmentAnchored: boolean;
  currentQDelta: number;
  maxQDelta: number;
  iterationCount: number;
  maxIterations: number;
  escapeHatch?: string;
  details: string;
}

/** Behavioral contract */
export interface BehavioralContract {
  name: string;
  type: 'budget' | 'response_validity' | 'safety' | 'quality' | 'custom';
  precondition: (context: ContractContext) => boolean;
  postcondition: (context: ContractContext) => boolean;
  description: string;
}

/** Context for contract evaluation */
export interface ContractContext {
  taskId: string;
  budget: number;
  spent: number;
  prompt: string;
  response?: string;
  score?: number;
  safetyPassed?: boolean;
  metadata: Record<string, unknown>;
}

/** Contract violation */
export interface ContractViolation {
  contractName: string;
  phase: 'pre' | 'post';
  details: string;
  taskId: string;
  timestamp: string;
}

/** Default judge profiles as per paper Section 7.1.1 */
export const DEFAULT_JUDGE_PROFILES: Record<JudgeProfileType, JudgeProfile> = {
  default: {
    type: 'default',
    name: 'Default Profile',
    criteria: [
      { name: 'correctness', weight: 0.4 },
      { name: 'completeness', weight: 0.3 },
      { name: 'quality', weight: 0.2 },
      { name: 'safety', weight: 0.1 },
    ],
  },
  code: {
    type: 'code',
    name: 'Code Profile',
    criteria: [
      { name: 'correctness', weight: 0.35 },
      { name: 'completeness', weight: 0.25 },
      { name: 'quality', weight: 0.2 },
      { name: 'security', weight: 0.15 },
      { name: 'performance', weight: 0.05 },
    ],
  },
  research: {
    type: 'research',
    name: 'Research Profile',
    criteria: [
      { name: 'accuracy', weight: 0.4 },
      { name: 'completeness', weight: 0.25 },
      { name: 'sourcing', weight: 0.25 },
      { name: 'clarity', weight: 0.1 },
    ],
  },
  creative: {
    type: 'creative',
    name: 'Creative Profile',
    criteria: [
      { name: 'relevance', weight: 0.3 },
      { name: 'quality', weight: 0.3 },
      { name: 'originality', weight: 0.25 },
      { name: 'coherence', weight: 0.15 },
    ],
  },
};
