// ============================================================================
// Peripheral Agentic OS — Hierarchical Topology (Manager-Worker)
// ============================================================================

import type { TopologyContext, TopologyResult } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * Hierarchical topology: Manager decomposes task → workers execute → manager merges.
 * The first agent is the manager; remaining agents are workers.
 */
export async function executeHierarchical(
  agents: ForgeAgentDef[],
  prompt: string,
  ctx: TopologyContext
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};

  if (agents.length < 2) {
    throw new Error('Hierarchical topology requires at least 2 agents (1 manager + 1 worker)');
  }

  const manager = agents[0];
  const workers = agents.slice(1);

  // Step 1: Manager decomposes the task
  const decompositionPrompt = `You are a manager. Decompose this task into ${workers.length} subtasks, one for each team member. Output a JSON array of subtask descriptions.\n\nTask: ${prompt}\n\nTeam members: ${workers.map(w => w.name).join(', ')}`;

  const decomposition = await ctx.executeAgent(manager.name, decompositionPrompt, manager.systemPrompt);
  agentOutputs[manager.name + '_decomposition'] = decomposition;

  // Parse subtasks  
  let subtasks: string[];
  try {
    subtasks = JSON.parse(decomposition);
    if (!Array.isArray(subtasks)) subtasks = [decomposition];
  } catch {
    // If not valid JSON, split by lines or use as single task
    subtasks = decomposition.split('\n').filter(l => l.trim().length > 0);
  }

  // Ensure we have enough subtasks
  while (subtasks.length < workers.length) {
    subtasks.push(prompt); // Fallback to original prompt
  }

  // Step 2: Workers execute subtasks in parallel
  const workerResults = await Promise.allSettled(
    workers.map((worker, i) =>
      ctx.executeAgent(worker.name, subtasks[i] || prompt, worker.systemPrompt)
    )
  );

  const workerOutputs: string[] = [];
  workerResults.forEach((result, i) => {
    const output = result.status === 'fulfilled' ? result.value : `Error: ${result.reason}`;
    agentOutputs[workers[i].name] = output;
    workerOutputs.push(`### ${workers[i].name}\n${output}`);
    ctx.sendMessage(workers[i].name, manager.name, output);
  });

  // Step 3: Manager merges worker outputs
  const mergePrompt = `You are a manager. Merge these worker outputs into a cohesive final result.\n\nOriginal task: ${prompt}\n\nWorker outputs:\n${workerOutputs.join('\n\n')}`;

  const finalOutput = await ctx.executeAgent(manager.name, mergePrompt, manager.systemPrompt);
  agentOutputs[manager.name] = finalOutput;

  return {
    topologyType: 'hierarchical',
    finalOutput,
    agentOutputs,
    rounds: 3, // decompose + execute + merge
    totalMessages: workers.length * 2 + 1,
    convergenceReason: 'Manager approved merged output',
    durationMs: Date.now() - start,
  };
}
