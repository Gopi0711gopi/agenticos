// ============================================================================
// Peripheral Agentic OS — DAG Topology (Topological Sort)
// ============================================================================

import type { TopologyContext, TopologyResult, DAGNode } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * DAG topology: Topological sort with level-parallel execution.
 * Agents are arranged in a directed acyclic graph.
 * Terminates when all leaf nodes complete.
 */
export async function executeDAG(
  agents: ForgeAgentDef[],
  prompt: string,
  ctx: TopologyContext,
  dagNodes?: DAGNode[]
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};

  // Build DAG from agents if no explicit nodes provided
  const nodes: DAGNode[] = dagNodes || agents.map((agent, i) => ({
    agentId: agent.name,
    dependencies: i > 0 ? [agents[i - 1].name] : [],
    prompt: undefined,
  }));

  // Topological sort
  const levels = topologicalSort(nodes);

  // Execute level by level (agents within a level run in parallel)
  let round = 0;
  for (const level of levels) {
    round++;
    const results = await Promise.allSettled(
      level.map(async (node) => {
        // Gather dependency outputs
        const depOutputs = node.dependencies
          .map(dep => agentOutputs[dep])
          .filter(Boolean)
          .join('\n\n');

        const agentPrompt = depOutputs
          ? `Previous outputs:\n${depOutputs}\n\nTask: ${node.prompt || prompt}`
          : node.prompt || prompt;

        const agent = agents.find(a => a.name === node.agentId);
        return {
          agentId: node.agentId,
          output: await ctx.executeAgent(node.agentId, agentPrompt, agent?.systemPrompt),
        };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        agentOutputs[result.value.agentId] = result.value.output;
      }
    }
  }

  // Final output is from the last level's agents
  const lastLevel = levels[levels.length - 1];
  const finalOutput = lastLevel
    .map(n => agentOutputs[n.agentId])
    .filter(Boolean)
    .join('\n\n');

  return {
    topologyType: 'dag',
    finalOutput,
    agentOutputs,
    rounds: round,
    totalMessages: nodes.length,
    convergenceReason: 'All leaves completed',
    durationMs: Date.now() - start,
  };
}

/** Topological sort returning levels for parallel execution */
function topologicalSort(nodes: DAGNode[]): DAGNode[][] {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.agentId, 0);
    adjList.set(node.agentId, []);
  }

  // Build adjacency
  for (const node of nodes) {
    for (const dep of node.dependencies) {
      if (!adjList.has(dep)) adjList.set(dep, []);
      adjList.get(dep)!.push(node.agentId);
      inDegree.set(node.agentId, (inDegree.get(node.agentId) || 0) + 1);
    }
  }

  const levels: DAGNode[][] = [];
  let queue = nodes.filter(n => (inDegree.get(n.agentId) || 0) === 0);

  while (queue.length > 0) {
    levels.push(queue);
    const nextQueue: DAGNode[] = [];

    for (const node of queue) {
      for (const neighbor of (adjList.get(node.agentId) || [])) {
        inDegree.set(neighbor, (inDegree.get(neighbor) || 0) - 1);
        if (inDegree.get(neighbor) === 0) {
          const neighborNode = nodes.find(n => n.agentId === neighbor);
          if (neighborNode) nextQueue.push(neighborNode);
        }
      }
    }

    queue = nextQueue;
  }

  return levels;
}
