// ============================================================================
// Peripheral Agentic OS — Sequential Topology (Chain)
// ============================================================================

import type { TopologyContext, TopologyResult } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * Sequential topology: Chain execution where Ai output → Ai+1 input.
 * Terminates when the last agent completes.
 */
export async function executeSequential(
  agents: ForgeAgentDef[],
  initialPrompt: string,
  ctx: TopologyContext
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};
  let currentInput = initialPrompt;

  // Sort agents by order if specified
  const sorted = [...agents].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const agent of sorted) {
    const output = await ctx.executeAgent(agent.name, currentInput, agent.systemPrompt);
    agentOutputs[agent.name] = output;
    currentInput = output; // Chain: output becomes next input
    ctx.sendMessage(agent.name, sorted[sorted.indexOf(agent) + 1]?.name ?? 'output', output);
  }

  return {
    topologyType: 'sequential',
    finalOutput: currentInput, // Last agent's output
    agentOutputs,
    rounds: 1,
    totalMessages: sorted.length,
    convergenceReason: 'Last agent completed',
    durationMs: Date.now() - start,
  };
}
