// ============================================================================
// Peripheral Agentic OS — Forge: LLM-Driven Team Design (~528 lines)
// ============================================================================

import { v4 as uuid } from 'uuid';
import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { IForge, IRLTrainer } from '../core/orchestrator.js';
import type { TeamDesign, ForgeAgentDef, ForgeConfig, ForgeDesignRecord, RedesignRequest } from '../types/forge.js';
import type { TaskType } from '../types/task.js';
import type { TopologyType } from '../types/topology.js';

/** Model call function type */
type ModelCallFn = (prompt: string, systemPrompt: string) => Promise<string>;

/**
 * Forge: Automatic team composition engine.
 * Uses an LLM to compose multi-agent teams from natural language descriptions.
 * Implements Algorithm 1 from the paper.
 */
export class Forge implements IForge {
  private modelCall: ModelCallFn;
  private rlTrainer?: IRLTrainer;
  private config: ForgeConfig;

  constructor(modelCall: ModelCallFn, config?: Partial<ForgeConfig>) {
    this.modelCall = modelCall;
    this.config = {
      maxRedesigns: config?.maxRedesigns ?? 5,
      designQualityThreshold: config?.designQualityThreshold ?? 0.7,
      defaultTopology: config?.defaultTopology ?? 'sequential',
      forceTopology: config?.forceTopology,
      availableTools: config?.availableTools ?? ['web_search', 'code_exec', 'file_read', 'file_write', 'calculator', 'image_gen'],
      availableModels: config?.availableModels ?? [],
      budget: config?.budget ?? 1.0,
    };
  }

  setRLTrainer(trainer: IRLTrainer): void {
    this.rlTrainer = trainer;
  }

  /**
   * Design a team for a task (Algorithm 1).
   */
  async design(prompt: string, taskType: TaskType, budget: number): Promise<TeamDesign> {
    eventBus.emit('forge:design_started', { taskType, budget }, 'Forge');

    try {
      // Step 1: Get RL recommendation
      const rec = this.rlTrainer?.getRecommendation(taskType);
      if (rec) {
        eventBus.emit('forge:topology_selected', { topology: rec.topology, source: 'rl', confidence: rec.confidence }, 'Forge');
      }

      // Step 2: Check design library
      const libDesign = this.getLibraryDesign(taskType);
      if (libDesign) {
        eventBus.emit('forge:library_hit', { taskType, designId: libDesign.id }, 'Forge');
        // Adapt proven design
        const adapted = await this.adaptDesign(libDesign, prompt, budget);
        await this.persistDesign(adapted, taskType, prompt);
        eventBus.emit('forge:design_completed', { designId: adapted.id, topology: adapted.topology }, 'Forge');
        return adapted;
      }

      eventBus.emit('forge:library_miss', { taskType }, 'Forge');

      // Step 3: Generate new design via LLM
      const design = await this.generateDesign(prompt, taskType, budget, rec?.topology as TopologyType);
      await this.persistDesign(design, taskType, prompt);

      eventBus.emit('forge:design_completed', { designId: design.id, topology: design.topology, agents: design.agents.length }, 'Forge');
      return design;

    } catch (error) {
      eventBus.emit('forge:design_failed', { taskType, error: String(error) }, 'Forge');
      // Fallback to simple sequential
      return this.buildFallbackDesign(taskType, prompt);
    }
  }

  /**
   * Redesign after judge rejection.
   */
  async redesign(previousDesign: TeamDesign, feedback: string, count: number): Promise<TeamDesign> {
    eventBus.emit('forge:redesign_started', { count, previousTopology: previousDesign.topology }, 'Forge');

    let design: TeamDesign;

    if (count < 3) {
      // Refinement: same topology, adjusted roles
      design = await this.refineDesign(previousDesign, feedback);
    } else {
      // Radical redesign: different topology
      design = await this.radicalRedesign(previousDesign, feedback, count);
    }

    await this.persistDesign(design, previousDesign.taskType, '', feedback, previousDesign.id);

    eventBus.emit('forge:redesign_completed', { designId: design.id, topology: design.topology, count }, 'Forge');
    return design;
  }

  // ==================== Private Methods ====================

  private async generateDesign(
    prompt: string, taskType: TaskType, budget: number, suggestedTopology?: TopologyType
  ): Promise<TeamDesign> {
    const systemPrompt = `You are a team design engine. Given a task, create a team of AI agents to solve it.

Output ONLY valid JSON with this structure:
{
  "topology": "sequential|parallel|hierarchical|dag|mixture|debate|mesh|star|circular|grid|forest|maker",
  "agents": [
    {
      "name": "agent_name",
      "role": "role_title",
      "description": "what this agent does",
      "systemPrompt": "detailed instructions for the agent",
      "tools": ["tool1", "tool2"],
      "order": 0
    }
  ]
}

Available topologies: sequential, parallel, hierarchical, dag, mixture, debate, mesh, star, circular, grid, forest, maker.
Available tools: ${this.config.availableTools.join(', ')}.
Budget: $${budget} — use fewer agents for lower budgets.
Task type: ${taskType}
${suggestedTopology ? `Suggested topology (from historical data): ${suggestedTopology}` : ''}`;

    const response = await this.modelCall(
      `Design an optimal agent team for this task:\n\n${prompt}`,
      systemPrompt
    );

    try {
      const parsed = JSON.parse(this.extractJSON(response));
      return {
        id: uuid(),
        taskType,
        topology: this.config.forceTopology || parsed.topology || this.config.defaultTopology,
        agents: (parsed.agents || []).map((a: ForgeAgentDef, i: number) => ({
          name: a.name || `agent_${i}`,
          role: a.role || 'Worker',
          description: a.description || '',
          systemPrompt: a.systemPrompt || 'Complete the assigned task.',
          tools: a.tools || [],
          order: a.order ?? i,
        })),
        toolMappings: {},
        modelMappings: {},
        metadata: {},
        createdAt: new Date().toISOString(),
      };
    } catch {
      return this.buildFallbackDesign(taskType, prompt);
    }
  }

