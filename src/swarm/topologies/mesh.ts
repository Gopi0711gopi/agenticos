// ============================================================================
// Peripheral Agentic OS — Mesh Topology (All-to-All Broadcast)
// ============================================================================

import type { TopologyContext, TopologyResult } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * Mesh topology: All-to-all broadcast with reactive convergence.
 * Every agent sees every other agent's output each round.
 * Converges when no agent changes output or max rounds reached.
 */
export async function executeMesh(
  agents: ForgeAgentDef[],
  prompt: string,
  ctx: TopologyContext
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};
  let previousOutputs: Record<string, string> = {};
  let round = 0;
  let converged = false;

  // Initial round: all agents respond to prompt
  const initialResults = await Promise.allSettled(
    agents.map(agent => ctx.executeAgent(agent.name, prompt, agent.systemPrompt))
  );

  initialResults.forEach((result, i) => {
    agentOutputs[agents[i].name] = result.status === 'fulfilled' ? result.value : '';
    previousOutputs[agents[i].name] = agentOutputs[agents[i].name];
  });

  while (round < ctx.maxRounds && !converged) {
    round++;

    // Each agent sees all other outputs and refines
    const newOutputs: Record<string, string> = {};
    const roundResults = await Promise.allSettled(
      agents.map(agent => {
        const othersContext = Object.entries(agentOutputs)
          .filter(([name]) => name !== agent.name)
          .map(([name, output]) => `${name}: ${output}`)
          .join('\n\n');

        const meshPrompt = `Refine your response considering other perspectives. If your response is already optimal, return it unchanged.\n\nOriginal task: ${prompt}\n\nYour current response: ${agentOutputs[agent.name]}\n\nOther agents' responses:\n${othersContext}`;

        return ctx.executeAgent(agent.name, meshPrompt, agent.systemPrompt);
      })
    );

    roundResults.forEach((result, i) => {
      newOutputs[agents[i].name] = result.status === 'fulfilled' ? result.value : agentOutputs[agents[i].name];
    });

    // Check convergence: no significant changes
    converged = agents.every(agent =>
      newOutputs[agent.name] === previousOutputs[agent.name] ||
      similarity(newOutputs[agent.name], previousOutputs[agent.name]) > 0.95
    );

    previousOutputs = { ...agentOutputs };
    Object.assign(agentOutputs, newOutputs);

    // Broadcast updates
    for (const agent of agents) {
      ctx.broadcast(agent.name, agentOutputs[agent.name], [agent.name]);
    }
  }

  // Final output: synthesize all agent outputs
  const finalOutput = Object.entries(agentOutputs)
    .map(([name, output]) => `## ${name}\n${output}`)
    .join('\n\n---\n\n');

  return {
    topologyType: 'mesh',
    finalOutput,
    agentOutputs,
    rounds: round + 1,
    totalMessages: (round + 1) * agents.length * (agents.length - 1),
    convergenceReason: converged ? 'No new messages' : 'Max rounds reached',
    durationMs: Date.now() - start,
  };
}

/** Simple text similarity (Jaccard on words) */
function similarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}
