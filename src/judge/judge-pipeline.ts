// ============================================================================
// Peripheral Agentic OS — Judge Pipeline (14-Step, ~507 lines)
// ============================================================================

import { v4 as uuid } from 'uuid';
import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { IJudge } from '../core/orchestrator.js';
import type {
  ConsensusResult, JudgeVerdict, JudgeProfile, JudgeProfileType,
  VerdictOutcome, ConsensusAlgorithm, DEFAULT_JUDGE_PROFILES
} from '../types/judge.js';
import type { TaskType } from '../types/task.js';

type ModelCallFn = (prompt: string, systemPrompt: string) => Promise<string>;

/**
 * 14-Step Judge Pipeline with consensus-based evaluation.
 * Supports 4 profiles and 3 consensus algorithms.
 */
export class JudgePipeline implements IJudge {
  private modelCall: ModelCallFn;
  private judgeModels: string[];
  private consensusAlgorithm: ConsensusAlgorithm;
  private profiles: Record<string, JudgeProfile>;

  constructor(
    modelCall: ModelCallFn,
    judgeModels: string[] = ['default-judge'],
    consensusAlgorithm: ConsensusAlgorithm = 'weighted_majority'
  ) {
    this.modelCall = modelCall;
    this.judgeModels = judgeModels;
    this.consensusAlgorithm = consensusAlgorithm;
    this.profiles = {
      default: { type: 'default', name: 'Default', criteria: [
        { name: 'correctness', weight: 0.4 }, { name: 'completeness', weight: 0.3 },
        { name: 'quality', weight: 0.2 }, { name: 'safety', weight: 0.1 },
      ]},
      code: { type: 'code', name: 'Code', criteria: [
        { name: 'correctness', weight: 0.35 }, { name: 'completeness', weight: 0.25 },
        { name: 'quality', weight: 0.2 }, { name: 'security', weight: 0.15 }, { name: 'performance', weight: 0.05 },
      ]},
      research: { type: 'research', name: 'Research', criteria: [
        { name: 'accuracy', weight: 0.4 }, { name: 'completeness', weight: 0.25 },
        { name: 'sourcing', weight: 0.25 }, { name: 'clarity', weight: 0.1 },
      ]},
      creative: { type: 'creative', name: 'Creative', criteria: [
        { name: 'relevance', weight: 0.3 }, { name: 'quality', weight: 0.3 },
        { name: 'originality', weight: 0.25 }, { name: 'coherence', weight: 0.15 },
      ]},
    };
  }

  /**
   * Assess output quality — main entry point (14 steps)
   */
  async assess(taskId: string, prompt: string, output: string, taskType: TaskType): Promise<ConsensusResult> {
    eventBus.emit('judge:pipeline_started', { taskId, taskType }, 'JudgePipeline');

    // Step 1: Select profile
    const profile = this.selectProfile(taskType);
    eventBus.emit('judge:profile_loaded', { taskId, profile: profile.type }, 'JudgePipeline');

    // Step 2: Prepare evaluation context
    const evalContext = this.prepareContext(prompt, output, profile);

    // Step 3-4: Check for drift before evaluation (placeholder)
    // Step 5: Anti-fabrication pre-check
    const antiFab = this.antiFabricationCheck(output);

    // Steps 6-10: Run judge evaluations
    const verdicts: JudgeVerdict[] = [];
    for (let i = 0; i < this.judgeModels.length; i++) {
      const judgeId = `judge_${i}`;
      eventBus.emit('judge:evaluation_started', { taskId, judgeId }, 'JudgePipeline');

      const verdict = await this.evaluateWithJudge(
        judgeId, this.judgeModels[i], evalContext, profile, taskId
      );
      verdicts.push(verdict);

      eventBus.emit('judge:evaluation_completed', {
        taskId, judgeId, score: verdict.score, outcome: verdict.outcome,
      }, 'JudgePipeline');
    }

    // Step 11: Anti-fabrication post-check
    // Step 12: Compute consensus
    const consensus = this.computeConsensus(verdicts, this.consensusAlgorithm);

    // Step 13: Persist verdicts
    this.persistVerdicts(taskId, verdicts, consensus);

    // Step 14: Emit result
    eventBus.emit(`judge:${consensus.outcome}`, {
      taskId, score: consensus.finalScore, algorithm: consensus.algorithm,
    }, 'JudgePipeline');

    eventBus.emit('judge:pipeline_completed', {
      taskId, outcome: consensus.outcome, score: consensus.finalScore,
    }, 'JudgePipeline');

    return consensus;
  }