  private async adaptDesign(library: TeamDesign, prompt: string, budget: number): Promise<TeamDesign> {
    // Clone and assign new ID
    return {
      ...library,
      id: uuid(),
      metadata: { ...library.metadata, adaptedFrom: library.id },
      createdAt: new Date().toISOString(),
    };
  }

  private async refineDesign(previous: TeamDesign, feedback: string): Promise<TeamDesign> {
    const systemPrompt = `You are refining a team design based on judge feedback. Keep the same topology (${previous.topology}) but adjust agent roles and prompts.

Output ONLY valid JSON with the same structure as the input but with improved agent definitions.

Previous design: ${JSON.stringify(previous.agents, null, 2)}
Judge feedback: ${feedback}`;

    const response = await this.modelCall(
      `Refine this team design:\n${feedback}`,
      systemPrompt
    );

    try {
      const parsed = JSON.parse(this.extractJSON(response));
      return {
        ...previous,
        id: uuid(),
        agents: parsed.agents || previous.agents,
        metadata: { ...previous.metadata, refinedFrom: previous.id },
        createdAt: new Date().toISOString(),
      };
    } catch {
      return { ...previous, id: uuid(), createdAt: new Date().toISOString() };
    }
  }

  private async radicalRedesign(previous: TeamDesign, feedback: string, count: number): Promise<TeamDesign> {
    // Get failed topologies to avoid repeating
    const db = getDatabase().getDb();
    const failedTopologies = db.prepare(
      "SELECT DISTINCT topology FROM forge_designs WHERE verdict = 'rejected' AND task_type = ? LIMIT 10"
    ).all(previous.taskType) as { topology: string }[];

    const avoid = failedTopologies.map(r => r.topology);
    const allTopologies: TopologyType[] = ['sequential', 'parallel', 'hierarchical', 'dag', 'mixture', 'debate', 'mesh', 'star', 'circular', 'grid', 'forest', 'maker'];
    const candidates = allTopologies.filter(t => !avoid.includes(t) && t !== previous.topology);
    const newTopology = candidates[count % candidates.length] || 'debate';

    return this.generateDesign(previous.metadata.originalPrompt as string || '', previous.taskType, this.config.budget, newTopology);
  }

  private getLibraryDesign(taskType: TaskType): TeamDesign | null {
    const db = getDatabase().getDb();
    const row = db.prepare(
      "SELECT design_json FROM forge_designs WHERE task_type = ? AND verdict = 'approved' AND score >= ? ORDER BY score DESC LIMIT 1"
    ).get(taskType, this.config.designQualityThreshold) as { design_json: string } | undefined;

    if (!row) return null;
    try {
      return JSON.parse(row.design_json);
    } catch {
      return null;
    }
  }

  private async persistDesign(design: TeamDesign, taskType: TaskType, prompt: string, feedback?: string, redesignOf?: string): Promise<void> {
    const db = getDatabase().getDb();
    db.prepare(`
      INSERT INTO forge_designs (id, task_type, task_prompt, topology, design_json, redesign_of)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(design.id, taskType, prompt, design.topology, JSON.stringify(design), redesignOf);
  }

  private buildFallbackDesign(taskType: TaskType, prompt: string): TeamDesign {
    const agents: ForgeAgentDef[] = [
      {
        name: 'analyst',
        role: 'Task Analyst',
        description: 'Analyzes the task requirements',
        systemPrompt: `You are a task analyst. Analyze the task and provide a comprehensive solution.\n\nTask type: ${taskType}`,
        tools: [],
        order: 0,
      },
      {
        name: 'executor',
        role: 'Task Executor',
        description: 'Executes based on analysis',
        systemPrompt: 'You are a task executor. Take the analysis and produce the final output.',
        tools: [],
        order: 1,
      },
    ];

    return {
      id: uuid(),
      taskType,
      topology: 'sequential',
      agents,
      toolMappings: {},
      modelMappings: {},
      metadata: { fallback: true, originalPrompt: prompt },
      createdAt: new Date().toISOString(),
    };
  }

  private extractJSON(text: string): string {
    // Try to extract JSON from markdown code blocks or raw text
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) return jsonMatch[1].trim();

    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) return braceMatch[0];

    return text;
  }
}
