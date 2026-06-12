// ============================================================================
// Peripheral Agentic OS — Mid-Flight Task Steering
// ============================================================================

import { eventBus } from './event-bus.js';
import { getDatabase } from '../db/database.js';
import type { SteeringAction, SteeringCommand } from '../types/task.js';

/** Steering state for a task */
export interface SteeringState {
  taskId: string;
  isPaused: boolean;
  isCancelled: boolean;
  redirectPrompt?: string;
  pausedAt?: string;
}

/**
 * Mid-flight task control system.
 * Enables pause/resume/redirect/cancel of running tasks.
 * The orchestrator checks steering state between every major step.
 */
export class SteeringController {
  private states: Map<string, SteeringState>;
  private pollIntervalMs: number;
  private timeoutMs: number;

  constructor(pollIntervalMs = 100, timeoutMs = 3_600_000) {
    this.states = new Map();
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs; // 1 hour default
  }

  /** Initialize steering for a task */
  init(taskId: string): void {
    this.states.set(taskId, {
      taskId,
      isPaused: false,
      isCancelled: false,
    });
  }

  /** Apply a steering command */
  apply(command: SteeringCommand): void {
    const state = this.states.get(command.taskId);
    if (!state) {
      this.init(command.taskId);
    }

    const current = this.states.get(command.taskId)!;

    switch (command.action) {
      case 'pause':
        current.isPaused = true;
        current.pausedAt = new Date().toISOString();
        eventBus.emit('task:paused', { taskId: command.taskId, reason: command.reason }, 'Steering');
        break;

      case 'resume':
        current.isPaused = false;
        current.pausedAt = undefined;
        eventBus.emit('task:resumed', { taskId: command.taskId }, 'Steering');
        break;

      case 'redirect':
        current.redirectPrompt = command.newPrompt;
        current.isPaused = false;
        eventBus.emit('task:redirected', {
          taskId: command.taskId,
          newPrompt: command.newPrompt,
        }, 'Steering');
        break;

      case 'cancel':
        current.isCancelled = true;
        current.isPaused = false;
        eventBus.emit('task:cancelled', { taskId: command.taskId, reason: command.reason }, 'Steering');
        break;
    }

    // Persist steering command
    const db = getDatabase().getDb();
    db.prepare(`
      INSERT INTO task_steering (task_id, action, new_prompt, reason)
      VALUES (?, ?, ?, ?)
    `).run(command.taskId, command.action, command.newPrompt, command.reason);
  }

  /** Check steering state — called between orchestrator steps */
  async checkSteering(taskId: string): Promise<'continue' | 'cancel' | 'redirect'> {
    const state = this.states.get(taskId);
    if (!state) return 'continue';

    if (state.isCancelled) return 'cancel';

    if (state.redirectPrompt) {
      const prompt = state.redirectPrompt;
      state.redirectPrompt = undefined;
      return 'redirect';
    }

    // If paused, poll until resumed or timeout
    if (state.isPaused) {
      const startTime = Date.now();
      while (state.isPaused && !state.isCancelled) {
        if (Date.now() - startTime > this.timeoutMs) {
          state.isPaused = false;
          state.isCancelled = true;
          eventBus.emit('task:cancelled', {
            taskId,
            reason: 'Pause timeout exceeded',
          }, 'Steering');
          return 'cancel';
        }
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      }
      if (state.isCancelled) return 'cancel';
    }

    return 'continue';
  }

  /** Get the redirect prompt for a task */
  getRedirectPrompt(taskId: string): string | undefined {
    return this.states.get(taskId)?.redirectPrompt;
  }

  /** Get steering state */
  getState(taskId: string): SteeringState | undefined {
    return this.states.get(taskId);
  }

  /** Clean up steering state for a completed task */
  cleanup(taskId: string): void {
    this.states.delete(taskId);
  }

  /** Get all active steering states */
  getActiveStates(): SteeringState[] {
    return [...this.states.values()].filter(s => s.isPaused || s.isCancelled);
  }
}
