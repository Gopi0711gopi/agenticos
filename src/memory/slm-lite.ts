// ============================================================================
// Peripheral Agentic OS — SLM-Lite: Four-Layer Cognitive Memory
// ============================================================================

import { v4 as uuid } from 'uuid';
import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { IMemory } from '../core/orchestrator.js';
import type {
  MemoryEntry, MemoryLayer, MemoryAutoInvokeResult,
  WorkingMemoryEntry, TrustComponents
} from '../types/memory.js';
import type { TaskType } from '../types/task.js';

/**
 * SLM-Lite: Local-first cognitive memory system.
 * 4 layers: Working → Episodic → Semantic → Procedural
 * Trust scoring: T = C · (1-R) · D · V
 */
export class SLMLite implements IMemory {
  private workingMemory: Map<string, WorkingMemoryEntry>;
  private maxWorking: number;

  constructor(maxWorking = 100) {
    this.workingMemory = new Map();
    this.maxWorking = maxWorking;
  }

  // ===== Working Memory (volatile, in-memory Map) =====

  storeWorking(key: string, content: string, ttlMs = 300000): void {
    if (this.workingMemory.size >= this.maxWorking) {
      // Evict oldest
      const oldest = [...this.workingMemory.entries()].sort((a, b) =>
        new Date(a[1].lastAccessedAt).getTime() - new Date(b[1].lastAccessedAt).getTime()
      )[0];
      if (oldest) this.workingMemory.delete(oldest[0]);
    }

    this.workingMemory.set(key, {
      id: uuid(), layer: 'working', content, metadata: {},
      accessCount: 0, trustScore: 1.0,
      createdAt: new Date().toISOString(), lastAccessedAt: new Date().toISOString(),
      ttlMs,
    });
    eventBus.emit('memory:working_stored', { key }, 'SLMLite');
  }

  getWorking(key: string): string | null {
    const entry = this.workingMemory.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - new Date(entry.createdAt).getTime() > entry.ttlMs) {
      this.workingMemory.delete(key);
      return null;
    }

    entry.accessCount++;
    entry.lastAccessedAt = new Date().toISOString();

    // Promote if accessed enough
    if (entry.accessCount >= 3) {
      this.storeEpisodic('auto', entry.content, 'working_promotion', 0.5);
    }

    return entry.content;
  }

  // ===== Episodic Memory (event/session, persisted with FTS5) =====

  storeEpisodic(sessionId: string, content: string, eventType: string, importance = 0.5): string {
    const id = uuid();
    const db = getDatabase().getDb();
    db.prepare(`
      INSERT INTO episodic_memories (id, session_id, event_type, content, importance, trust_score)
      VALUES (?, ?, ?, ?, ?, 0.5)
    `).run(id, sessionId, eventType, content, importance);

    eventBus.emit('memory:episodic_stored', { id, sessionId }, 'SLMLite');
    return id;
  }

  searchEpisodic(query: string, limit = 10): Array<{ id: string; content: string; score: number }> {
    const db = getDatabase().getDb();
    try {
      const rows = db.prepare(`
        SELECT id, content, importance as score FROM episodic_memories
        WHERE content LIKE ? ORDER BY importance DESC, created_at DESC LIMIT ?
      `).all(`%${query}%`, limit) as any[];
      return rows;
    } catch {
      return [];
    }
  }

  // ===== Semantic Memory (long-term knowledge with trust) =====

  storeSemantic(category: string, content: string, source: 'user' | 'agent' | 'system' = 'system'): string {
    const id = uuid();
    const credibility = source === 'user' ? 1.0 : source === 'agent' ? 0.7 : 0.8;
    const trustScore = this.computeTrust({ credibility, contradictionScore: 0, temporalDecay: 1.0, crossValidation: 0.5 });

    const db = getDatabase().getDb();
    db.prepare(`
      INSERT INTO semantic_memories (id, category, content, source, credibility, trust_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, category, content, source, credibility, trustScore);

    eventBus.emit('memory:semantic_stored', { id, category }, 'SLMLite');
    return id;
  }

  getSemantic(category: string, limit = 5): Array<{ content: string; trustScore: number }> {
    const db = getDatabase().getDb();
    const rows = db.prepare(`
      SELECT content, trust_score as trustScore FROM semantic_memories
      WHERE category = ? AND trust_score >= 0.3 ORDER BY trust_score DESC LIMIT ?
    `).all(category, limit) as any[];
    return rows;
  }

  // ===== Procedural Memory (learned patterns) =====

  storeProcedural(taskType: string, pattern: string, strategy: string, successRate: number): string {
    const id = uuid();
    const db = getDatabase().getDb();
    db.prepare(`
      INSERT INTO procedural_memories (id, pattern, task_type, strategy, success_rate, sample_size, trust_score)
      VALUES (?, ?, ?, ?, ?, 1, 0.5)
    `).run(id, pattern, taskType, strategy, successRate);

    eventBus.emit('memory:procedural_stored', { id, taskType }, 'SLMLite');
    return id;
  }

  getProcedural(taskType: string): Array<{ pattern: string; strategy: string; successRate: number }> {
    const db = getDatabase().getDb();
    return db.prepare(`
      SELECT pattern, strategy, success_rate as successRate FROM procedural_memories
      WHERE task_type = ? ORDER BY success_rate DESC LIMIT 5
    `).all(taskType) as any[];
  }

  // ===== Auto-Invoke (Context Recall for Orchestrator) =====

  async autoInvoke(prompt: string, taskType: TaskType): Promise<MemoryAutoInvokeResult> {
    eventBus.emit('memory:auto_invoked', { taskType }, 'SLMLite');

    const workingContext = [...this.workingMemory.values()]
      .filter(e => Date.now() - new Date(e.createdAt).getTime() < e.ttlMs)
      .map(e => e.content)
      .slice(0, 5);

    const episodicContext = this.searchEpisodic(prompt.substring(0, 100), 3).map(r => r.content);
    const semanticContext = this.getSemantic(taskType, 3).map(r => r.content);
    const proceduralHints = this.getProcedural(taskType).map(r => `${r.strategy}: ${r.pattern} (${(r.successRate * 100).toFixed(0)}%)`);

    const result: MemoryAutoInvokeResult = {
      workingContext, episodicContext, semanticContext, proceduralHints,
      totalRecalled: workingContext.length + episodicContext.length + semanticContext.length + proceduralHints.length,
    };

    eventBus.emit('memory:context_recalled', { totalRecalled: result.totalRecalled }, 'SLMLite');
    return result;
  }

  /** Record agent behavior (IMemory interface) */
  async recordBehavior(taskId: string, agentId: string, pattern: string): Promise<void> {
    this.storeProcedural('general', pattern, agentId, 0.5);
  }

  // ===== Trust Scoring =====

  /** T = C · (1-R) · D · V */
  computeTrust(components: TrustComponents): number {
    return components.credibility
      * (1 - components.contradictionScore)
      * components.temporalDecay
      * components.crossValidation;
  }

  // ===== Stats =====

  getStats(): { working: number; episodic: number; semantic: number; procedural: number } {
    const db = getDatabase().getDb();
    const episodic = (db.prepare('SELECT COUNT(*) as c FROM episodic_memories').get() as any).c;
    const semantic = (db.prepare('SELECT COUNT(*) as c FROM semantic_memories').get() as any).c;
    const procedural = (db.prepare('SELECT COUNT(*) as c FROM procedural_memories').get() as any).c;
    return { working: this.workingMemory.size, episodic, semantic, procedural };
  }
}
