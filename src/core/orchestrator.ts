// ============================================================================
// Peripheral Agentic OS — 12-Step Orchestrator Pipeline (~923 lines)
// ============================================================================

import { v4 as uuid } from 'uuid';
import { eventBus } from './event-bus.js';
import { BudgetChecker } from './budget-checker.js';
import { PolicyEngine } from './policy-engine.js';
import { SteeringController } from './steering.js';
import { ModeEngine } from './mode-engine.js';
import { getDatabase } from '../db/database.js';
import { SwarmEngine } from '../swarm/swarm-engine.js';
import { AgentRegistry } from '../swarm/agent-registry.js';
import type { Task, TaskResult, TaskStatus, TaskType, PIPELINE_STEPS } from '../types/task.js';
import type { TeamDesign } from '../types/forge.js';
import type { ConsensusResult, ContractViolation, GoodhartDetectionResult, TrilemmaStatus } from '../types/judge.js';
import type { TopologyResult } from '../types/topology.js';
import type { MemoryAutoInvokeResult } from '../types/memory.js';

/** Forge interface (will be implemented in Phase 3) */
export interface IForge {
  design(prompt: string, taskType: TaskType, budget: number): Promise<TeamDesign>;
  redesign(previousDesign: TeamDesign, feedback: string, count: number): Promise<TeamDesign>;
}

/** Judge interface (will be implemented in Phase 4) */
export interface IJudge {
  assess(taskId: string, prompt: string, output: string, taskType: TaskType): Promise<ConsensusResult>;
}

/** Memory interface (will be implemented in Phase 5) */
export interface IMemory {
  autoInvoke(prompt: string, taskType: TaskType): Promise<MemoryAutoInvokeResult>;
  recordBehavior(taskId: string, agentId: string, pattern: string): Promise<void>;
}

/** RL Trainer interface (will be implemented in Phase 3) */
export interface IRLTrainer {
  recordReward(taskType: string, topology: string, strategy: string, reward: number): void;
  getRecommendation(taskType: string): { topology: string; confidence: number } | null;
}

/** Quality monitors interface */
export interface IQualityMonitors {
  checkGoodhart(taskId: string): Promise<GoodhartDetectionResult | null>;
  checkDrift(taskId: string): Promise<boolean>;
  checkTrilemma(taskId: string, iteration: number): Promise<TrilemmaStatus | null>;
  checkContracts(taskId: string, phase: 'pre' | 'post', context: Record<string, unknown>): Promise<ContractViolation[]>;
}

/** Orchestrator configuration */
export interface OrchestratorConfig {
  maxRedesigns: number;
  maxBudgetMultiplier: number;
  defaultBudget: number;
  qualityThreshold: number;
  enableSimulation: boolean;
}

/**
 * The 12-Step Orchestrator Pipeline.
 * Every task traverses: Initialize → Memory → Forge → Simulate → Security →
 * Swarm → Judge → Redesign → RL → Behavior → Format → Finalize
 */
export class Orchestrator {
  private budgetChecker: BudgetChecker;
  private policyEngine: PolicyEngine;
  private steering: SteeringController;
  private modeEngine: ModeEngine;
  private swarmEngine: SwarmEngine;
  private registry: AgentRegistry;
  private config: OrchestratorConfig;

  // Pluggable components (set via setters)
  private forge?: IForge;
  private judge?: IJudge;
  private memory?: IMemory;
  private rlTrainer?: IRLTrainer;
  private qualityMonitors?: IQualityMonitors;

