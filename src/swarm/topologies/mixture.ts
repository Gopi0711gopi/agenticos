// ============================================================================
// Peripheral Agentic OS — Mixture Topology (N-1 generators + 1 aggregator)
// ============================================================================

import type { TopologyContext, TopologyResult } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * Mixture topology: N-1 generators produce outputs, 1 aggregator synthesizes.
 * Last agent is the aggregator.
 */
export async function executeMixture(
  agents: ForgeAgentDef[],
  prompt: string,
  ctx: TopologyContext
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};

  if (agents.length < 2) {
    throw new Error('Mixture topology requires at least 2 agents');
  }

  const generators = agents.slice(0, -1);
  const aggregator = agents[agents.length - 1];

  // Step 1: Generators run in parallel
  const genResults = await Promise.allSettled(
    generators.map(gen => ctx.executeAgent(gen.name, prompt, gen.systemPrompt))
  );

  const generatorOutputs: string[] = [];
  genResults.forEach((result, i) => {
    const output = result.status === 'fulfilled' ? result.value : `Error: ${result.reason}`;
    agentOutputs[generators[i].name] = output;
    generatorOutputs.push(`### ${generators[i].name} (${generators[i].role})\n${output}`);
    ctx.sendMessage(generators[i].name, aggregator.name, output);
  });

  // Step 2: Aggregator synthesizes
  const aggPrompt = `You are the aggregator. Synthesize these ${generators.length} perspectives into a unified, comprehensive response.\n\nOriginal task: ${prompt}\n\nPerspectives:\n${generatorOutputs.join('\n\n---\n\n')}`;

  const finalOutput = await ctx.executeAgent(aggregator.name, aggPrompt, aggregator.systemPrompt);
  agentOutputs[aggregator.name] = finalOutput;

  return {
    topologyType: 'mixture',
    finalOutput,
    agentOutputs,
    rounds: 2,
    totalMessages: generators.length + 1,
    convergenceReason: 'Aggregator completed',
    durationMs: Date.now() - start,
  };
}
