// ============================================================================
// Peripheral Agentic OS — Task Type Definitions
// ============================================================================

/** Task classification types */
export type TaskType = 'code' | 'research' | 'analysis' | 'creative' | 'custom';

/** Task status lifecycle */
export type TaskStatus =
  | 'pending'
  | 'initializing'
  | 'designing'
  | 'simulating'
  | 'validating'
  | 'executing'
  | 'judging'
  | 'redesigning'
  | 'learning'
  | 'formatting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'pending_human_review';

/** Steering actions for mid-flight control */
export type SteeringAction = 'pause' | 'resume' | 'redirect' | 'cancel';

/** Full task definition */
export interface Task {
  id: string;
  prompt: string;
  type: TaskType;
  status: TaskStatus;
  budget: number;
  spent: number;
  teamId?: string;
  parentTaskId?: string;
  redesignCount: number;
  maxRedesigns: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/** Task execution result */
export interface TaskResult {
  taskId: string;
  output: string;
  score: number;
  cost: number;
  durationMs: number;
  topologyUsed: string;
  agentCount: number;
  redesignCount: number;
  judgeVerdict?: string;
  qualityReport?: QualityReport;
  attributionData?: AttributionData;
}

/** Quality report attached to task result */
export interface QualityReport {
  judgeScore: number;
  consensusAlgorithm: string;
  entropy: number;
  goodhartRisk: string;
  driftDetected: boolean;
  contractViolations: string[];
  trilemmaStatus: string;
}

/** Attribution data for provenance */
export interface AttributionData {
  visibleCredit: string;
  hmacSignature: string;
  watermarkEmbedded: boolean;
  timestampHash?: string;
}

/** Steering command */
export interface SteeringCommand {
  taskId: string;
  action: SteeringAction;
  newPrompt?: string;  // For redirect
  reason: string;
  timestamp: string;
}

/** Task checkpoint for recovery */
export interface TaskCheckpoint {
  taskId: string;
  step: number;
  stepName: string;
  state: Record<string, unknown>;
  timestamp: string;
}

/** Pipeline step definition */
export interface PipelineStep {
  index: number;
  name: string;
  description: string;
}

/** The 12 pipeline steps */
export const PIPELINE_STEPS: PipelineStep[] = [
  { index: 0,  name: 'initialize',       description: 'Budget check, task registration, steering setup' },
  { index: 1,  name: 'memory_injection',  description: 'SLM-Lite context recall via autoInvoke()' },
  { index: 2,  name: 'forge_design',      description: 'Automatic team composition' },
  { index: 3,  name: 'simulation',        description: 'Optional pre-execution simulation (power mode)' },
  { index: 4,  name: 'security_validation', description: 'Policy evaluation' },
  { index: 5,  name: 'swarm_execution',   description: 'Topology-specific agent dispatch' },
  { index: 6,  name: 'judge_assessment',  description: 'Multi-criteria quality evaluation' },
  { index: 7,  name: 'redesign_loop',     description: 'On rejection, returns to forge_design (max 5)' },
  { index: 8,  name: 'rl_learning',       description: 'Composite reward recording' },
  { index: 9,  name: 'behavior_capture',  description: 'Per-agent behavioral pattern storage' },
  { index: 10, name: 'output_formatting', description: 'Result assembly and disk persistence' },
  { index: 11, name: 'finalize',          description: 'Database update, event emission, cleanup' },
];