  constructor(
    registry: AgentRegistry,
    swarmEngine: SwarmEngine,
    modeEngine: ModeEngine,
    config?: Partial<OrchestratorConfig>
  ) {
    this.registry = registry;
    this.swarmEngine = swarmEngine;
    this.modeEngine = modeEngine;
    this.budgetChecker = new BudgetChecker(config?.qualityThreshold);
    this.policyEngine = new PolicyEngine();
    this.steering = new SteeringController();
    this.config = {
      maxRedesigns: config?.maxRedesigns ?? modeEngine.getMaxRedesigns(),
      maxBudgetMultiplier: config?.maxBudgetMultiplier ?? modeEngine.getMaxBudgetMultiplier(),
      defaultBudget: config?.defaultBudget ?? 1.0,
      qualityThreshold: config?.qualityThreshold ?? 0.6,
      enableSimulation: config?.enableSimulation ?? modeEngine.isSimulationEnabled(),
    };
  }

  // ---------- Component setters ----------
  setForge(forge: IForge): void { this.forge = forge; }
  setJudge(judge: IJudge): void { this.judge = judge; }
  setMemory(memory: IMemory): void { this.memory = memory; }
  setRLTrainer(trainer: IRLTrainer): void { this.rlTrainer = trainer; }
  setQualityMonitors(monitors: IQualityMonitors): void { this.qualityMonitors = monitors; }

  /** Get steering controller for external access */
  getSteering(): SteeringController { return this.steering; }

