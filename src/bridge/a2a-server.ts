// ============================================================================
// Peripheral Agentic OS — Claw Bridge: A2A Server
// Google Agent-to-Agent protocol implementation
// ============================================================================

import { v4 as uuid } from 'uuid';
import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type {
  A2AAgentCard, A2ATask, A2ATaskStatus, A2AMessage, A2AArtifact, A2APart
} from '../types/bridge.js';

export class A2AServer {
  private tasks: Map<string, A2ATask> = new Map();
  private agentCard: A2AAgentCard;

  constructor(private orchestrator: Orchestrator) {
    this.agentCard = {
      name: 'Peripheral Agentic OS',
      description: 'Universal AI agent orchestration engine with 12 topologies, multi-model routing, and consensus-based quality assurance',
      url: 'http://localhost:3700',
      version: '2.0.0',
      capabilities: [{ streaming: false, pushNotifications: false, stateTransitionHistory: true }],
      skills: [
        { id: 'orchestrate', name: 'Task Orchestration', description: 'Execute complex multi-agent tasks', inputModes: ['text'], outputModes: ['text'], tags: ['orchestration', 'multi-agent'] },
        { id: 'code', name: 'Code Generation', description: 'Generate and review code with multi-agent debate', inputModes: ['text'], outputModes: ['text'], tags: ['code', 'development'] },
        { id: 'research', name: 'Research & Analysis', description: 'Deep research with parallel agent investigation', inputModes: ['text'], outputModes: ['text'], tags: ['research', 'analysis'] },
        { id: 'creative', name: 'Creative Writing', description: 'Creative content via mixture-of-agents topology', inputModes: ['text'], outputModes: ['text'], tags: ['creative', 'writing'] },
      ],
    };
    eventBus.emit('bridge:a2a_server_init', { skills: this.agentCard.skills.length }, 'A2AServer');
  }

  // ── Agent Card ──────────────────────────────────────────────────────────

  getAgentCard(): A2AAgentCard { return this.agentCard; }

  // ── Task Management ─────────────────────────────────────────────────────

  async createTask(sessionId: string, message: A2AMessage): Promise<A2ATask> {
    const task: A2ATask = {
      id: uuid(),
      sessionId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      messages: [message],
      artifacts: [],
    };
    this.tasks.set(task.id, task);

    // Persist to database
    const db = getDatabase().getDb();
    db.prepare(`INSERT OR IGNORE INTO tasks (id, type, status, budget, created_at)
                VALUES (?, 'a2a', 'submitted', 1.0, ?)`).run(task.id, task.status.timestamp);

    eventBus.emit('bridge:a2a_task_created', { taskId: task.id, sessionId }, 'A2AServer');

    // Execute asynchronously
    this.executeTask(task);
    return task;
  }

  private async executeTask(task: A2ATask): Promise<void> {
    // Update status to working
    task.status = { state: 'working', timestamp: new Date().toISOString() };

    try {
      // Extract text from message parts
      const prompt = task.messages
        .filter(m => m.role === 'user')
        .flatMap(m => m.parts)
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map(p => p.text)
        .join('\n');

      // Run through orchestrator
      const result = await this.orchestrator.run(prompt, { budget: 1.0 });

      // Create artifact from result
      const artifact: A2AArtifact = {
        name: 'result',
        description: 'Task execution result',
        parts: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        index: 0,
      };
      task.artifacts.push(artifact);

      // Add agent response message
      task.messages.push({
        role: 'agent',
        parts: [{ type: 'text', text: result.output || 'Task completed' }],
        timestamp: new Date().toISOString(),
      });

      task.status = { state: 'completed', timestamp: new Date().toISOString() };
      eventBus.emit('bridge:a2a_task_completed', { taskId: task.id }, 'A2AServer');
    } catch (e: any) {
      task.status = { state: 'failed', message: e.message, timestamp: new Date().toISOString() };
      task.messages.push({
        role: 'agent',
        parts: [{ type: 'text', text: `Error: ${e.message}` }],
        timestamp: new Date().toISOString(),
      });
      eventBus.emit('bridge:a2a_task_failed', { taskId: task.id, error: e.message }, 'A2AServer');
    }
  }

  getTask(taskId: string): A2ATask | undefined { return this.tasks.get(taskId); }
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status.state === 'completed' || task.status.state === 'canceled') return false;
    task.status = { state: 'canceled', timestamp: new Date().toISOString() };
    return true;
  }

  // ── HTTP Route Handlers ─────────────────────────────────────────────────

  handleAgentCard(): A2AAgentCard { return this.agentCard; }

  async handleSendTask(body: { id: string; sessionId: string; message: A2AMessage }): Promise<{ id: string; result: A2ATask }> {
    const task = await this.createTask(body.sessionId || uuid(), body.message);
    return { id: body.id, result: task };
  }

  handleGetTask(body: { id: string; params: { id: string } }): { id: string; result: A2ATask | null } {
    const task = this.getTask(body.params.id);
    return { id: body.id, result: task || null };
  }

  handleCancelTask(body: { id: string; params: { id: string } }): { id: string; result: boolean } {
    return { id: body.id, result: this.cancelTask(body.params.id) };
  }

  // ── JSON-RPC Handler ────────────────────────────────────────────────────

  async handleJsonRpc(request: { id: string; method: string; params?: any }): Promise<unknown> {
    switch (request.method) {
      case 'tasks/send':
        return this.handleSendTask({ id: request.id, ...(request.params || {}) });
      case 'tasks/get':
        return this.handleGetTask({ id: request.id, params: request.params || {} });
      case 'tasks/cancel':
        return this.handleCancelTask({ id: request.id, params: request.params || {} });
      default:
        return { id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } };
    }
  }
}