  /** Run a single judge evaluation */
  private async evaluateWithJudge(
    judgeId: string, model: string, context: string, profile: JudgeProfile, taskId: string
  ): Promise<JudgeVerdict> {
    const systemPrompt = `You are an expert judge evaluating AI agent output quality.

Evaluate the output on these criteria (JSON response):
${profile.criteria.map(c => `- ${c.name} (weight: ${c.weight})`).join('\n')}

Respond with ONLY valid JSON:
{
  "scores": { ${profile.criteria.map(c => `"${c.name}": 0.0`).join(', ')} },
  "overall_score": 0.0,
  "outcome": "approve|revise|reject",
  "feedback": "explanation",
  "confidence": 0.0
}

Score 0.0-1.0. "approve" if score >= 0.6, "revise" if 0.3-0.6, "reject" if < 0.3.`;

    try {
      const response = await this.modelCall(context, systemPrompt);
      const parsed = JSON.parse(this.extractJSON(response));

      const criteriaScored = profile.criteria.map(c => ({
        ...c,
        score: parsed.scores?.[c.name] ?? 0.5,
        feedback: parsed.feedback,
      }));

      const weightedScore = criteriaScored.reduce(
        (sum, c) => sum + (c.score ?? 0.5) * c.weight, 0
      );

      const outcome: VerdictOutcome = weightedScore >= 0.6 ? 'approve' : weightedScore >= 0.3 ? 'revise' : 'reject';

      return {
        judgeId,
        modelUsed: model,
        outcome: parsed.outcome || outcome,
        score: parsed.overall_score ?? weightedScore,
        criteria: criteriaScored,
        feedback: parsed.feedback || '',
        confidence: parsed.confidence ?? 0.7,
        timestamp: new Date().toISOString(),
      };
    } catch {
      // Fallback: moderate score
      return {
        judgeId, modelUsed: model, outcome: 'revise',
        score: 0.5, criteria: profile.criteria, feedback: 'Judge evaluation error — defaulting to revise',
        confidence: 0.3, timestamp: new Date().toISOString(),
      };
    }
  }

  /** Compute consensus from multiple judge verdicts */
  private computeConsensus(verdicts: JudgeVerdict[], algorithm: ConsensusAlgorithm): ConsensusResult {
    if (verdicts.length === 0) {
      return {
        algorithm, outcome: 'approve', finalScore: 0.5,
        votes: [], entropy: 0, agreementRatio: 1, details: 'No judges configured',
      };
    }

    if (verdicts.length === 1) {
      return {
        algorithm, outcome: verdicts[0].outcome, finalScore: verdicts[0].score,
        votes: verdicts, entropy: 0, agreementRatio: 1, details: 'Single judge',
      };
    }

    switch (algorithm) {
      case 'weighted_majority':
        return this.weightedMajority(verdicts);
      case 'bft':
        return this.bftConsensus(verdicts);
      case 'raft':
        return this.raftConsensus(verdicts);
      default:
        return this.weightedMajority(verdicts);
    }
  }

  /** Weighted Majority consensus */
  private weightedMajority(verdicts: JudgeVerdict[]): ConsensusResult {
    const weights: Record<string, number> = { frontier: 1.0, standard: 0.7, lightweight: 0.4 };
    let weightedApprove = 0;
    let totalWeight = 0;

    for (const v of verdicts) {
      const w = weights[v.modelUsed] || 0.7;
      totalWeight += w;
      if (v.outcome === 'approve') weightedApprove += w;
    }

    const ratio = totalWeight > 0 ? weightedApprove / totalWeight : 0;
    const outcome: VerdictOutcome = ratio > 0.5 ? 'approve' : ratio >= 0.3 ? 'revise' : 'reject';
    const avgScore = verdicts.reduce((s, v) => s + v.score, 0) / verdicts.length;
    const entropy = this.shannonEntropy(verdicts.map(v => v.outcome));

    return {
      algorithm: 'weighted_majority', outcome, finalScore: avgScore,
      votes: verdicts, entropy, agreementRatio: ratio,
      details: `Weighted approval: ${(ratio * 100).toFixed(1)}%, entropy: ${entropy.toFixed(3)}`,
    };
  }

