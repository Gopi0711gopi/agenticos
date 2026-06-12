// ============================================================================
// Peripheral Agentic OS — Goodhart Detector (~290 lines)
// ============================================================================

import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { GoodhartDetectionResult, GoodhartSignal, GoodhartRiskLevel } from '../types/judge.js';

/**
 * Goodhart Detection Module.
 * Monitors 4 signals to detect when optimization diverges from quality:
 * 1. Cross-model entropy
 * 2. Calibration delta
 * 3. Score inflation
 * 4. Diversity collapse
 */
export class GoodhartDetector {
  private entropyThreshold: number;
  private calibrationDelta: number;
  private inflationMultiplier: number;
  private windowSize: number;
  private scoreHistory: number[];
  private rewardHistory: number[];
  private designHistory: string[];

  constructor(config?: {
    entropyThreshold?: number;
    calibrationDelta?: number;
    inflationMultiplier?: number;
    windowSize?: number;
  }) {
    this.entropyThreshold = config?.entropyThreshold ?? 0.3;
    this.calibrationDelta = config?.calibrationDelta ?? 0.15;
    this.inflationMultiplier = config?.inflationMultiplier ?? 1.5;
    this.windowSize = config?.windowSize ?? 50;
    this.scoreHistory = [];
    this.rewardHistory = [];
    this.designHistory = [];
  }

  /** Run full Goodhart detection check */
  async check(taskId: string): Promise<GoodhartDetectionResult> {
    const signals: GoodhartSignal[] = [];

    // 1. Cross-model entropy
    signals.push(this.checkCrossModelEntropy(taskId));

    // 2. Calibration delta
    signals.push(this.checkCalibrationDelta());

    // 3. Score inflation
    signals.push(this.checkScoreInflation());

    // 4. Diversity collapse
    signals.push(this.checkDiversityCollapse());

    // Determine risk level
    const triggeredCount = signals.filter(s => s.triggered).length;
    let riskLevel: GoodhartRiskLevel = 'none';
    let action: 'none' | 'rotate_judge' | 'discard_round' = 'none';

    if (triggeredCount >= 3) {
      riskLevel = 'high';
      action = 'discard_round';
    } else if (triggeredCount >= 2) {
      riskLevel = 'medium';
      action = 'rotate_judge';
    } else if (triggeredCount >= 1) {
      riskLevel = 'low';
    }

    const result: GoodhartDetectionResult = {
      riskLevel,
      signals,
      action,
      details: `${triggeredCount}/4 signals triggered. Risk: ${riskLevel}`,
    };

    // Persist and emit
    const db = getDatabase().getDb();
    for (const signal of signals) {
      db.prepare(`
        INSERT INTO goodhart_signals (task_id, signal_type, value, threshold, triggered, risk_level, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(taskId, signal.type, signal.value, signal.threshold, signal.triggered ? 1 : 0, riskLevel, signal.details);
    }

    if (riskLevel !== 'none') {
      eventBus.emit(
        riskLevel === 'high' ? 'quality:goodhart_critical' : 'quality:goodhart_warning',
        { taskId, riskLevel, signals: triggeredCount },
        'GoodhartDetector'
      );
    }

    return result;
  }

  /** Record a score observation */
  recordScore(score: number, reward: number, designSignature: string): void {
    this.scoreHistory.push(score);
    this.rewardHistory.push(reward);
    this.designHistory.push(designSignature);

    if (this.scoreHistory.length > this.windowSize) {
      this.scoreHistory.shift();
      this.rewardHistory.shift();
      this.designHistory.shift();
    }
  }

  // ===== Signal Checks =====

  private checkCrossModelEntropy(taskId: string): GoodhartSignal {
    const db = getDatabase().getDb();
    const verdicts = db.prepare(
      'SELECT score FROM judge_verdicts WHERE task_id = ? ORDER BY timestamp DESC LIMIT 10'
    ).all(taskId) as { score: number }[];

    if (verdicts.length < 2) {
      return this.signal('cross_model_entropy', 1.0, this.entropyThreshold, false, 'Insufficient data');
    }

    const scores = verdicts.map(v => v.score);
    const entropy = this.computeEntropy(scores);

    return this.signal(
      'cross_model_entropy', entropy, this.entropyThreshold,
      entropy < this.entropyThreshold,
      `Cross-model entropy: ${entropy.toFixed(3)} (threshold: ${this.entropyThreshold})`
    );
  }

  private checkCalibrationDelta(): GoodhartSignal {
    if (this.scoreHistory.length < 10) {
      return this.signal('calibration_delta', 0, this.calibrationDelta, false, 'Insufficient data');
    }

    // Compare self-reported confidence trend vs actual accuracy
    const recentScores = this.scoreHistory.slice(-20);
    const avgRecent = recentScores.reduce((s, v) => s + v, 0) / recentScores.length;
    const avgReward = this.rewardHistory.slice(-20).reduce((s, v) => s + v, 0) / Math.max(this.rewardHistory.slice(-20).length, 1);
    const delta = Math.abs(avgRecent - avgReward);

    return this.signal(
      'calibration_delta', delta, this.calibrationDelta,
      delta > this.calibrationDelta,
      `Calibration delta: ${delta.toFixed(3)} (threshold: ${this.calibrationDelta})`
    );
  }

  private checkScoreInflation(): GoodhartSignal {
    if (this.scoreHistory.length < 10) {
      return this.signal('score_inflation', 0, this.inflationMultiplier, false, 'Insufficient data');
    }

    const half = Math.floor(this.scoreHistory.length / 2);
    const firstHalf = this.scoreHistory.slice(0, half);
    const secondHalf = this.scoreHistory.slice(half);

    const deltaScore = (avg(secondHalf) - avg(firstHalf));
    const deltaReward = this.rewardHistory.length >= 10
      ? (avg(this.rewardHistory.slice(half)) - avg(this.rewardHistory.slice(0, half)))
      : deltaScore;

    const ratio = deltaReward !== 0 ? deltaScore / Math.abs(deltaReward) : 0;
    const inflated = deltaScore > 0 && ratio > this.inflationMultiplier;

    return this.signal(
      'score_inflation', ratio, this.inflationMultiplier,
      inflated,
      `Score inflation ratio: ${ratio.toFixed(3)} (threshold: ${this.inflationMultiplier})`
    );
  }

  private checkDiversityCollapse(): GoodhartSignal {
    if (this.designHistory.length < 5) {
      return this.signal('diversity_collapse', 1.0, 0.3, false, 'Insufficient data');
    }

    const unique = new Set(this.designHistory.slice(-10));
    const diversity = unique.size / Math.min(this.designHistory.slice(-10).length, 10);
    const collapsed = diversity < 0.3;

    return this.signal(
      'diversity_collapse', diversity, 0.3,
      collapsed,
      `Design diversity: ${(diversity * 100).toFixed(0)}% unique (threshold: 30%)`
    );
  }

  // ===== Helpers =====

  private computeEntropy(scores: number[]): number {
    // Bin scores into 5 buckets and compute Shannon entropy
    const bins = [0, 0, 0, 0, 0];
    for (const s of scores) {
      const bin = Math.min(Math.floor(s * 5), 4);
      bins[bin]++;
    }
    let entropy = 0;
    const n = scores.length;
    for (const count of bins) {
      if (count > 0) {
        const p = count / n;
        entropy -= p * Math.log2(p);
      }
    }
    return entropy;
  }

  private signal(
    type: GoodhartSignal['type'], value: number, threshold: number, triggered: boolean, details: string
  ): GoodhartSignal {
    return { type, value, threshold, triggered, details, timestamp: new Date().toISOString() };
  }
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}
