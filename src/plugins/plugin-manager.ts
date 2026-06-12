// ============================================================================
// Peripheral Agentic OS — Plugin System & Marketplace
// Plugin loader, skill registry, agent import/export
// ============================================================================

import { v4 as uuid } from 'uuid';
import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';

// ── Types ─────────────────────────────────────────────────────────────────

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  type: 'topology' | 'judge' | 'router' | 'tool' | 'agent-template' | 'skill';
  entryPoint: string;
  dependencies: string[];
  config: Record<string, unknown>;
  status: 'installed' | 'active' | 'disabled' | 'error';
  installedAt: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  handler: (input: unknown) => Promise<unknown>;
  version: string;
  author: string;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  roleName: string;
  systemPrompt: string;
  tier: string;
  capabilities: string[];
  defaultModel: string;
  tags: string[];
}

export interface MarketplaceEntry {
  id: string;
  name: string;
  type: string;
  description: string;
  author: string;
  version: string;
  stars: number;
  downloads: number;
  verified: boolean;
  publishedAt: string;
}

// ── Plugin Manager ────────────────────────────────────────────────────────

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private skills: Map<string, Skill> = new Map();
  private templates: Map<string, AgentTemplate> = new Map();

  constructor() {
    this.loadInstalledPlugins();
    this.registerBuiltinSkills();
    this.registerBuiltinTemplates();
    eventBus.emit('plugins:init', {
      plugins: this.plugins.size,
      skills: this.skills.size,
      templates: this.templates.size,
    }, 'PluginManager');
  }

  // ── Plugin CRUD ─────────────────────────────────────────────────────────

  installPlugin(manifest: Omit<Plugin, 'id' | 'status' | 'installedAt'>): Plugin {
    const plugin: Plugin = {
      ...manifest,
      id: uuid(),
      status: 'installed',
      installedAt: new Date().toISOString(),
    };
    this.plugins.set(plugin.id, plugin);

    const db = getDatabase().getDb();
    db.prepare(`INSERT INTO plugins (id, name, type, version, author, status, config, installed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      plugin.id, plugin.name, plugin.type, plugin.version, plugin.author,
      plugin.status, JSON.stringify(plugin.config), plugin.installedAt,
    );

    eventBus.emit('plugins:installed', { id: plugin.id, name: plugin.name }, 'PluginManager');
    return plugin;
  }

  activatePlugin(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    plugin.status = 'active';
    getDatabase().getDb().prepare('UPDATE plugins SET status = ? WHERE id = ?').run('active', id);
    eventBus.emit('plugins:activated', { id, name: plugin.name }, 'PluginManager');
    return true;
  }

  disablePlugin(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    plugin.status = 'disabled';
    getDatabase().getDb().prepare('UPDATE plugins SET status = ? WHERE id = ?').run('disabled', id);
    return true;
  }

  uninstallPlugin(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    this.plugins.delete(id);
    getDatabase().getDb().prepare('DELETE FROM plugins WHERE id = ?').run(id);
    eventBus.emit('plugins:uninstalled', { id, name: plugin.name }, 'PluginManager');
    return true;
  }

  getPlugins(): Plugin[] { return [...this.plugins.values()]; }
  getPlugin(id: string): Plugin | undefined { return this.plugins.get(id); }

  // ── Skill Registry ──────────────────────────────────────────────────────

  registerSkill(skill: Skill): void {
    this.skills.set(skill.id, skill);
    getDatabase().getDb().prepare(`INSERT OR REPLACE INTO skills (id, name, category, description, version, author)
                                   VALUES (?, ?, ?, ?, ?, ?)`).run(
      skill.id, skill.name, skill.category, skill.description, skill.version, skill.author,
    );
  }

  getSkill(id: string): Skill | undefined { return this.skills.get(id); }
  getSkills(): Skill[] { return [...this.skills.values()]; }

  async executeSkill(id: string, input: unknown): Promise<unknown> {
    const skill = this.skills.get(id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    eventBus.emit('plugins:skill_executed', { skillId: id }, 'PluginManager');
    return skill.handler(input);
  }

  // ── Agent Templates ─────────────────────────────────────────────────────

  registerTemplate(template: AgentTemplate): void { this.templates.set(template.id, template); }
  getTemplate(id: string): AgentTemplate | undefined { return this.templates.get(id); }
  getTemplates(): AgentTemplate[] { return [...this.templates.values()]; }

  exportAgent(agentId: string): string {
    const db = getDatabase().getDb();
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return JSON.stringify(agent, null, 2);
  }

  importAgent(json: string): string {
    const data = JSON.parse(json);
    const id = uuid();
    const db = getDatabase().getDb();
    db.prepare(`INSERT INTO imported_agents_v2 (id, name, data, imported_at) VALUES (?, ?, ?, ?)`).run(
      id, data.name || 'imported', json, new Date().toISOString(),
    );
    eventBus.emit('plugins:agent_imported', { id, name: data.name }, 'PluginManager');
    return id;
  }

  // ── Marketplace ─────────────────────────────────────────────────────────

  publishToMarketplace(entry: Omit<MarketplaceEntry, 'id' | 'stars' | 'downloads' | 'publishedAt'>): MarketplaceEntry {
    const full: MarketplaceEntry = { ...entry, id: uuid(), stars: 0, downloads: 0, publishedAt: new Date().toISOString() };
    getDatabase().getDb().prepare(`INSERT INTO marketplace_entries (id, name, type, description, author, version, stars, downloads, verified, published_at)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      full.id, full.name, full.type, full.description, full.author, full.version,
      full.stars, full.downloads, full.verified ? 1 : 0, full.publishedAt,
    );
    return full;
  }

  searchMarketplace(query: string): MarketplaceEntry[] {
    const db = getDatabase().getDb();
    return db.prepare(`SELECT * FROM marketplace_entries WHERE name LIKE ? OR description LIKE ? ORDER BY stars DESC LIMIT 50`).all(`%${query}%`, `%${query}%`) as MarketplaceEntry[];
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private loadInstalledPlugins(): void {
    const db = getDatabase().getDb();
    const rows = db.prepare('SELECT * FROM plugins').all() as any[];
    for (const row of rows) {
      this.plugins.set(row.id, {
        id: row.id, name: row.name, version: row.version, description: '',
        author: row.author, type: row.type, entryPoint: '', dependencies: [],
        config: JSON.parse(row.config || '{}'), status: row.status, installedAt: row.installed_at,
      });
    }
  }

  private registerBuiltinSkills(): void {
    const builtins: Omit<Skill, 'handler'>[] = [
      { id: 'summarize', name: 'Summarize Text', description: 'Summarize long text to key points', category: 'nlp', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, outputSchema: { type: 'string' }, version: '1.0.0', author: 'paos' },
      { id: 'translate', name: 'Translate Text', description: 'Translate between languages', category: 'nlp', inputSchema: { type: 'object', properties: { text: { type: 'string' }, target: { type: 'string' } } }, outputSchema: { type: 'string' }, version: '1.0.0', author: 'paos' },
      { id: 'code-review', name: 'Code Review', description: 'Review code for bugs and improvements', category: 'development', inputSchema: { type: 'object', properties: { code: { type: 'string' }, language: { type: 'string' } } }, outputSchema: { type: 'string' }, version: '1.0.0', author: 'paos' },
      { id: 'data-analysis', name: 'Data Analysis', description: 'Analyze structured data', category: 'analytics', inputSchema: { type: 'object', properties: { data: { type: 'string' } } }, outputSchema: { type: 'string' }, version: '1.0.0', author: 'paos' },
    ];
    for (const s of builtins) {
      this.registerSkill({ ...s, handler: async (input) => ({ result: `Skill ${s.id} executed`, input }) });
    }
  }

  private registerBuiltinTemplates(): void {
    const templates: AgentTemplate[] = [
      { id: 'researcher', name: 'Researcher', description: 'Deep research and fact-finding agent', roleName: 'researcher', systemPrompt: 'You are a meticulous researcher...', tier: 'premium', capabilities: ['search', 'analyze', 'synthesize'], defaultModel: 'gpt-4o', tags: ['research'] },
      { id: 'coder', name: 'Software Engineer', description: 'Code generation and review agent', roleName: 'developer', systemPrompt: 'You are an expert software engineer...', tier: 'premium', capabilities: ['code', 'debug', 'test'], defaultModel: 'claude-3.5-sonnet', tags: ['code'] },
      { id: 'analyst', name: 'Data Analyst', description: 'Data analysis and visualization agent', roleName: 'analyst', systemPrompt: 'You are a data analysis expert...', tier: 'standard', capabilities: ['analyze', 'visualize', 'report'], defaultModel: 'gpt-4o-mini', tags: ['data'] },
      { id: 'writer', name: 'Content Writer', description: 'Professional content creation agent', roleName: 'writer', systemPrompt: 'You are a professional writer...', tier: 'standard', capabilities: ['write', 'edit', 'proofread'], defaultModel: 'claude-3.5-sonnet', tags: ['writing'] },
      { id: 'critic', name: 'Quality Critic', description: 'Critical evaluation agent', roleName: 'critic', systemPrompt: 'You are a demanding quality critic...', tier: 'premium', capabilities: ['evaluate', 'critique', 'score'], defaultModel: 'gpt-4o', tags: ['quality'] },
      { id: 'manager', name: 'Project Manager', description: 'Task decomposition and coordination agent', roleName: 'manager', systemPrompt: 'You are an experienced project manager...', tier: 'premium', capabilities: ['plan', 'delegate', 'coordinate'], defaultModel: 'gpt-4o', tags: ['management'] },
    ];
    for (const t of templates) this.registerTemplate(t);
  }
}
