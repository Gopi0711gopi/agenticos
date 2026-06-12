// ============================================================================
// Peripheral Agentic OS — Model Router (5 Strategies, ~457 lines)
// ============================================================================

import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { ModelInfo, RoutingStrategy, RoutingDecision, ModelProvider } from '../types/model.js';

/**
 * Model Router with 5 routing strategies.
 * Selects the optimal model based on task context and strategy.
 */
export class ModelRouter {
  private catalog: Map<string, ModelInfo>;
  private defaultStrategy: RoutingStrategy;

  constructor(defaultStrategy: RoutingStrategy = 'balanced') {
    this.catalog = new Map();
    this.defaultStrategy = defaultStrategy;
  }

  /** Update the model catalog from discovery results */
  updateCatalog(models: ModelInfo[]): void {
    for (const model of models) {
      this.catalog.set(model.id, model);
    }
    eventBus.emit('router:catalog_updated', { modelCount: this.catalog.size }, 'ModelRouter');
  }

  /** Get all models in the catalog */
  getCatalog(): ModelInfo[] {
    return [...this.catalog.values()];
  }

  /** Route to the best model using the specified strategy */
  route(
    taskId: string,
    strategy?: RoutingStrategy,
    constraints?: { maxCost?: number; minQuality?: number; preferLocal?: boolean; provider?: ModelProvider }
  ): RoutingDecision | null {
    const strat = strategy || this.defaultStrategy;
    let candidates = [...this.catalog.values()];

    // Apply constraints
    if (constraints?.provider) {
      candidates = candidates.filter(m => m.provider === constraints.provider);
    }
    if (constraints?.preferLocal) {
      const localModels = candidates.filter(m => m.isLocal);
      if (localModels.length > 0) candidates = localModels;
    }
    if (constraints?.minQuality) {
      candidates = candidates.filter(m => m.qualityScore >= constraints.minQuality!);
    }

    if (candidates.length === 0) return null;

    let selected: ModelInfo;

    switch (strat) {
      case 'quality':
        selected = this.routeQuality(candidates);
        break;
      case 'cost':
        selected = this.routeCost(candidates, constraints?.minQuality ?? 0.3);
        break;
      case 'balanced':
        selected = this.routeBalanced(candidates);
        break;
      case 'cascade':
        selected = this.routeCascade(candidates);
        break;
      case 'pomdp':
        selected = this.routeBalanced(candidates); // POMDP delegated to pomdp.ts
        break;
      default:
        selected = this.routeBalanced(candidates);
    }

    const decision: RoutingDecision = {
      taskId,
      strategy: strat,
      selectedModel: selected.id,
      selectedProvider: selected.provider,
      reason: `Selected by ${strat} strategy from ${candidates.length} candidates`,
      candidates: candidates.length,
      cost: selected.costPerInputToken + selected.costPerOutputToken,
      timestamp: new Date().toISOString(),
    };

    // Persist
    const db = getDatabase().getDb();
    db.prepare(`
      INSERT INTO routing_history (task_id, strategy, selected_model, selected_provider, reason, candidates, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, strat, selected.id, selected.provider, decision.reason, candidates.length, decision.cost);

    eventBus.emit('router:model_selected', {
      model: selected.id,
      provider: selected.provider,
      strategy: strat,
    }, 'ModelRouter');

    return decision;
  }

  // ===== Strategy Implementations =====

  /** Quality-first: highest quality score regardless of cost */
  private routeQuality(models: ModelInfo[]): ModelInfo {
    return models.reduce((best, m) => m.qualityScore > best.qualityScore ? m : best);
  }

  /** Cost-first: cheapest model above minimum quality */
  private routeCost(models: ModelInfo[], minQuality: number): ModelInfo {
    const qualified = models.filter(m => m.qualityScore >= minQuality);
    const candidates = qualified.length > 0 ? qualified : models;
    return candidates.reduce((cheapest, m) => {
      const mCost = m.costPerInputToken + m.costPerOutputToken;
      const cCost = cheapest.costPerInputToken + cheapest.costPerOutputToken;
      return mCost < cCost ? m : cheapest;
    });
  }

  /** Balanced: weighted combination of quality and inverse cost */
  private routeBalanced(models: ModelInfo[]): ModelInfo {
    const maxCost = Math.max(...models.map(m => m.costPerInputToken + m.costPerOutputToken), 0.001);

    return models.reduce((best, m) => {
      const mCost = m.costPerInputToken + m.costPerOutputToken;
      const mScore = m.qualityScore * 0.6 + (1 - mCost / maxCost) * 0.4;
      const bCost = best.costPerInputToken + best.costPerOutputToken;
      const bScore = best.qualityScore * 0.6 + (1 - bCost / maxCost) * 0.4;
      return mScore > bScore ? m : best;
    });
  }

  /** Cascade: return highest quality (actual cascade happens in model-call) */
  private routeCascade(models: ModelInfo[]): ModelInfo {
    return models.sort((a, b) => b.qualityScore - a.qualityScore)[0];
  }

  /** Get cascade order (quality descending) */
  getCascadeOrder(): ModelInfo[] {
    return [...this.catalog.values()].sort((a, b) => b.qualityScore - a.qualityScore);
  }

  /** Register a model manually */
  registerModel(model: ModelInfo): void {
    this.catalog.set(model.id, model);
    const db = getDatabase().getDb();
    db.prepare(`
      INSERT OR REPLACE INTO model_catalog (id, name, provider, quality_score, cost_per_input_token, cost_per_output_token, context_window, capabilities, is_local)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(model.id, model.name, model.provider, model.qualityScore, model.costPerInputToken, model.costPerOutputToken, model.contextWindow, JSON.stringify(model.capabilities), model.isLocal ? 1 : 0);
  }
}
