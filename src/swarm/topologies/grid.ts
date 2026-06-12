// ============================================================================
// Peripheral Agentic OS — Grid Topology (2D Cellular Automaton)
// ============================================================================

import type { TopologyContext, TopologyResult, GridCell } from '../../types/topology.js';
import type { ForgeAgentDef } from '../../types/forge.js';

/**
 * Grid topology: 2D matrix with 4-neighbor iterative refinement.
 * Agents refine based on up/down/left/right neighbors (cellular automaton).
 * Converges when no cell changes output between rounds.
 */
export async function executeGrid(
  agents: ForgeAgentDef[],
  prompt: string,
  ctx: TopologyContext,
  dimensions?: { rows: number; cols: number }
): Promise<TopologyResult> {
  const start = Date.now();
  const agentOutputs: Record<string, string> = {};

  // Calculate grid dimensions
  const n = agents.length;
  const rows = dimensions?.rows || Math.ceil(Math.sqrt(n));
  const cols = dimensions?.cols || Math.ceil(n / rows);

  // Create grid
  const grid: GridCell[][] = [];
  let agentIdx = 0;
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols && agentIdx < n; c++) {
      grid[r][c] = {
        row: r,
        col: c,
        agentId: agents[agentIdx].name,
        output: '',
        stable: false,
      };
      agentIdx++;
    }
  }

  // Initial round: all cells respond to prompt
  const initResults = await Promise.allSettled(
    agents.map(agent => ctx.executeAgent(agent.name, prompt, agent.systemPrompt))
  );

  initResults.forEach((result, i) => {
    const agent = agents[i];
    const cell = findCell(grid, agent.name);
    if (cell) {
      cell.output = result.status === 'fulfilled' ? result.value : '';
      agentOutputs[`${agent.name}_r0`] = cell.output;
    }
  });

  // Iterative refinement rounds
  let round = 0;
  let allStable = false;

  while (round < ctx.maxRounds && !allStable) {
    round++;
    allStable = true;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < (grid[r]?.length || 0); c++) {
        const cell = grid[r][c];
        if (!cell) continue;

        const neighbors = getNeighbors(grid, r, c, rows);
        const neighborContext = neighbors
          .map(n => `[${n.row},${n.col}] ${n.agentId}: ${n.output}`)
          .join('\n');

        const refinePrompt = `Refine your response considering your neighbors' outputs. Return unchanged if optimal.\n\nOriginal task: ${prompt}\n\nYour current position: [${r},${c}]\nYour current output: ${cell.output}\n\nNeighbor outputs:\n${neighborContext}`;

        const agent = agents.find(a => a.name === cell.agentId);
        const newOutput = await ctx.executeAgent(cell.agentId, refinePrompt, agent?.systemPrompt);

        if (newOutput !== cell.output) {
          allStable = false;
          cell.stable = false;
        } else {
          cell.stable = true;
        }

        cell.output = newOutput;
        agentOutputs[`${cell.agentId}_r${round}`] = newOutput;
      }
    }
  }

  // Aggregate final outputs
  const finalOutput = grid
    .flat()
    .filter(Boolean)
    .map(cell => `## [${cell.row},${cell.col}] ${cell.agentId}\n${cell.output}`)
    .join('\n\n');

  return {
    topologyType: 'grid',
    finalOutput,
    agentOutputs,
    rounds: round + 1,
    totalMessages: (round + 1) * n * 4,
    convergenceReason: allStable ? 'All cells stable' : 'Max rounds reached',
    durationMs: Date.now() - start,
  };
}

function findCell(grid: GridCell[][], agentId: string): GridCell | undefined {
  for (const row of grid) {
    for (const cell of row) {
      if (cell?.agentId === agentId) return cell;
    }
  }
  return undefined;
}

function getNeighbors(grid: GridCell[][], row: number, col: number, maxRows: number): GridCell[] {
  const neighbors: GridCell[] = [];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]; // up, down, left, right
  for (const [dr, dc] of dirs) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr >= 0 && nr < maxRows && grid[nr] && grid[nr][nc]) {
      neighbors.push(grid[nr][nc]);
    }
  }
  return neighbors;
}
