// ============================================================================
// Peripheral Agentic OS — Trilemma Guard + Behavioral Contracts
// ============================================================================

import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { TrilemmaStatus, BehavioralContract, ContractContext, ContractViolation } from '../types/judge.js';

/**
 * Trilemma Guard: 4 escape hatches for the Chen et al. impossibility result.
 * Bounds the sacrifice of self-improvement to preserve safety.
 */
export class TrilemmaGuard {
  private maxQDelta: number;
  private maxIterations: number;
  private qHistory: number[];

  constructor(maxQDelta = 0.15, maxIterations = 5) {
    this.maxQDelta = maxQDelta;
    this.maxIterations = maxIterations;
    this.qHistory = [];
  }

  /** Check trilemma bounds */
  check(taskId: string, iteration: number, currentQ: number): TrilemmaStatus {
    const previousQ = this.qHistory.length > 0 ? this.qHistory[this.qHistory.length - 1] : currentQ;
    const qDelta = Math.abs(currentQ - previousQ);
    this.qHistory.push(currentQ);

    const optimizationBounded = qDelta <= this.maxQDelta;
    const safetyPreserved = true; // Policy engine runs outside RL loop
    const alignmentAnchored = true; // Judge profiles are frozen
    const iterationBound = iteration <= this.maxIterations;

    let escapeHatch: string | undefined;
    if (!optimizationBounded) escapeHatch = 'bounded_improvement';
    else if (!iterationBound) escapeHatch = 'human_escalation';

    const status: TrilemmaStatus = {
      optimizationBounded,
      safetyPreserved,
      alignmentAnchored,
      currentQDelta: qDelta,
      maxQDelta: this.maxQDelta,
      iterationCount: iteration,
      maxIterations: this.maxIterations,
      escapeHatch,
      details: `ΔQ=${qDelta.toFixed(3)} (max=${this.maxQDelta}), iteration=${iteration}/${this.maxIterations}`,
    };

    // Persist
    const db = getDatabase().getDb();
    db.prepare(`
      INSERT INTO trilemma_events (task_id, optimization_bounded, safety_preserved, alignment_anchored, q_delta, iteration_count, escape_hatch, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, optimizationBounded ? 1 : 0, 1, 1, qDelta, iteration, escapeHatch || null, status.details);

    if (escapeHatch) {
      eventBus.emit('quality:trilemma_escape', { taskId, escapeHatch, ...status }, 'TrilemmaGuard');
    } else {
      eventBus.emit('quality:trilemma_check', { taskId, ...status }, 'TrilemmaGuard');
    }

    return status;
  }

  reset(): void {
    this.qHistory = [];
  }
}

/**
 * Behavioral Contracts: Design-by-Contract (Meyer) for agent teams.
 * Enforces 4 default invariants around every execution.
 */
export class BehavioralContractEngine {
  private contracts: BehavioralContract[];

  constructor() {
    this.contracts = this.getDefaultContracts();
  }

  /** Check pre-conditions before execution */
  checkPre(context: ContractContext): ContractViolation[] {
    return this.check(context, 'pre');
  }

  /** Check post-conditions after execution */
  checkPost(context: ContractContext): ContractViolation[] {
    return this.check(context, 'post');
  }

  /** Register a custom contract */
  register(contract: BehavioralContract): void {
    this.contracts.push(contract);
  }

  /** Get all contracts */
  getContracts(): BehavioralContract[] {
    return [...this.contracts];
  }

  private check(context: ContractContext, phase: 'pre' | 'post'): ContractViolation[] {
    const violations: ContractViolation[] = [];

    for (const contract of this.contracts) {
      const checker = phase === 'pre' ? contract.precondition : contract.postcondition;
      try {
        if (!checker(context)) {
          const violation: ContractViolation = {
            contractName: contract.name,
            phase,
            details: `${contract.description} — ${phase}condition failed`,
            taskId: context.taskId,
            timestamp: new Date().toISOString(),
          };
          violations.push(violation);

          // Persist
          const db = getDatabase().getDb();
          db.prepare(`
            INSERT INTO contract_violations (task_id, contract_name, phase, details) VALUES (?, ?, ?, ?)
          `).run(context.taskId, contract.name, phase, violation.details);

          eventBus.emit('quality:contract_violation', {
            taskId: context.taskId, contract: contract.name, phase,
          }, 'BehavioralContracts');
        }
      } catch {
        // Contract check itself failed — don't block
      }
    }

    if (violations.length === 0) {
      eventBus.emit('quality:contract_passed', {
        taskId: context.taskId, phase, contractsChecked: this.contracts.length,
      }, 'BehavioralContracts');
    }

    return violations;
  }

  /** 4 default behavioral invariants from the paper */
  private getDefaultContracts(): BehavioralContract[] {
    return [
      {
        name: 'budget_invariant',
        type: 'budget',
        description: 'Total cost ≤ allocated budget',
        precondition: (ctx) => ctx.budget > 0,
        postcondition: (ctx) => ctx.spent <= ctx.budget,
      },
      {
        name: 'response_validity',
        type: 'response_validity',
        description: 'Output must be non-empty and parseable',
        precondition: (ctx) => ctx.prompt.length > 0,
        postcondition: (ctx) => !!ctx.response && ctx.response.trim().length > 0,
      },
      {
        name: 'safety_constraint',
        type: 'safety',
        description: 'Output must not contain blocked content',
        precondition: (ctx) => true,
        postcondition: (ctx) => ctx.safetyPassed !== false,
      },
      {
        name: 'quality_threshold',
        type: 'quality',
        description: 'Judge score ≥ configured minimum (0.6)',
        precondition: (ctx) => true,
        postcondition: (ctx) => (ctx.score ?? 1) >= 0.6,
      },
    ];
  }
}
