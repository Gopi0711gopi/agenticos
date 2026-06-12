// ============================================================================
// Peripheral Agentic OS — Mode Engine (Companion/Power Feature Gates)
// ============================================================================

import type { TopologyType } from '../types/topology.js';
import type { RoutingStrategy } from '../types/model.js';

/** Operating modes */
export type OperatingMode = 'companion' | 'power';

/** Feature gate configuration per mode */
export interface ModeFeatures {
  mode: OperatingMode;
  topologies: TopologyType[];
  maxJudges: number;
  routingStrategies: RoutingStrategy[];
  reinforcementLearning: boolean;
  containerIsolation: boolean;
  simulation: boolean;
  maxRedesigns: number;
  maxBudgetMultiplier: number;
}

/** Companion mode: limited feature set for simpler use cases */
const COMPANION_FEATURES: ModeFeatures = {
  mode: 'companion',
  topologies: ['sequential', 'parallel', 'hierarchical', 'dag', 'mixture', 'star'],
  maxJudges: 2,
  routingStrategies: ['quality', 'balanced', 'cost'],
  reinforcementLearning: false,
  containerIsolation: false,
  simulation: false,
  maxRedesigns: 3,
  maxBudgetMultiplier: 2,
};

/** Power mode: full feature set for production deployments */
const POWER_FEATURES: ModeFeatures = {
  mode: 'power',
  topologies: [
    'sequential', 'parallel', 'hierarchical', 'dag', 'mixture', 'debate',
    'mesh', 'star', 'circular', 'grid', 'forest', 'maker',
  ],
  maxJudges: 5,
  routingStrategies: ['quality', 'balanced', 'cost', 'cascade', 'pomdp'],
  reinforcementLearning: true,
  containerIsolation: true,
  simulation: true,
  maxRedesigns: 5,
  maxBudgetMultiplier: 3,
};

/**
 * Mode Engine: manages feature gates based on operating mode.
 * Controls which features are available in companion vs power mode.
 */
export class ModeEngine {
  private currentMode: OperatingMode;
  private features: ModeFeatures;

  constructor(mode: OperatingMode = 'power') {
    this.currentMode = mode;
    this.features = mode === 'power' ? { ...POWER_FEATURES } : { ...COMPANION_FEATURES };
  }

  /** Get current operating mode */
  getMode(): OperatingMode {
    return this.currentMode;
  }

  /** Get current feature set */
  getFeatures(): ModeFeatures {
    return { ...this.features };
  }

  /** Switch operating mode */
  setMode(mode: OperatingMode): ModeFeatures {
    this.currentMode = mode;
    this.features = mode === 'power' ? { ...POWER_FEATURES } : { ...COMPANION_FEATURES };
    return this.getFeatures();
  }

  /** Check if a topology is available in current mode */
  isTopologyAvailable(topology: TopologyType): boolean {
    return this.features.topologies.includes(topology);
  }

  /** Check if a routing strategy is available */
  isStrategyAvailable(strategy: RoutingStrategy): boolean {
    return this.features.routingStrategies.includes(strategy);
  }

  /** Check if RL is enabled */
  isRLEnabled(): boolean {
    return this.features.reinforcementLearning;
  }

  /** Check if simulation is enabled */
  isSimulationEnabled(): boolean {
    return this.features.simulation;
  }

  /** Get max judges for current mode */
  getMaxJudges(): number {
    return this.features.maxJudges;
  }

  /** Get available topologies */
  getAvailableTopologies(): TopologyType[] {
    return [...this.features.topologies];
  }

  /** Get available routing strategies */
  getAvailableStrategies(): RoutingStrategy[] {
    return [...this.features.routingStrategies];
  }

  /** Get max redesigns for current mode */
  getMaxRedesigns(): number {
    return this.features.maxRedesigns;
  }

  /** Get max budget multiplier */
  getMaxBudgetMultiplier(): number {
    return this.features.maxBudgetMultiplier;
  }
}