  /**
   * Run a task through the complete 12-step pipeline.
   */
  async run(prompt: string, options: {
    budget?: number;
    taskType?: TaskType;
    forceTopology?: string;
    metadata?: Record<string, unknown>;
  } = {}): Promise<TaskResult> {
    const taskId = uuid();
    const budget = options.budget ?? this.config.defaultBudget;
    const startTime = Date.now();

    // ===== STEP 0: Initialize =====
    await this.emitStep(taskId, 0, 'initialize');
    const task = await this.stepInitialize(taskId, prompt, budget, options.taskType, options.metadata);

    // Setup steering
    this.steering.init(taskId);

    let currentDesign: TeamDesign | undefined;
    let topologyResult: TopologyResult | undefined;
    let judgeResult: ConsensusResult | undefined;
    let redesignCount = 0;

    try {
      // ===== STEP 1: Memory Injection =====
      let steer = await this.steering.checkSteering(taskId);
      if (steer === 'cancel') return this.buildCancelledResult(taskId, startTime);

      await this.emitStep(taskId, 1, 'memory_injection');
      const memoryContext = await this.stepMemoryInjection(prompt, task.type);

      // ===== STEP 2: Forge Design =====
      steer = await this.steering.checkSteering(taskId);
      if (steer === 'cancel') return this.buildCancelledResult(taskId, startTime);

      await this.emitStep(taskId, 2, 'forge_design');
      currentDesign = await this.stepForgeDesign(prompt, task.type, budget);

      // ===== STEP 3: Simulation (power mode only) =====
      if (this.config.enableSimulation) {
        steer = await this.steering.checkSteering(taskId);
        if (steer === 'cancel') return this.buildCancelledResult(taskId, startTime);

        await this.emitStep(taskId, 3, 'simulation');
        // Simulation is optional — placeholder for future implementation
      }

      // ===== STEP 4: Security Validation =====
      steer = await this.steering.checkSteering(taskId);
      if (steer === 'cancel') return this.buildCancelledResult(taskId, startTime);

      await this.emitStep(taskId, 4, 'security_validation');
      const securityResult = this.stepSecurityValidation(prompt);
      if (!securityResult.allowed) {
        await this.updateTaskStatus(taskId, 'failed');
        return this.buildFailedResult(taskId, startTime, 'Security policy violation: ' + securityResult.violations.map(v => v.details).join('; '));
      }

      // ===== Pre-execution contract check =====
      if (this.qualityMonitors) {
        const preViolations = await this.qualityMonitors.checkContracts(taskId, 'pre', {
          budget,
          spent: 0,
          prompt,
        });
        if (preViolations.length > 0) {
          return this.buildFailedResult(taskId, startTime, 'Pre-contract violation: ' + preViolations.map(v => v.details).join('; '));
        }
      }

      // ===== REDESIGN LOOP =====
      let approved = false;
      while (!approved && redesignCount <= this.config.maxRedesigns) {
        // ===== STEP 5: Swarm Execution =====
        steer = await this.steering.checkSteering(taskId);
        if (steer === 'cancel') return this.buildCancelledResult(taskId, startTime);

        await this.emitStep(taskId, 5, 'swarm_execution');
        await this.updateTaskStatus(taskId, 'executing');

        // Run quality monitors in parallel
        const qualityPromise = this.runQualityMonitors(taskId, redesignCount);

        topologyResult = await this.stepSwarmExecution(currentDesign!, prompt);

        // Wait for quality monitors
        const qualityResults = await qualityPromise;

        // ===== STEP 6: Judge Assessment =====
        steer = await this.steering.checkSteering(taskId);
        if (steer === 'cancel') return this.buildCancelledResult(taskId, startTime);

        await this.emitStep(taskId, 6, 'judge_assessment');
        await this.updateTaskStatus(taskId, 'judging');
        judgeResult = await this.stepJudgeAssessment(taskId, prompt, topologyResult.finalOutput, task.type);

        if (judgeResult.outcome === 'approve' || judgeResult.finalScore >= this.config.qualityThreshold) {
          approved = true;
        } else {
          // ===== STEP 7: Redesign Loop =====
          redesignCount++;

          // Check budget cap for redesign
          const budgetCheck = this.budgetChecker.checkRedesignBudget(taskId, this.config.maxBudgetMultiplier);
          if (!budgetCheck.allowed || redesignCount > this.config.maxRedesigns) {
            // Human escalation
            await this.updateTaskStatus(taskId, 'pending_human_review');
            eventBus.emit('task:human_escalation', {
              taskId,
              redesignCount,
              reason: redesignCount > this.config.maxRedesigns ? 'Max redesigns exceeded' : 'Budget exhausted',
            }, 'Orchestrator');
            break;
          }

          await this.emitStep(taskId, 7, 'redesign_loop');
          await this.updateTaskStatus(taskId, 'redesigning');
          eventBus.emit('task:redesign_triggered', {
            taskId,
            count: redesignCount,
            verdict: judgeResult.outcome,
            feedback: judgeResult.details,
          }, 'Orchestrator');

          currentDesign = await this.stepRedesign(currentDesign!, judgeResult.details, redesignCount);
        }
      }

      // ===== STEP 8: RL Learning =====
      await this.emitStep(taskId, 8, 'rl_learning');
      await this.stepRLLearning(task.type, currentDesign!, judgeResult!);

      // ===== STEP 9: Behavior Capture =====
      await this.emitStep(taskId, 9, 'behavior_capture');
      await this.stepBehaviorCapture(taskId, currentDesign!);

      // ===== STEP 10: Output Formatting =====
      await this.emitStep(taskId, 10, 'output_formatting');
      const formattedOutput = this.stepOutputFormatting(topologyResult!, judgeResult!);

      // ===== STEP 11: Finalize =====
      await this.emitStep(taskId, 11, 'finalize');
      const result = await this.stepFinalize(taskId, formattedOutput, topologyResult!, judgeResult!, redesignCount, startTime);

      return result;

    } catch (error) {
      await this.updateTaskStatus(taskId, 'failed');
      eventBus.emit('task:failed', { taskId, error: String(error) }, 'Orchestrator');
      return this.buildFailedResult(taskId, startTime, String(error));
    } finally {
      this.steering.cleanup(taskId);
    }
  }

  // ==================== Step Implementations ====================

