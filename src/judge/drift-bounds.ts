// ============================================================================
// Peripheral Agentic OS — Drift Bounds (JSD Monitoring, ~250 lines)
// ============================================================================

import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { DriftSnapshot } from '../types/judge.js';

/**
 * Drift Monitoring Module.
 * Tracks Jensen-Shannon Divergence between reference and current score distributions.
 * Threshold Θ = 0.877 (calibrated from AgentAssert).
 */
export class DriftMonitor {
  private referenceDistributions: Map<string, number[]>;
  private currentDistributions: Map<string, number[]>;
  private threshold: number;
  private recalibrationTrigger: number;
  private suspendedJudges: Set<string>;
  private bins: number;

  constructor(threshold = 0.877, recalibrationTrigger = 0.5) {
    this.referenceDistributions = new Map();
    this.currentDistributions = new Map();
    this.threshold = threshold;
    this.recalibrationTrigger = recalibrationTrigger;
    this.suspendedJudges = new Set();
    this.bins = 10; // Score distribution bins
  }

  /** Record a judge score and update current distribution */
  recordScore(judgeId: string, score: number): void {
    if (!this.currentDistributions.has(judgeId)) {
      this.currentDistributions.set(judgeId, new Array(this.bins).fill(0));
    }

    const dist = this.currentDistributions.get(judgeId)!;
    const bin = Math.min(Math.floor(score * this.bins), this.bins - 1);
    dist[bin]++;
  }

  /** Set reference distribution for a judge */
  setReference(judgeId: string, scores: number[]): void {
    const dist = new Array(this.bins).fill(0);
    for (const score of scores) {
      const bin = Math.min(Math.floor(score * this.bins), this.bins - 1);
      dist[bin]++;
    }
    // Normalize
    const total = dist.reduce((s: number, v: number) => s + v, 0);
    if (total > 0) {
      for (let i = 0; i < this.bins; i++) dist[i] /= total;
    }
    this.referenceDistributions.set(judgeId, dist);
  }

  /** Check all judges for drift */
  checkAll(): DriftSnapshot[] {
    const snapshots: DriftSnapshot[] = [];
    let driftedCount = 0;
    const totalJudges = this.currentDistributions.size;

    for (const [judgeId, current] of this.currentDistributions) {
      const reference = this.referenceDistributions.get(judgeId);
      if (!reference) continue;

      // Normalize current distribution
      const total = current.reduce((s, v) => s + v, 0);
      const normalized = total > 0 ? current.map(v => v / total) : current;

      const jsd = this.jensenShannonDivergence(reference, normalized);
      const drifted = jsd > this.threshold;

      if (drifted) {
        driftedCount++;
        this.suspendedJudges.add(judgeId);
        eventBus.emit('quality:drift_warning', { judgeId, jsd, threshold: this.threshold }, 'DriftMonitor');
      }

      const snapshot: DriftSnapshot = {
        judgeId,
        referenceDistribution: reference,
        currentDistribution: normalized,
        jsd,
        threshold: this.threshold,
        drifted,
        timestamp: new Date().toISOString(),
      };
      snapshots.push(snapshot);

      // Persist
      const db = getDatabase().getDb();
      db.prepare(`
        INSERT INTO drift_snapshots (judge_id, reference_distribution, current_distribution, jsd, threshold, drifted)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(judgeId, JSON.stringify(reference), JSON.stringify(normalized), jsd, this.threshold, drifted ? 1 : 0);
    }

    // Check for mass drift
    if (totalJudges > 0 && driftedCount / totalJudges >= this.recalibrationTrigger) {
      eventBus.emit('quality:drift_recalibration', {
        driftedCount,
        totalJudges,
        ratio: driftedCount / totalJudges,
      }, 'DriftMonitor');
      this.recalibrate();
    }

    return snapshots;
  }

  /** Check a single judge for drift */
  check(judgeId: string): DriftSnapshot | null {
    const reference = this.referenceDistributions.get(judgeId);
    const current = this.currentDistributions.get(judgeId);
    if (!reference || !current) return null;

    const total = current.reduce((s, v) => s + v, 0);
    const normalized = total > 0 ? current.map(v => v / total) : current;
    const jsd = this.jensenShannonDivergence(reference, normalized);

    return {
      judgeId, referenceDistribution: reference, currentDistribution: normalized,
      jsd, threshold: this.threshold, drifted: jsd > this.threshold,
      timestamp: new Date().toISOString(),
    };
  }

  /** Is a judge suspended due to drift? */
  isSuspended(judgeId: string): boolean {
    return this.suspendedJudges.has(judgeId);
  }

  /** Recalibrate: reset reference distributions from current */
  recalibrate(): void {
    for (const [judgeId, current] of this.currentDistributions) {
      const total = current.reduce((s, v) => s + v, 0);
      if (total > 0) {
        this.referenceDistributions.set(judgeId, current.map(v => v / total));
      }
    }
    this.suspendedJudges.clear();
  }

  /**
   * Jensen-Shannon Divergence.
   * JSD(P||Q) = 1/2 * DKL(P||M) + 1/2 * DKL(Q||M), M = (P+Q)/2
   */
  jensenShannonDivergence(p: number[], q: number[]): number {
    const m = p.map((pi, i) => (pi + q[i]) / 2);
    return 0.5 * this.klDivergence(p, m) + 0.5 * this.klDivergence(q, m);
  }

  /** KL Divergence: DKL(P||Q) = Σ P(i) * log(P(i)/Q(i)) */
  private klDivergence(p: number[], q: number[]): number {
    let kl = 0;
    for (let i = 0; i < p.length; i++) {
      if (p[i] > 0 && q[i] > 0) {
        kl += p[i] * Math.log2(p[i] / q[i]);
      }
    }
    return kl;
  }

  /** Get threshold */
  getThreshold(): number {
    return this.threshold;
  }

  /** Get suspended judges */
  getSuspendedJudges(): string[] {
    return [...this.suspendedJudges];
  }
}
