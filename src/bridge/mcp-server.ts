// ============================================================================
// Peripheral Agentic OS — Claw Bridge: MCP Server
// Exposes PAOS capabilities to external agents via Model Context Protocol
// ============================================================================

import { v4 as uuid } from 'uuid';
import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type {
  MCPTool, MCPToolResult, MCPResource, MCPPrompt, MCPServerConfig
} from '../types/bridge.js';

export class MCPServer {
  private tools: Map<string, MCPTool> = new Map();
  private resources: Map<string, MCPResource> = new Map();
  private prompts: Map<string, MCPPrompt> = new Map();
  private config: MCPServerConfig;

  constructor(private orchestrator: Orchestrator) {
    this.config = {
      name: 'peripheral-agentic-os',
      version: '2.0.0',
      transport: 'stdio',
      capabilities: { tools: true, resources: true, prompts: true },
    };
    this.registerBuiltinTools();
    this.registerBuiltinResources();
    this.registerBuiltinPrompts();
    eventBus.emit('bridge:mcp_server_init', { tools: this.tools.size, resources: this.resources.size }, 'MCPServer');
  }

  // ── Built-in Tools ──────────────────────────────────────────────────────

  private registerBuiltinTools(): void {
    this.registerTool({
      name: 'run_task',
      description: 'Execute an AI task through the PAOS orchestration pipeline',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Task description' },
          budget: { type: 'number', description: 'Maximum budget in USD' },
          topology: { type: 'string', description: 'Force a specific topology' },
          taskType: { type: 'string', description: 'Task type hint' },
        },
        required: ['prompt'],
      },
      handler: async (params) => {
        const result = await this.orchestrator.run(
          params.prompt as string,
          { budget: (params.budget as number) || 1.0, taskType: params.taskType as any, forceTopology: params.topology as string }
        );
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      },
    });

    this.registerTool({
      name: 'get_status',
      description: 'Get current PAOS system status',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const db = getDatabase().getDb();
        const taskCount = (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as any).c;
        const agentCount = (db.prepare('SELECT COUNT(*) as c FROM agents').get() as any).c;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'healthy', version: '2.0.0', mode: 'power',
              tasks: taskCount, agents: agentCount,
              events: eventBus.logSize, uptime: process.uptime(),
            }, null, 2),
          }],
        };
      },
    });

    this.registerTool({
      name: 'list_agents',
      description: 'List all registered agents in the system',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const db = getDatabase().getDb();
        const agents = db.prepare('SELECT id, name, role_name, state, tier FROM agents').all();
        return { content: [{ type: 'text', text: JSON.stringify(agents, null, 2) }] };
      },
    });

    this.registerTool({
      name: 'list_tasks',
      description: 'List recent tasks with their status',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max results', default: 20 } },
      },
      handler: async (params) => {
        const db = getDatabase().getDb();
        const tasks = db.prepare('SELECT id, type, status, budget, spent, created_at FROM tasks ORDER BY created_at DESC LIMIT ?').all((params.limit as number) || 20);
        return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
      },
    });

    this.registerTool({
      name: 'query_quality',
      description: 'Get quality assurance metrics (Goodhart, drift, contracts)',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const db = getDatabase().getDb();
        const goodhart = (db.prepare('SELECT COUNT(*) as c FROM goodhart_signals').get() as any).c;
        const drift = (db.prepare('SELECT COUNT(*) as c FROM drift_snapshots').get() as any).c;
        const violations = (db.prepare('SELECT COUNT(*) as c FROM contract_violations').get() as any).c;
        return {
          content: [{ type: 'text', text: JSON.stringify({ goodhartAlerts: goodhart, driftEvents: drift, contractViolations: violations }, null, 2) }],
        };
      },
    });

    this.registerTool({
      name: 'search_memory',
      description: 'Search episodic memory using full-text search',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
      },
      handler: async (params) => {
        const db = getDatabase().getDb();
        const results = db.prepare(
          `SELECT em.* FROM episodic_memories em
           JOIN episodic_memories_fts fts ON em.id = fts.rowid
           WHERE fts MATCH ? LIMIT 10`
        ).all(params.query as string);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      },
    });

    this.registerTool({
      name: 'get_events',
      description: 'Get recent system events',
      inputSchema: {
        type: 'object',
        properties: { count: { type: 'number', default: 20 } },
      },
      handler: async (params) => {
        const events = eventBus.getRecentEvents((params.count as number) || 20);
        return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] };
      },
    });

    this.registerTool({
      name: 'steer_task',
      description: 'Pause, resume, or cancel a running task',
      inputSchema: {
        type: 'object',
        properties: {
          taskId: { type: 'string' },
          action: { type: 'string', enum: ['pause', 'resume', 'cancel'] },
        },
        required: ['taskId', 'action'],
      },
      handler: async (params) => {
        try {
          this.orchestrator.getSteering().apply({
            taskId: params.taskId as string,
            action: params.action as 'pause' | 'resume' | 'cancel',
            reason: 'MCP tool call',
            timestamp: new Date().toISOString(),
          });
          return { content: [{ type: 'text', text: `Task ${params.taskId} ${params.action}d` }] };
        } catch {
          return { content: [{ type: 'text', text: `Error: Task ${params.taskId} not found` }], isError: true };
        }
      },
    });
  }

  // ── Built-in Resources ──────────────────────────────────────────────────

  private registerBuiltinResources(): void {
    this.registerResource({
      uri: 'paos://system/config',
      name: 'System Configuration',
      description: 'Current PAOS system configuration',
      mimeType: 'application/json',
      handler: async () => JSON.stringify({ name: 'Peripheral Agentic OS', version: '2.0.0', mode: 'power' }),
    });

    this.registerResource({
      uri: 'paos://system/topologies',
      name: 'Available Topologies',
      description: 'All 12 multi-agent execution topologies',
      mimeType: 'application/json',
      handler: async () => JSON.stringify([
        'sequential','parallel','hierarchical','dag','mixture','debate',
        'mesh','star','circular','grid','forest','maker',
      ]),
    });

    this.registerResource({
      uri: 'paos://quality/dashboard',
      name: 'Quality Dashboard',
      description: 'Current quality metrics',
      mimeType: 'application/json',
      handler: async () => {
        const db = getDatabase().getDb();
        return JSON.stringify({
          goodhart: (db.prepare('SELECT COUNT(*) as c FROM goodhart_signals').get() as any).c,
          drift: (db.prepare('SELECT COUNT(*) as c FROM drift_snapshots').get() as any).c,
          contracts: (db.prepare('SELECT COUNT(*) as c FROM contract_violations').get() as any).c,
        });
      },
    });
  }

  // ── Built-in Prompts ────────────────────────────────────────────────────

  private registerBuiltinPrompts(): void {
    this.registerPrompt({
      name: 'orchestrate_task',
      description: 'Generate a structured task prompt for PAOS orchestration',
      arguments: [
        { name: 'goal', description: 'What you want to accomplish', required: true },
        { name: 'constraints', description: 'Budget, time, quality constraints', required: false },
      ],
      handler: async (args) => [{
        role: 'user',
        content: `Execute the following task through PAOS orchestration:\n\nGoal: ${args.goal}\n${args.constraints ? `Constraints: ${args.constraints}\n` : ''}Please use the run_task tool to execute this.`,
      }],
    });
  }

  // ── Registration API ────────────────────────────────────────────────────

  registerTool(tool: MCPTool): void { this.tools.set(tool.name, tool); }
  registerResource(resource: MCPResource): void { this.resources.set(resource.uri, resource); }
  registerPrompt(prompt: MCPPrompt): void { this.prompts.set(prompt.name, prompt); }

  // ── Protocol Handlers ───────────────────────────────────────────────────

  async handleRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2024-11-05',
          capabilities: this.config.capabilities,
          serverInfo: { name: this.config.name, version: this.config.version },
        };

      case 'tools/list':
        return {
          tools: [...this.tools.values()].map(t => ({
            name: t.name, description: t.description, inputSchema: t.inputSchema,
          })),
        };

      case 'tools/call': {
        const tool = this.tools.get(params.name as string);
        if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${params.name}` }], isError: true };
        eventBus.emit('bridge:mcp_tool_call', { tool: params.name }, 'MCPServer');
        return tool.handler((params.arguments as Record<string, unknown>) || {});
      }

      case 'resources/list':
        return { resources: [...this.resources.values()].map(r => ({ uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType })) };

      case 'resources/read': {
        const resource = this.resources.get(params.uri as string);
        if (!resource) return { contents: [] };
        const text = await resource.handler();
        return { contents: [{ uri: params.uri, mimeType: resource.mimeType, text }] };
      }

      case 'prompts/list':
        return { prompts: [...this.prompts.values()].map(p => ({ name: p.name, description: p.description, arguments: p.arguments })) };

      case 'prompts/get': {
        const prompt = this.prompts.get(params.name as string);
        if (!prompt) return { messages: [] };
        return { messages: await prompt.handler((params.arguments as Record<string, string>) || {}) };
      }

      default:
        return { error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }

  getToolCount(): number { return this.tools.size; }
  getResourceCount(): number { return this.resources.size; }
  getPromptCount(): number { return this.prompts.size; }

  // ── STDIO Transport ─────────────────────────────────────────────────────

  async startStdio(): Promise<void> {
    process.stdin.setEncoding('utf-8');
    let buffer = '';

    process.stdin.on('data', async (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const request = JSON.parse(line);
          const result = await this.handleRequest(request.method, request.params || {});
          const response = JSON.stringify({ jsonrpc: '2.0', id: request.id, result });
          process.stdout.write(response + '\n');
        } catch (e: any) {
          const err = JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } });
          process.stdout.write(err + '\n');
        }
      }
    });

    eventBus.emit('bridge:mcp_stdio_started', {}, 'MCPServer');
  }
}
