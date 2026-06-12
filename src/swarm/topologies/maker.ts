// ============================================================================
// Peripheral Agentic OS — Maker Topology (Democratic Voting)
// ============================================================================

import type { TopologyContext, TopologyResult, MakerVote } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * Maker topology: Proposer generates → voters evaluate with majority approval.
 * Inspired by democratic decision-making.
 * Proposals iterate until configurable majority threshold (default 66%).
 */
export async function executeMaker(
  agents: ForgeAgentDef[],
  prompt: string,
  ctx: TopologyContext,
  majorityThreshold = 0.66
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};

  if (agents.length < 2) {
    throw new Error('Maker topology requires at least 2 agents (1 proposer + 1 voter)');
  }

  const proposer = agents[0];
  const voters = agents.slice(1);
  let round = 0;
  let approved = false;
  let currentProposal = '';
  let allVotes: MakerVote[] = [];

  // Initial proposal
  currentProposal = await ctx.executeAgent(proposer.name, prompt, proposer.systemPrompt);
  agentOutputs[`${proposer.name}_r0`] = currentProposal;

  while (round < ctx.maxRounds && !approved) {
    round++;

    // Voters evaluate
    const voteResults = await Promise.allSettled(
      voters.map(async (voter) => {
        const votePrompt = `You are a voter. Evaluate this proposal and respond with EXACTLY this JSON format: {"approved": true/false, "feedback": "your feedback"}\n\nOriginal task: ${prompt}\n\nProposal (round ${round}):\n${currentProposal}`;

        const response = await ctx.executeAgent(voter.name, votePrompt, voter.systemPrompt);

        let vote: MakerVote;
        try {
          const parsed = JSON.parse(response);
          vote = {
            voterId: voter.name,
            approved: !!parsed.approved,
            feedback: parsed.feedback || response,
          };
        } catch {
          // If not valid JSON, interpret text
          const isApproval = response.toLowerCase().includes('approved') ||
                            response.toLowerCase().includes('approve') ||
                            response.toLowerCase().includes('yes');
          vote = {
            voterId: voter.name,
            approved: isApproval,
            feedback: response,
          };
        }

        return vote;
      })
    );

    allVotes = voteResults
      .filter((r): r is PromiseFulfilledResult<MakerVote> => r.status === 'fulfilled')
      .map(r => r.value);

    const approvalRate = allVotes.filter(v => v.approved).length / Math.max(voters.length, 1);
    agentOutputs[`votes_r${round}`] = JSON.stringify(allVotes);

    if (approvalRate >= majorityThreshold) {
      approved = true;
      break;
    }

    // Collect rejection feedback
    const rejectionFeedback = allVotes
      .filter(v => !v.approved)
      .map(v => `${v.voterId}: ${v.feedback}`)
      .join('\n');

    // Proposer revises
    const revisionPrompt = `Your proposal was not approved (${(approvalRate * 100).toFixed(0)}% approval, need ${(majorityThreshold * 100).toFixed(0)}%). Revise based on feedback.\n\nOriginal task: ${prompt}\n\nYour proposal:\n${currentProposal}\n\nRejection feedback:\n${rejectionFeedback}`;

    currentProposal = await ctx.executeAgent(proposer.name, revisionPrompt, proposer.systemPrompt);
    agentOutputs[`${proposer.name}_r${round}`] = currentProposal;
  }

  return {
    topologyType: 'maker',
    finalOutput: currentProposal,
    agentOutputs,
    rounds: round,
    totalMessages: round * (voters.length + 1),
    convergenceReason: approved ? 'Vote passed (≥66%)' : 'Max rounds reached',
    durationMs: Date.now() - start,
  };
}
