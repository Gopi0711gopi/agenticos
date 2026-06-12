// ============================================================================
// Peripheral Agentic OS — Budget Checker
// ============================================================================

import { eventBus } from './event-bus.js';
import { getDatabase } from '../db/database.js';

export interface BudgetCheckResult {
  allowed: boolean;
  remaining: number;
  spent: number;
  budget: number;
  warning: boolean;
  message: string;
}

/**
 * Budget checker for task cost enforcement.
 * Enforces pre/post budget invariants from behavioral contracts.
 */
export class BudgetChecker {
  private warnThreshold: number;

  constructor(warnThreshold = 0.8) {
    this.warnThreshold = warnThreshold;
  }

  /** Check if a task can proceed given its budget */
  check(taskId: string, budget: number, additionalCost = 0): BudgetCheckResult {
    const db = getDatabase().getDb();
    const task = db.prepare('SELECT spent, budget FROM tasks WHERE id = ?').get(taskId) as
      { spent: number; budget: number } | undefined;

    const spent = task?.spent ?? 0;
    const taskBudget = task?.budget ?? budget;
    const remaining = taskBudget - spent;
    const projectedSpent = spent + additionalCost;
    const allowed = projectedSpent <= taskBudget;
    const warning = (projectedSpent / taskBudget) >= this.warnThreshold;

    if (warning && allowed) {
      eventBus.emit('task:budget_warning', {
        taskId,
        spent: projectedSpent,
        budget: taskBudget,
        percentage: (projectedSpent / taskBudget) * 100,
      }, 'BudgetChecker');
    }

    if (!allowed) {
      eventBus.emit('task:budget_exceeded', {
        taskId,
        spent: projectedSpent,
        budget: taskBudget,
      }, 'BudgetChecker');
    }

    return {
      allowed,
      remaining: Math.max(0, taskBudget - projectedSpent),
      spent,
      budget: taskBudget,
      warning,
      message: allowed
        ? warning ? `Budget warning: ${((projectedSpent / taskBudget) * 100).toFixed(1)}% used`
                  : 'Budget OK'
        : `Budget exceeded: $${projectedSpent.toFixed(6)} > $${taskBudget.toFixed(6)}`,
    };
  }

  /** Record cost for a task */
  recordCost(taskId: string, cost: number): void {
    const db = getDatabase().getDb();
    db.prepare('UPDATE tasks SET spent = spent + ?, updated_at = datetime("now") WHERE id = ?')
      .run(cost, taskId);
  }

  /** Get total platform spend */
  getTotalSpend(): number {
    const db = getDatabase().getDb();
    const result = db.prepare('SELECT COALESCE(SUM(spent), 0) as total FROM tasks').get() as { total: number };
    return result.total;
  }

  /** Check redesign budget (max 3x original) */
  checkRedesignBudget(taskId: string, multiplier = 3): BudgetCheckResult {
    const db = getDatabase().getDb();
    const task = db.prepare('SELECT spent, budget FROM tasks WHERE id = ?').get(taskId) as
      { spent: number; budget: number } | undefined;

    if (!task) {
      return { allowed: false, remaining: 0, spent: 0, budget: 0, warning: false, message: 'Task not found' };
    }

    const maxBudget = task.budget * multiplier;
    return this.check(taskId, maxBudget);
  }
}
