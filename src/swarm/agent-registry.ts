// ============================================================================
// Peripheral Agentic OS — Agent Registry (5-State Lifecycle)
// ============================================================================

import { v4 as uuid } from 'uuid';
import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { AgentSpec, AgentState, AgentRole, AgentTransition } from '../types/agent.js';

/**
 * Agent Registry manages the lifecycle of all agents.
 * Implements a 5-state FSM: idle → working → paused/error/terminated
 */
export class AgentRegistry {
  private agents: Map<string, AgentSpec>;

  constructor() {
    this.agents = new Map();
  }

  /** Register a new agent */
  register(role: AgentRole, teamId?: string): AgentSpec {
    const agent: AgentSpec = {
      id: uuid(),
      name: role.name,
      role,
      state: 'idle',
      teamId,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.agents.set(agent.id, agent);

    // Persist
    const db = getDatabase().getDb();
    db.prepare(`
      INSERT INTO agents (id, name, role_name, role_description, system_prompt, state, tier, team_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.id, agent.name, agent.role.name, agent.role.description,
      agent.role.systemPrompt, agent.state, agent.role.tier || 'standard', teamId
    );

    eventBus.emit('agent:registered', {
      agentId: agent.id,
      name: agent.name,
      role: agent.role.name,
      teamId,
    }, 'AgentRegistry');

    return agent;
  }

  /** Transition an agent to a new state */
  transition(agentId: string, newState: AgentState, reason: string): AgentTransition | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    // Validate transition
    if (!this.isValidTransition(agent.state, newState)) {
      console.warn(`Invalid state transition: ${agent.state} → ${newState} for agent ${agentId}`);
      return null;
    }

    const transition: AgentTransition = {
      agentId,
      fromState: agent.state,
      toState: newState,
      reason,
      timestamp: new Date().toISOString(),
    };

    agent.state = newState;
    agent.updatedAt = transition.timestamp;

    // Persist state change
    const db = getDatabase().getDb();
    db.prepare('UPDATE agents SET state = ?, updated_at = ? WHERE id = ?')
      .run(newState, transition.timestamp, agentId);
    db.prepare('INSERT INTO agent_states (agent_id, from_state, to_state, reason) VALUES (?, ?, ?, ?)')
      .run(agentId, transition.fromState, transition.toState, reason);

    eventBus.emit('agent:state_changed', {
      agentId,
      from: transition.fromState,
      to: transition.toState,
      reason,
    }, 'AgentRegistry');

    return transition;
  }

  /** Get an agent by ID */
  get(agentId: string): AgentSpec | undefined {
    return this.agents.get(agentId);
  }

  /** Get all agents for a team */
  getTeamAgents(teamId: string): AgentSpec[] {
    return [...this.agents.values()].filter(a => a.teamId === teamId);
  }

  /** Get all agents in a given state */
  getByState(state: AgentState): AgentSpec[] {
    return [...this.agents.values()].filter(a => a.state === state);
  }

  /** Get all agents */
  getAll(): AgentSpec[] {
    return [...this.agents.values()];
  }

  /** Remove an agent */
  remove(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    this.transition(agentId, 'terminated', 'Removed from registry');
    this.agents.delete(agentId);
    return true;
  }

  /** Validate state transitions */
  private isValidTransition(from: AgentState, to: AgentState): boolean {
    const validTransitions: Record<AgentState, AgentState[]> = {
      idle: ['working', 'terminated'],
      working: ['idle', 'paused', 'error', 'terminated'],
      paused: ['working', 'terminated'],
      error: ['idle', 'terminated'],
      terminated: [], // Terminal state
    };
    return validTransitions[from]?.includes(to) || false;
  }

  /** Get agent count */
  get count(): number {
    return this.agents.size;
  }
}