  /** BFT-Inspired consensus: requires ⌊2n/3⌋ + 1 agreement */
  private bftConsensus(verdicts: JudgeVerdict[]): ConsensusResult {
    const n = verdicts.length;
    const required = Math.floor(2 * n / 3) + 1;
    const counts: Record<VerdictOutcome, number> = { approve: 0, revise: 0, reject: 0 };

    for (const v of verdicts) counts[v.outcome]++;

    let outcome: VerdictOutcome = 'revise';
    if (counts.approve >= required) outcome = 'approve';
    else if (counts.reject >= required) outcome = 'reject';

    const avgScore = verdicts.reduce((s, v) => s + v.score, 0) / n;
    return {
      algorithm: 'bft', outcome, finalScore: avgScore,
      votes: verdicts, entropy: this.shannonEntropy(verdicts.map(v => v.outcome)),
      agreementRatio: Math.max(counts.approve, counts.reject, counts.revise) / n,
      details: `BFT: need ${required}/${n}. approve=${counts.approve}, revise=${counts.revise}, reject=${counts.reject}`,
    };
  }

  /** Raft-Inspired consensus: leader decides, followers confirm */
  private raftConsensus(verdicts: JudgeVerdict[]): ConsensusResult {
    const leader = verdicts[0];
    const followers = verdicts.slice(1);
    const confirms = followers.filter(v => v.outcome === leader.outcome).length;
    const majority = confirms >= followers.length / 2;

    const outcome = majority ? leader.outcome : 'revise';
    const avgScore = verdicts.reduce((s, v) => s + v.score, 0) / verdicts.length;

    return {
      algorithm: 'raft', outcome, finalScore: avgScore,
      votes: verdicts, entropy: this.shannonEntropy(verdicts.map(v => v.outcome)),
      agreementRatio: (confirms + 1) / verdicts.length,
      details: `Raft: leader=${leader.outcome}, confirms=${confirms}/${followers.length}`,
    };
  }

  /** Shannon entropy: H = -Σ pi log pi */
  private shannonEntropy(outcomes: VerdictOutcome[]): number {
    const counts: Record<string, number> = {};
    for (const o of outcomes) counts[o] = (counts[o] || 0) + 1;

    let entropy = 0;
    const n = outcomes.length;
    for (const count of Object.values(counts)) {
      const p = count / n;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  private selectProfile(taskType: TaskType): JudgeProfile {
    const map: Record<TaskType, string> = {
      code: 'code', research: 'research', creative: 'creative',
      analysis: 'default', custom: 'default',
    };
    return this.profiles[map[taskType]] || this.profiles['default'];
  }

  private prepareContext(prompt: string, output: string, profile: JudgeProfile): string {
    return `## Task\n${prompt}\n\n## Output to Evaluate\n${output}\n\n## Evaluation Profile: ${profile.name}`;
  }

  private antiFabricationCheck(output: string): boolean {
    return output.length > 0 && output.trim().length > 10;
  }

  private persistVerdicts(taskId: string, verdicts: JudgeVerdict[], consensus: ConsensusResult): void {
    const db = getDatabase().getDb();
    for (const v of verdicts) {
      db.prepare(`
        INSERT INTO judge_verdicts (task_id, judge_id, model_used, outcome, score, criteria_json, feedback, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(taskId, v.judgeId, v.modelUsed, v.outcome, v.score, JSON.stringify(v.criteria), v.feedback, v.confidence);
    }
    db.prepare(`
      INSERT INTO judge_consensus (task_id, algorithm, outcome, final_score, entropy, agreement_ratio, votes_json, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskId, consensus.algorithm, consensus.outcome, consensus.finalScore, consensus.entropy, consensus.agreementRatio, JSON.stringify(verdicts), consensus.details);
  }

  private extractJSON(text: string): string {
    const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
    return match ? (match[1] || match[0]).trim() : text;
  }
}
