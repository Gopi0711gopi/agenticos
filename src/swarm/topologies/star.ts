// ============================================================================
// Peripheral Agentic OS — Star Topology (Hub-Spoke)
// ============================================================================

import type { TopologyContext, TopologyResult } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * Star topology: Hub decomposes → spokes execute → hub synthesizes.
 * First agent is the hub; remaining are spokes.
 */
export async function executeStar(
  agents: ForgeAgentDef[],
  prompt: string,
  ctx: TopologyContext
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};

  const hub = agents[0];
  const spokes = agents.slice(1);

  // Hub decomposes
  const decomposePrompt = `Analyze this task and create ${spokes.length} specialized sub-questions or sub-tasks, one for each specialist. Return a JSON array of strings.\n\nTask: ${prompt}\n\nSpecialists: ${spokes.map(s => `${s.name} (${s.role})`).join(', ')}`;

  const decomposition = await ctx.executeAgent(hub.name, decomposePrompt, hub.systemPrompt);
  agentOutputs[hub.name + '_plan'] = decomposition;

  let subtasks: string[];
  try {
    subtasks = JSON.parse(decomposition);
  } catch {
    subtasks = spokes.map(() => prompt);
  }

  // Spokes execute in parallel
  const spokeResults = await Promise.allSettled(
    spokes.map((spoke, i) => {
      const spokePrompt = subtasks[i] || prompt;
      ctx.sendMessage(hub.name, spoke.name, spokePrompt);
      return ctx.executeAgent(spoke.name, spokePrompt, spoke.systemPrompt);
    })
  );

  const spokeOutputs: string[] = [];
  spokeResults.forEach((result, i) => {
    const output = result.status === 'fulfilled' ? result.value : `Error: ${result.reason}`;
    agentOutputs[spokes[i].name] = output;
    spokeOutputs.push(`**${spokes[i].name}** (${spokes[i].role}):\n${output}`);
    ctx.sendMessage(spokes[i].name, hub.name, output);
  });

  // Hub synthesizes
  const synthesizePrompt = `Synthesize these specialist responses into a comprehensive answer.\n\nOriginal task: ${prompt}\n\nSpecialist responses:\n${spokeOutputs.join('\n\n---\n\n')}`;

  const finalOutput = await ctx.executeAgent(hub.name, synthesizePrompt, hub.systemPrompt);
  agentOutputs[hub.name] = finalOutput;

  return {
    topologyType: 'star',
    finalOutput,
    agentOutputs,
    rounds: 3,
    totalMessages: spokes.length * 2 + 1,
    convergenceReason: 'Hub declared done',
    durationMs: Date.now() - start,
  };
}
