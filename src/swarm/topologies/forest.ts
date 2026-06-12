// ============================================================================
// Peripheral Agentic OS — Forest Topology (Multi-Tree Parallel)
// ============================================================================

import type { TopologyContext, TopologyResult, TreeNode } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * Forest topology: Multiple independent tree hierarchies in parallel.
 * Leaf agents run first; parent agents synthesize child outputs.
 * Supports ensemble-style parallel hierarchies without a single root.
 */
export async function executeForest(
  agents: ForgeAgentDef[],
  prompt: string,
  ctx: TopologyContext,
  trees?: TreeNode[]
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};

  // Build trees from agent definitions if not provided
  const forest = trees || buildDefaultForest(agents);

  // Execute all trees in parallel
  const treeResults = await Promise.allSettled(
    forest.map(tree => executeTree(tree, prompt, ctx, agentOutputs, agents))
  );

  const rootOutputs: string[] = [];
  treeResults.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      rootOutputs.push(result.value);
    }
  });

  // Synthesize all tree root outputs
  const finalOutput = rootOutputs.length === 1
    ? rootOutputs[0]
    : rootOutputs.map((output, i) => `## Tree ${i + 1}\n${output}`).join('\n\n---\n\n');

  return {
    topologyType: 'forest',
    finalOutput,
    agentOutputs,
    rounds: getMaxDepth(forest),
    totalMessages: Object.keys(agentOutputs).length,
    convergenceReason: 'All roots completed',
    durationMs: Date.now() - start,
  };
}

async function executeTree(
  node: TreeNode,
  prompt: string,
  ctx: TopologyContext,
  outputs: Record<string, string>,
  agents: ForgeAgentDef[]
): Promise<string> {
  // First, execute all children recursively
  const childOutputs: string[] = [];
  if (node.children.length > 0) {
    const childResults = await Promise.allSettled(
      node.children.map(child => executeTree(child, prompt, ctx, outputs, agents))
    );

    childResults.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        childOutputs.push(`${node.children[i].agentId}: ${result.value}`);
      }
    });
  }

  // Then execute this node
  const agent = agents.find(a => a.name === node.agentId);
  const nodePrompt = childOutputs.length > 0
    ? `Synthesize these child outputs:\n\n${childOutputs.join('\n\n')}\n\nOriginal task: ${prompt}`
    : prompt;

  const output = await ctx.executeAgent(node.agentId, nodePrompt, agent?.systemPrompt);
  outputs[node.agentId] = output;
  node.output = output;

  return output;
}

function buildDefaultForest(agents: ForgeAgentDef[]): TreeNode[] {
  if (agents.length <= 3) {
    // Single tree: first agent is root, rest are leaves
    return [{
      agentId: agents[0].name,
      children: agents.slice(1).map(a => ({ agentId: a.name, children: [] })),
    }];
  }

  // Multiple trees: split agents into groups of 3
  const trees: TreeNode[] = [];
  for (let i = 0; i < agents.length; i += 3) {
    const group = agents.slice(i, i + 3);
    trees.push({
      agentId: group[0].name,
      children: group.slice(1).map(a => ({ agentId: a.name, children: [] })),
    });
  }
  return trees;
}

function getMaxDepth(forest: TreeNode[]): number {
  function depth(node: TreeNode): number {
    if (node.children.length === 0) return 1;
    return 1 + Math.max(...node.children.map(depth));
  }
  return Math.max(...forest.map(depth));
}
