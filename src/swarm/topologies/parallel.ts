// ============================================================================
// Peripheral Agentic OS — Parallel Topology (Fan-out)
// ============================================================================

import type { TopologyContext, TopologyResult } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * Parallel topology: Fan-out via Promise.allSettled.
 * All agents execute simultaneously with the same prompt.
 * Terminates when all agents complete.
 */
export async function executeParallel(
  agents: ForgeAgentDef[],
  prompt: string,
  ctx: TopologyContext
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};

  const results = await Promise.allSettled(
    agents.map(agent => ctx.executeAgent(agent.name, prompt, agent.systemPrompt))
  );

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      agentOutputs[agents[i].name] = result.value;
    } else {
      agentOutputs[agents[i].name] = `Error: ${result.reason}`;
    }
  });

  // Aggregate all outputs
  const finalOutput = Object.entries(agentOutputs)
    .map(([name, output]) => `## ${name}\n${output}`)
    .join('\n\n---\n\n');

  return {
    topologyType: 'parallel',
    finalOutput,
    agentOutputs,
    rounds: 1,
    totalMessages: agents.length,
    convergenceReason: 'All agents completed',
    durationMs: Date.now() - start,
  };
}
