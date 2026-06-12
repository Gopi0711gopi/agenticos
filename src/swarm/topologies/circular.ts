// ============================================================================
// Peripheral Agentic OS — Circular Topology (Ring)
// ============================================================================

import type { TopologyContext, TopologyResult } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * Circular topology: Ring passing with stability detection.
 * Messages pass around the ring; converges when output stabilizes.
 */
export async function executeCircular(
  agents: ForgeAgentDef[],
  prompt: string,
  ctx: TopologyContext
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};
  let round = 0;
  let stable = false;
  let currentMessage = prompt;
  let previousMessage = '';

  while (round < ctx.maxRounds && !stable) {
    round++;
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const nextAgent = agents[(i + 1) % agents.length];
      const ringPrompt = `You are part of a ring discussion (round ${round}). Refine and improve the current message, then pass it forward.\n\nOriginal task: ${prompt}\n\nCurrent message to refine:\n${currentMessage}`;

      currentMessage = await ctx.executeAgent(agent.name, ringPrompt, agent.systemPrompt);
      agentOutputs[`${agent.name}_r${round}`] = currentMessage;
      ctx.sendMessage(agent.name, nextAgent.name, currentMessage);
    }

    // Check stability
    if (similarity(currentMessage, previousMessage) > 0.9) {
      stable = true;
    }
    previousMessage = currentMessage;
  }

  agentOutputs['final'] = currentMessage;

  return {
    topologyType: 'circular',
    finalOutput: currentMessage,
    agentOutputs,
    rounds: round,
    totalMessages: round * agents.length,
    convergenceReason: stable ? 'Stable output detected' : 'Max rounds reached',
    durationMs: Date.now() - start,
  };
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}