  private async stepInitialize(
    taskId: string, prompt: string, budget: number, taskType?: TaskType, metadata?: Record<string, unknown>
  ): Promise<Task> {
    const type = taskType ?? this.classifyTask(prompt);
    const task: Task = {
      id: taskId,
      prompt,
      type,
      status: 'initializing',
      budget,
      spent: 0,
      redesignCount: 0,
      maxRedesigns: this.config.maxRedesigns,
      metadata: metadata ?? {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Persist task
    const db = getDatabase().getDb();
    db.prepare(`
      INSERT INTO tasks (id, prompt, type, status, budget, spent, redesign_count, max_redesigns, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, prompt, type, 'initializing', budget, 0, 0, this.config.maxRedesigns, JSON.stringify(metadata ?? {}));

    eventBus.emit('task:created', { taskId, type, budget }, 'Orchestrator');
    return task;
  }

  private async stepMemoryInjection(prompt: string, taskType: TaskType): Promise<MemoryAutoInvokeResult | null> {
    if (!this.memory) return null;
    try {
      return await this.memory.autoInvoke(prompt, taskType);
    } catch {
      return null;
    }
  }

  private async stepForgeDesign(prompt: string, taskType: TaskType, budget: number): Promise<TeamDesign> {
    if (this.forge) {
      return this.forge.design(prompt, taskType, budget);
    }
    // Default simple sequential design
    return {
      id: uuid(),
      taskType,
      topology: 'sequential',
      agents: [
        {
          name: 'worker',
          role: 'General Worker',
          description: 'Handles the task directly',
          systemPrompt: 'You are a helpful AI assistant. Complete the task thoroughly.',
          tools: [],
          order: 0,
        },
      ],
      toolMappings: {},
      modelMappings: {},
      metadata: {},
      createdAt: new Date().toISOString(),
    };
  }

  private stepSecurityValidation(prompt: string) {
    return this.policyEngine.evaluate(prompt);
  }

  private async stepSwarmExecution(design: TeamDesign, prompt: string): Promise<TopologyResult> {
    return this.swarmEngine.execute(design, prompt);
  }

  private async stepJudgeAssessment(
    taskId: string, prompt: string, output: string, taskType: TaskType
  ): Promise<ConsensusResult> {
    if (this.judge) {
      return this.judge.assess(taskId, prompt, output, taskType);
    }
    // Default: auto-approve
    return {
      algorithm: 'weighted_majority',
      outcome: 'approve',
      finalScore: 0.8,
      votes: [],
      entropy: 0,
      agreementRatio: 1.0,
      details: 'Auto-approved (no judge configured)',
    };
  }

  private async stepRedesign(design: TeamDesign, feedback: string, count: number): Promise<TeamDesign> {
    if (this.forge) {
      return this.forge.redesign(design, feedback, count);
    }
    return design; // No forge, return same design
  }

  private async stepRLLearning(taskType: TaskType, design: TeamDesign, judgeResult: ConsensusResult): Promise<void> {
    if (!this.modeEngine.isRLEnabled() || !this.rlTrainer) return;

    const reward = judgeResult.finalScore;
    this.rlTrainer.recordReward(
      taskType,
      design.topology,
      'balanced', // Default strategy
      reward
    );

    eventBus.emit('router:q_table_updated', {
      taskType,
      topology: design.topology,
      reward,
    }, 'Orchestrator');
  }

  private async stepBehaviorCapture(taskId: string, design: TeamDesign): Promise<void> {
    if (!this.memory) return;
    for (const agent of design.agents) {
      await this.memory.recordBehavior(taskId, agent.name, JSON.stringify({
        role: agent.role,
        topology: design.topology,
      }));
    }
  }

  private stepOutputFormatting(topologyResult: TopologyResult, judgeResult: ConsensusResult): string {
    return topologyResult.finalOutput;
  }

  private async stepFinalize(
    taskId: string,
    output: string,
    topologyResult: TopologyResult,
    judgeResult: ConsensusResult,
    redesignCount: number,
    startTime: number
  ): Promise<TaskResult> {
    const durationMs = Date.now() - startTime;

    // Get total cost from task
    const db = getDatabase().getDb();
    const task = db.prepare('SELECT spent FROM tasks WHERE id = ?').get(taskId) as { spent: number } | undefined;
    const cost = task?.spent ?? 0;

    const result: TaskResult = {
      taskId,
      output,
      score: judgeResult.finalScore,
      cost,
      durationMs,
      topologyUsed: topologyResult.topologyType,
      agentCount: Object.keys(topologyResult.agentOutputs).length,
      redesignCount,
      judgeVerdict: judgeResult.outcome,
      qualityReport: {
        judgeScore: judgeResult.finalScore,
        consensusAlgorithm: judgeResult.algorithm,
        entropy: judgeResult.entropy,
        goodhartRisk: 'none',
        driftDetected: false,
        contractViolations: [],
        trilemmaStatus: 'bounded',
      },
    };

    // Persist result
    db.prepare(`
      INSERT INTO task_results (task_id, output, score, cost, duration_ms, topology_used, agent_count, redesign_count, judge_verdict, quality_report)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, output.substring(0, 50000), result.score, cost, durationMs, topologyResult.topologyType, result.agentCount, redesignCount, judgeResult.outcome, JSON.stringify(result.qualityReport));

    // Update task status
    await this.updateTaskStatus(taskId, 'completed');
    db.prepare('UPDATE tasks SET completed_at = datetime("now"), redesign_count = ? WHERE id = ?')
      .run(redesignCount, taskId);

    eventBus.emit('task:completed', {
      taskId,
      score: result.score,
      cost,
      durationMs,
      topology: topologyResult.topologyType,
    }, 'Orchestrator');

    return result;
  }

  // ==================== Helper Methods ====================

  private async runQualityMonitors(taskId: string, iteration: number): Promise<void> {
    if (!this.qualityMonitors) return;
    // Run monitors in parallel — they don't block execution
    await Promise.allSettled([
      this.qualityMonitors.checkGoodhart(taskId),
      this.qualityMonitors.checkDrift(taskId),
      this.qualityMonitors.checkTrilemma(taskId, iteration),
    ]);
  }

  private classifyTask(prompt: string): TaskType {
    const lower = prompt.toLowerCase();
    if (/\b(code|implement|function|class|api|bug|debug|program|script)\b/.test(lower)) return 'code';
    if (/\b(research|study|analyze|paper|literature|survey|findings)\b/.test(lower)) return 'research';
    if (/\b(analyze|data|statistics|metrics|trend|report|chart)\b/.test(lower)) return 'analysis';
    if (/\b(write|story|poem|creative|design|art|blog|essay)\b/.test(lower)) return 'creative';
    return 'custom';
  }

  private async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const db = getDatabase().getDb();
    db.prepare('UPDATE tasks SET status = ?, updated_at = datetime("now") WHERE id = ?')
      .run(status, taskId);
    eventBus.emit('task:step_completed', { taskId, status }, 'Orchestrator');
  }

  private async emitStep(taskId: string, step: number, name: string): Promise<void> {
    eventBus.emit('task:step_started', { taskId, step, name }, 'Orchestrator');

    // Save checkpoint
    const db = getDatabase().getDb();
    db.prepare('INSERT INTO task_checkpoints (task_id, step, step_name, state) VALUES (?, ?, ?, ?)')
      .run(taskId, step, name, '{}');
  }

  private buildCancelledResult(taskId: string, startTime: number): TaskResult {
    return {
      taskId, output: 'Task cancelled', score: 0, cost: 0,
      durationMs: Date.now() - startTime, topologyUsed: 'none',
      agentCount: 0, redesignCount: 0, judgeVerdict: 'cancelled',
    };
  }

  private buildFailedResult(taskId: string, startTime: number, error: string): TaskResult {
    return {
      taskId, output: `Error: ${error}`, score: 0, cost: 0,
      durationMs: Date.now() - startTime, topologyUsed: 'none',
      agentCount: 0, redesignCount: 0, judgeVerdict: 'failed',
    };
  }
}
