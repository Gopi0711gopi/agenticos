// ============================================================================
// Peripheral Agentic OS — POMDP Model Selection (Bayesian Belief-State)
// ============================================================================

import { eventBus } from '../core/event-bus.js';
import type { ModelInfo, POMDPBelief, QualityLevel } from '../types/model.js';

/**
 * POMDP (Partially Observable Markov Decision Process) model selector.
 * Maintains belief distribution over 3 hidden states (low/medium/high quality context).
 * Selects model maximizing expected reward minus cost penalty.
 */
export class POMDPSelector {
  private belief: POMDPBelief;
  private beliefFloor: number;
  private beliefCeiling: number;
  private costWeight: number;

  /** Observation model P(obs | state) */
  private observationModel: Record<QualityLevel, Record<string, number>>;

  /** Transition model T(s, a, s') — simplified: identity (no state transitions from actions) */
  private transitionModel: Record<QualityLevel, Record<QualityLevel, number>>;

  /** Reward model R(state, model_tier) */
  private rewardModel: Record<QualityLevel, Record<string, number>>;

  constructor(
    beliefFloor = 0.01,
    beliefCeiling = 0.99,
    costWeight = 0.3
  ) {
    // Uniform prior
    this.belief = { low: 1 / 3, medium: 1 / 3, high: 1 / 3 };
    this.beliefFloor = beliefFloor;
    this.beliefCeiling = beliefCeiling;
    this.costWeight = costWeight;

    // P(obs | state): probability of observing a quality bin given true state
    this.observationModel = {
      low:    { low: 0.7, medium: 0.2, high: 0.1 },
      medium: { low: 0.15, medium: 0.7, high: 0.15 },
      high:   { low: 0.05, medium: 0.25, high: 0.7 },
    };

    // Transition model (mostly identity — context doesn't change much between tasks)
    this.transitionModel = {
      low:    { low: 0.7, medium: 0.25, high: 0.05 },
      medium: { low: 0.15, medium: 0.7, high: 0.15 },
      high:   { low: 0.05, medium: 0.25, high: 0.7 },
    };

    // Reward: how well each model tier performs in each state
    this.rewardModel = {
      low:    { frontier: 0.8, standard: 0.7, lightweight: 0.5 },
      medium: { frontier: 0.9, standard: 0.8, lightweight: 0.5 },
      high:   { frontier: 0.95, standard: 0.7, lightweight: 0.3 },
    };
  }

  /**
   * Select the best model from candidates using belief-weighted expected reward.
   */
  select(candidates: ModelInfo[]): ModelInfo | null {
    if (candidates.length === 0) return null;

    let bestModel = candidates[0];
    let bestScore = -Infinity;

    for (const model of candidates) {
      const tier = this.getTier(model);
      const expectedReward = this.computeExpectedReward(tier);
      const costPenalty = (model.costPerInputToken + model.costPerOutputToken) * this.costWeight;
      const score = expectedReward - costPenalty;

      if (score > bestScore) {
        bestScore = score;
        bestModel = model;
      }
    }

    eventBus.emit('router:pomdp_belief_updated', {
      belief: { ...this.belief },
      selectedModel: bestModel.id,
      expectedReward: bestScore,
    }, 'POMDPSelector');

    return bestModel;
  }

  /**
   * Update belief state based on observation (Bayesian update).
   * b'(s') ∝ P(obs|s') Σ_s T(s,a,s') b(s)
   */
  updateBelief(observation: QualityLevel): void {
    const states: QualityLevel[] = ['low', 'medium', 'high'];
    const newBelief: Record<string, number> = {};

    for (const sPrime of states) {
      // Σ_s T(s, a, s') * b(s)
      let transitionSum = 0;
      for (const s of states) {
        transitionSum += this.transitionModel[s][sPrime] * this.belief[s];
      }
      // P(obs | s') * transitionSum
      newBelief[sPrime] = this.observationModel[sPrime][observation] * transitionSum;
    }

    // Normalize
    const total = Object.values(newBelief).reduce((sum, v) => sum + v, 0);
    if (total > 0) {
      for (const s of states) {
        this.belief[s] = Math.max(this.beliefFloor, Math.min(this.beliefCeiling, newBelief[s] / total));
      }
    }

    // Re-normalize after floor/ceiling
    const normTotal = this.belief.low + this.belief.medium + this.belief.high;
    this.belief.low /= normTotal;
    this.belief.medium /= normTotal;
    this.belief.high /= normTotal;
  }

  /** Compute expected reward for a model tier */
  private computeExpectedReward(tier: string): number {
    const states: QualityLevel[] = ['low', 'medium', 'high'];
    let expected = 0;
    for (const s of states) {
      expected += this.belief[s] * (this.rewardModel[s][tier] || 0.5);
    }
    return expected;
  }

  /** Map model to tier */
  private getTier(model: ModelInfo): string {
    if (model.qualityScore >= 0.8) return 'frontier';
    if (model.qualityScore >= 0.5) return 'standard';
    return 'lightweight';
  }

  /** Get current belief state */
  getBelief(): POMDPBelief {
    return { ...this.belief };
  }

  /** Reset belief to uniform prior */
  reset(): void {
    this.belief = { low: 1 / 3, medium: 1 / 3, high: 1 / 3 };
  }
}
