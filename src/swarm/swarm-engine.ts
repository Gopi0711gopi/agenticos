// ============================================================================
// Peripheral Agentic OS — Swarm Engine (Topology Dispatcher)
// ============================================================================

import { v4 as uuid } from 'uuid';
import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import { MsgHub } from './msg-hub.js';
import { AgentRegistry } from './agent-registry.js';
import type { TopologyType, TopologyContext, TopologyResult } from '../types/topology.js';
import type { TeamDesign, ForgeAgentDef } from '../types/forge.js';

// Import all 12 topologies
import { executeSequential } from './topologies/sequential.js';
import { executeParallel } from './topologies/parallel.js';
import { executeHierarchical } from './topologies/hierarchical.js';
import { executeDAG } from './topologies/dag.js';
import { executeMixture } from './topologies/mixture.js';
import { executeDebate } from './topologies/debate.js';
import { executeMesh } from './topologies/mesh.js';
import { executeStar } from './topologies/star.js';
import { executeCircular } from './topologies/circular.js';
import { executeGrid } from './topologies/grid.js';
import { executeForest } from './topologies/forest.js';
import { executeMaker } from './topologies/maker.js';

/** Agent executor function type */
export type AgentExecutor = (agentId: string, prompt: string, systemPrompt?: string) => Promise<string>;

/**
 * Swarm Engine dispatches agent teams according to topology type.
 * Manages the MsgHub, creates topology context, and records executions.
 */
export class SwarmEngine {
  private registry: AgentRegistry;
  private executor: AgentExecutor;

  constructor(registry: AgentRegistry, executor: AgentExecutor) {
    this.registry = registry;
    this.executor = executor;
  }

  /** Execute a team design using its specified topology */
  async execute(
    design: TeamDesign,
    prompt: string,
    maxRounds = 10,
    signal?: AbortSignal
  ): Promise<TopologyResult> {
    const msgHub = new MsgHub();
    const teamId = design.id;

    // Register agents in hub
    for (const agent of design.agents) {
      msgHub.registerAgent(agent.name);
    }

    // Create topology context
    const ctx: TopologyContext = {
      executeAgent: async (agentId: string, agentPrompt: string, systemPrompt?: string) => {
        eventBus.emit('swarm:agent_dispatched', { agentId, teamId }, 'SwarmEngine');
        const result = await this.executor(agentId, agentPrompt, systemPrompt);
        eventBus.emit('swarm:agent_collected', { agentId, teamId, outputLength: result.length }, 'SwarmEngine');
        return result;
      },
      sendMessage: (from, to, content) => msgHub.send(from, to, content),
      getMessages: (agentId) => msgHub.getMessages(agentId),
      broadcast: (from, content, exclude) => {
        msgHub.broadcast(from, content, exclude);
      },
      maxRounds,
      signal,
    };

    eventBus.emit('swarm:started', {
      teamId,
      topology: design.topology,
      agentCount: design.agents.length,
    }, 'SwarmEngine');

    try {
      const result = await this.dispatch(design.topology, design.agents, prompt, ctx, design);

      // Persist execution record
      const db = getDatabase().getDb();
      db.prepare(`
        INSERT INTO team_executions (team_id, task_id, topology, rounds, total_messages, duration_ms, final_output, convergence_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(teamId, '', design.topology, result.rounds, result.totalMessages, result.durationMs, result.finalOutput.substring(0, 10000), result.convergenceReason);

      eventBus.emit('swarm:completed', {
        teamId,
        topology: design.topology,
        rounds: result.rounds,
        durationMs: result.durationMs,
      }, 'SwarmEngine');

      return result;
    } catch (error) {
      eventBus.emit('swarm:failed', {
        teamId,
        topology: design.topology,
        error: String(error),
      }, 'SwarmEngine');
      throw error;
    }
  }

  /** Dispatch to the correct topology implementation */
  private async dispatch(
    topology: TopologyType,
    agents: ForgeAgentDef[],
    prompt: string,
    ctx: TopologyContext,
    design: TeamDesign
  ): Promise<TopologyResult> {
    eventBus.emit('swarm:topology_executing', { topology, agentCount: agents.length }, 'SwarmEngine');

    switch (topology) {
      case 'sequential':
        return executeSequential(agents, prompt, ctx);
      case 'parallel':
        return executeParallel(agents, prompt, ctx);
      case 'hierarchical':
        return executeHierarchical(agents, prompt, ctx);
      case 'dag':
        return executeDAG(agents, prompt, ctx);
      case 'mixture':
        return executeMixture(agents, prompt, ctx);
      case 'debate':
        return executeDebate(agents, prompt, ctx);
      case 'mesh':
        return executeMesh(agents, prompt, ctx);
      case 'star':
        return executeStar(agents, prompt, ctx);
      case 'circular':
        return executeCircular(agents, prompt, ctx);
      case 'grid':
        return executeGrid(agents, prompt, ctx);
      case 'forest':
        return executeForest(agents, prompt, ctx);
      case 'maker':
        return executeMaker(agents, prompt, ctx);
      default:
        throw new Error(`Unknown topology: ${topology}`);
    }
  }
}
