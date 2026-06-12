// ============================================================================
// Peripheral Agentic OS — Debate Topology (Proposer-Critic Rounds)
// ============================================================================

import type { TopologyContext, TopologyResult } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * Debate topology: Proposer-critic rounds with "CONSENSUS" check.
 * Agents alternate between proposing and critiquing until consensus or max rounds.
 */
export async function executeDebate(
  agents: ForgeAgentDef[],
  prompt: string,
  ctx: TopologyContext
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};
  let round = 0;
  let consensusReached = false;
  let currentProposal = '';

  // First agent is primary proposer
  const proposer = agents[0];
  const critics = agents.slice(1);

  // Initial proposal
  currentProposal = await ctx.executeAgent(proposer.name, prompt, proposer.systemPrompt);
  agentOutputs[`${proposer.name}_r0`] = currentProposal;

  while (round < ctx.maxRounds && !consensusReached) {
    round++;

    // Critics evaluate the proposal
    const critiques: string[] = [];
    for (const critic of critics) {
      const critiquePrompt = `Review this proposal and provide feedback. If it is satisfactory, include the word "CONSENSUS" in your response.\n\nOriginal task: ${prompt}\n\nProposal:\n${currentProposal}`;
      const critique = await ctx.executeAgent(critic.name, critiquePrompt, critic.systemPrompt);
      agentOutputs[`${critic.name}_r${round}`] = critique;
      critiques.push(`${critic.name}: ${critique}`);
      ctx.sendMessage(critic.name, proposer.name, critique);

      // Check for consensus
      if (critique.toUpperCase().includes('CONSENSUS')) {
        consensusReached = true;
      }
    }

    if (consensusReached) break;

    // Proposer revises based on critique
    const revisionPrompt = `Revise your proposal based on this feedback.\n\nOriginal task: ${prompt}\n\nYour previous proposal:\n${currentProposal}\n\nFeedback:\n${critiques.join('\n\n')}`;
    currentProposal = await ctx.executeAgent(proposer.name, revisionPrompt, proposer.systemPrompt);
    agentOutputs[`${proposer.name}_r${round}`] = currentProposal;
  }

  return {
    topologyType: 'debate',
    finalOutput: currentProposal,
    agentOutputs,
    rounds: round,
    totalMessages: round * (critics.length + 1),
    convergenceReason: consensusReached ? 'Consensus reached' : 'Max rounds reached',
    durationMs: Date.now() - start,
  };
}
