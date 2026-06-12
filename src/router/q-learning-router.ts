// ============================================================================
// Peripheral Agentic OS — Q-Learning Router (ε-Greedy Contextual Bandit)
// ============================================================================

import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { RoutingStrategy, QTableEntry } from '../types/model.js';
import type { IRLTrainer } from '../core/orchestrator.js';

/**
 * Q-Learning Router: ε-greedy contextual bandit (γ=0) for meta-learning
 * which routing strategy performs best for each task context.
 *
 * State encoding: taskTypeHash_modelCountBucket_budgetClass
 * Actions: routing strategies
 * Q-table persists to SQLite every N episodes.
 */
export class QLearningRouter implements IRLTrainer {
  private qTable: Map<string, Map<RoutingStrategy, { value: number; visits: number }>>;
  private epsilon: number;
  private learningRate: number;
  private persistInterval: number;
  private episodeCount: number;
  private strategies: RoutingStrategy[];

  constructor(
    epsilon = 0.1,
    learningRate = 0.1,
    persistInterval = 10,
    strategies: RoutingStrategy[] = ['quality', 'balanced', 'cost', 'cascade', 'pomdp']
  ) {
    this.qTable = new Map();
    this.epsilon = epsilon;
    this.learningRate = learningRate;
    this.persistInterval = persistInterval;
    this.episodeCount = 0;
    this.strategies = strategies;

    // Load persisted Q-table
    this.loadFromDB();
  }

  /**
   * Select routing strategy using ε-greedy policy
   */
  selectStrategy(taskType: string, modelCount: number, budget: number): RoutingStrategy {
    const state = this.encodeState(taskType, modelCount, budget);

    // ε-greedy selection
    if (Math.random() < this.epsilon) {
      // Explore: random strategy
      const strategy = this.strategies[Math.floor(Math.random() * this.strategies.length)];
      eventBus.emit('router:strategy_selected', { state, strategy, mode: 'explore' }, 'QLearningRouter');
      return strategy;
    }

    // Exploit: best Q-value
    const strategy = this.getBestStrategy(state);
    eventBus.emit('router:strategy_selected', { state, strategy, mode: 'exploit' }, 'QLearningRouter');
    return strategy;
  }

  /**
   * Record reward signal and update Q-value (γ=0 → contextual bandit)
   */
  recordReward(taskType: string, topology: string, strategy: string, reward: number): void {
    const state = this.encodeState(taskType, 0, 0);
    const strat = strategy as RoutingStrategy;

    if (!this.qTable.has(state)) {
      this.qTable.set(state, new Map());
    }

    const stateQ = this.qTable.get(state)!;
    const current = stateQ.get(strat) || { value: 0, visits: 0 };

    // Q-update with γ=0: Q(s,a) ← Q(s,a) + α(r - Q(s,a))
    current.value = current.value + this.learningRate * (reward - current.value);
    current.visits++;
    stateQ.set(strat, current);

    this.episodeCount++;

    eventBus.emit('router:q_table_updated', {
      state,
      strategy: strat,
      value: current.value,
      visits: current.visits,
    }, 'QLearningRouter');

    // Persist periodically
    if (this.episodeCount % this.persistInterval === 0) {
      this.persistToDB();
      eventBus.emit('router:q_table_persisted', { episodeCount: this.episodeCount }, 'QLearningRouter');
    }
  }

  /**
   * Get RL recommendation for a task type
   */
  getRecommendation(taskType: string): { topology: string; confidence: number } | null {
    const state = this.encodeState(taskType, 0, 0);
    const stateQ = this.qTable.get(state);
    if (!stateQ || stateQ.size === 0) return null;

    let bestStrategy = this.strategies[0];
    let bestValue = -Infinity;
    let totalVisits = 0;

    for (const [strategy, entry] of stateQ) {
      totalVisits += entry.visits;
      if (entry.value > bestValue) {
        bestValue = entry.value;
        bestStrategy = strategy;
      }
    }

    return {
      topology: bestStrategy, // Strategy maps to best topology observed
      confidence: totalVisits > 10 ? Math.min(bestValue, 1.0) : 0.3,
    };
  }

  // ===== Private Methods =====

  private encodeState(taskType: string, modelCount: number, budget: number): string {
    const typeHash = this.hashString(taskType);
    const modelBucket = modelCount <= 5 ? 'few' : modelCount <= 20 ? 'medium' : 'many';
    const budgetClass = budget <= 0.01 ? 'micro' : budget <= 0.1 ? 'low' : budget <= 1.0 ? 'medium' : 'high';
    return `${typeHash}_${modelBucket}_${budgetClass}`;
  }

  private getBestStrategy(state: string): RoutingStrategy {
    const stateQ = this.qTable.get(state);
    if (!stateQ || stateQ.size === 0) return 'balanced'; // Default

    let best = this.strategies[0];
    let bestValue = -Infinity;

    for (const [strategy, entry] of stateQ) {
      if (entry.value > bestValue) {
        bestValue = entry.value;
        best = strategy;
      }
    }

    return best;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  private persistToDB(): void {
    const db = getDatabase().getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO q_table (state, action, value, visits, last_updated)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    const tx = db.transaction(() => {
      for (const [state, actions] of this.qTable) {
        for (const [action, entry] of actions) {
          stmt.run(state, action, entry.value, entry.visits);
        }
      }
    });
    tx();
  }

  private loadFromDB(): void {
    try {
      const db = getDatabase().getDb();
      const rows = db.prepare('SELECT state, action, value, visits FROM q_table').all() as QTableEntry[];

      for (const row of rows) {
        if (!this.qTable.has(row.state)) {
          this.qTable.set(row.state, new Map());
        }
        this.qTable.get(row.state)!.set(row.action as RoutingStrategy, {
          value: row.value,
          visits: row.visits,
        });
      }
    } catch {
      // DB might not exist yet
    }
  }

  /** Get Q-table size */
  getTableSize(): number {
    let count = 0;
    for (const actions of this.qTable.values()) {
      count += actions.size;
    }
    return count;
  }

  /** Get episode count */
  getEpisodeCount(): number {
    return this.episodeCount;
  }
}
