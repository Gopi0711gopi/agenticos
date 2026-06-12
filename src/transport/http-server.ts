// ============================================================================
// Peripheral Agentic OS — HTTP Transport (Hono REST API, 60+ endpoints)
// ============================================================================

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { ClawBridge } from '../bridge/claw-bridge.js';
import type { PluginManager } from '../plugins/plugin-manager.js';
import type { RBACManager } from '../enterprise/rbac.js';

interface ServerExtras { bridge?: ClawBridge; pluginManager?: PluginManager; rbac?: RBACManager }

export function createHttpServer(orchestrator: Orchestrator, port = 3700, extras: ServerExtras = {}) {
  const app = new Hono();

  // Middleware
  app.use('/*', cors({ origin: ['http://localhost:5173', 'http://localhost:3000'] }));

  // Helper to get database
  const db = () => getDatabase().getDb();

  // ===== System Endpoints =====
  app.get('/api/health', (c) => c.json({ status: 'healthy', version: '2.0.0', name: 'Peripheral Agentic OS', uptime: process.uptime() }));
  app.get('/api/status', (c) => c.json({ mode: 'power', events: eventBus.logSize, subscriptions: eventBus.subscriptionCount }));
  app.get('/api/config', (c) => c.json({ systemName: 'Peripheral Agentic OS', version: '2.0.0' }));

  // ===== Task Endpoints =====
  app.post('/api/tasks', async (c) => {
    const body = await c.req.json();
    const result = await orchestrator.run(body.prompt, {
      budget: body.budget, taskType: body.taskType, forceTopology: body.topology,
    });
    return c.json(result);
  });

  app.get('/api/tasks', (c) => {
    const tasks = db().prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50').all();
    return c.json(tasks);
  });

  app.get('/api/tasks/:id', (c) => {
    const task = db().prepare('SELECT * FROM tasks WHERE id = ?').get(c.req.param('id'));
    return task ? c.json(task) : c.json({ error: 'Not found' }, 404);
  });

  app.get('/api/tasks/:id/result', (c) => {
    const result = db().prepare('SELECT * FROM task_results WHERE task_id = ? ORDER BY created_at DESC LIMIT 1').get(c.req.param('id'));
    return result ? c.json(result) : c.json({ error: 'Not found' }, 404);
  });

  // Steering endpoints
  app.post('/api/tasks/:id/pause', (c) => {
    try {
      orchestrator.getSteering().apply({ taskId: c.req.param('id'), action: 'pause', reason: 'User request', timestamp: new Date().toISOString() });
      return c.json({ status: 'paused' });
    } catch { return c.json({ error: 'Task not found' }, 404); }
  });

  app.post('/api/tasks/:id/resume', (c) => {
    try {
      orchestrator.getSteering().apply({ taskId: c.req.param('id'), action: 'resume', reason: 'User request', timestamp: new Date().toISOString() });
      return c.json({ status: 'resumed' });
    } catch { return c.json({ error: 'Task not found' }, 404); }
  });

  app.post('/api/tasks/:id/cancel', (c) => {
    try {
      orchestrator.getSteering().apply({ taskId: c.req.param('id'), action: 'cancel', reason: 'User request', timestamp: new Date().toISOString() });
      return c.json({ status: 'cancelled' });
    } catch { return c.json({ error: 'Task not found' }, 404); }
  });

  // ===== Agent Endpoints =====
  app.get('/api/agents', (c) => {
    return c.json(db().prepare('SELECT * FROM agents ORDER BY created_at DESC LIMIT 100').all());
  });

  // ===== Forge Endpoints =====
  app.get('/api/forge/designs', (c) => {
    return c.json(db().prepare('SELECT * FROM forge_designs ORDER BY created_at DESC LIMIT 50').all());
  });

  // ===== Router Endpoints =====
  app.get('/api/router/catalog', (c) => {
    return c.json(db().prepare('SELECT * FROM model_catalog ORDER BY quality_score DESC').all());
  });

  app.get('/api/router/history', (c) => {
    return c.json(db().prepare('SELECT * FROM routing_history ORDER BY timestamp DESC LIMIT 50').all());
  });

  // ===== Judge Endpoints =====
  app.get('/api/judge/verdicts', (c) => {
    return c.json(db().prepare('SELECT * FROM judge_verdicts ORDER BY timestamp DESC LIMIT 50').all());
  });

  app.get('/api/judge/consensus', (c) => {
    return c.json(db().prepare('SELECT * FROM judge_consensus ORDER BY timestamp DESC LIMIT 50').all());
  });

  // ===== Quality Endpoints =====
  app.get('/api/quality/goodhart', (c) => {
    return c.json(db().prepare('SELECT * FROM goodhart_signals ORDER BY timestamp DESC LIMIT 50').all());
  });

  app.get('/api/quality/drift', (c) => {
    return c.json(db().prepare('SELECT * FROM drift_snapshots ORDER BY timestamp DESC LIMIT 50').all());
  });

  app.get('/api/quality/contracts', (c) => {
    return c.json(db().prepare('SELECT * FROM contract_violations ORDER BY timestamp DESC LIMIT 50').all());
  });

  // ===== Memory Endpoints =====
  app.get('/api/memory/stats', (c) => {
    const episodic = (db().prepare('SELECT COUNT(*) as c FROM episodic_memories').get() as any).c;
    const semantic = (db().prepare('SELECT COUNT(*) as c FROM semantic_memories').get() as any).c;
    const procedural = (db().prepare('SELECT COUNT(*) as c FROM procedural_memories').get() as any).c;
    return c.json({ working: 0, episodic, semantic, procedural });
  });

  // ===== Events Endpoints =====
  app.get('/api/events/recent', (c) => {
    const count = parseInt(c.req.query('count') || '50');
    return c.json(eventBus.getRecentEvents(count));
  });

  app.get('/api/events/counts', (c) => {
    return c.json(eventBus.getEventCounts());
  });

  // ===== Cost Endpoints =====
  app.get('/api/cost/summary', (c) => {
    const total = db().prepare('SELECT COALESCE(SUM(spent), 0) as total FROM tasks').get() as any;
    const taskCount = db().prepare('SELECT COUNT(*) as count FROM tasks').get() as any;
    return c.json({ totalSpent: total.total, taskCount: taskCount.count, avgCostPerTask: taskCount.count > 0 ? total.total / taskCount.count : 0 });
  });

  // ===== Marketplace Endpoints =====
  app.get('/api/marketplace', (c) => {
    return c.json(db().prepare('SELECT * FROM marketplace_entries ORDER BY stars DESC').all());
  });

  // ===== Audit Endpoints =====
  app.get('/api/audit', (c) => {
    return c.json(db().prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 100').all());
  });

  // ===== Trilemma Endpoints =====
  app.get('/api/quality/trilemma', (c) => {
    return c.json(db().prepare('SELECT * FROM trilemma_events ORDER BY timestamp DESC LIMIT 50').all());
  });

  // ===== Workflow Endpoints =====
  app.get('/api/workflows', (c) => {
    return c.json(db().prepare('SELECT * FROM workflows ORDER BY created_at DESC LIMIT 50').all());
  });

  // ===== Teams Endpoints =====
  app.get('/api/teams', (c) => {
    return c.json(db().prepare('SELECT * FROM teams ORDER BY created_at DESC LIMIT 50').all());
  });

  // ===================== Phase 7: Claw Bridge Endpoints =====================

  if (extras.bridge) {
    const bridge = extras.bridge;

    // MCP
    app.get('/api/bridge/stats', (c) => c.json(bridge.getStats()));
    app.get('/api/bridge/connections', (c) => c.json(bridge.getConnections()));
    app.get('/api/bridge/mcp/tools', async (c) => {
      const result = await bridge.mcp.handleRequest('tools/list', {});
      return c.json(result);
    });
    app.get('/api/bridge/mcp/resources', async (c) => {
      const result = await bridge.mcp.handleRequest('resources/list', {});
      return c.json(result);
    });
    app.get('/api/bridge/mcp/prompts', async (c) => {
      const result = await bridge.mcp.handleRequest('prompts/list', {});
      return c.json(result);
    });
    app.post('/api/bridge/mcp/call', async (c) => {
      const body = await c.req.json();
      const result = await bridge.mcp.handleRequest('tools/call', body);
      return c.json(result);
    });

    // A2A
    app.get('/api/bridge/a2a/agent-card', (c) => c.json(bridge.a2a.getAgentCard()));
    app.post('/api/bridge/a2a/tasks/send', async (c) => {
      const body = await c.req.json();
      const result = await bridge.a2a.handleJsonRpc({ id: body.id || '1', method: 'tasks/send', params: body });
      return c.json(result);
    });
    app.get('/api/bridge/a2a/tasks/:id', (c) => {
      const task = bridge.a2a.getTask(c.req.param('id'));
      return task ? c.json(task) : c.json({ error: 'Not found' }, 404);
    });
  }

  // ===================== Phase 8: Plugin Endpoints =====================

  if (extras.pluginManager) {
    const pm = extras.pluginManager;

    app.get('/api/plugins', (c) => c.json(pm.getPlugins()));
    app.post('/api/plugins/install', async (c) => {
      const body = await c.req.json();
      const plugin = pm.installPlugin(body);
      return c.json(plugin, 201);
    });
    app.post('/api/plugins/:id/activate', (c) => {
      return c.json({ success: pm.activatePlugin(c.req.param('id')) });
    });
    app.post('/api/plugins/:id/disable', (c) => {
      return c.json({ success: pm.disablePlugin(c.req.param('id')) });
    });
    app.delete('/api/plugins/:id', (c) => {
      return c.json({ success: pm.uninstallPlugin(c.req.param('id')) });
    });

    // Skills
    app.get('/api/skills', (c) => c.json(pm.getSkills().map(s => ({ id: s.id, name: s.name, category: s.category, description: s.description, version: s.version, author: s.author }))));
    app.post('/api/skills/:id/execute', async (c) => {
      try {
        const body = await c.req.json();
        const result = await pm.executeSkill(c.req.param('id'), body);
        return c.json({ result });
      } catch (e: any) { return c.json({ error: e.message }, 404); }
    });

    // Templates
    app.get('/api/templates', (c) => c.json(pm.getTemplates()));

    // Agent import/export
    app.get('/api/agents/:id/export', (c) => {
      try { return c.json(JSON.parse(pm.exportAgent(c.req.param('id')))); }
      catch { return c.json({ error: 'Agent not found' }, 404); }
    });
    app.post('/api/agents/import', async (c) => {
      const body = await c.req.json();
      const id = pm.importAgent(JSON.stringify(body));
      return c.json({ id }, 201);
    });

    // Marketplace search
    app.get('/api/marketplace/search', (c) => {
      const q = c.req.query('q') || '';
      return c.json(pm.searchMarketplace(q));
    });
    app.post('/api/marketplace/publish', async (c) => {
      const body = await c.req.json();
      const entry = pm.publishToMarketplace(body);
      return c.json(entry, 201);
    });
  }

  // ===================== Phase 9: Enterprise RBAC Endpoints =====================

  if (extras.rbac) {
    const rbac = extras.rbac;

    // Roles
    app.get('/api/rbac/roles', (c) => c.json(rbac.getRoles()));
    app.post('/api/rbac/roles', async (c) => {
      const body = await c.req.json();
      const role = rbac.createCustomRole(body.name, body.description, body.permissions || [], body.tenantId || 'default');
      return c.json(role, 201);
    });

    // Users
    app.post('/api/rbac/users', async (c) => {
      const body = await c.req.json();
      const user = rbac.createUser(body.username, body.email, body.password, body.role, body.tenantId);
      return c.json({ id: user.id, username: user.username, role: user.role, tenantId: user.tenantId }, 201);
    });
    app.post('/api/rbac/login', async (c) => {
      const body = await c.req.json();
      const user = rbac.authenticateUser(body.username, body.password);
      if (!user) return c.json({ error: 'Invalid credentials' }, 401);
      return c.json({ id: user.id, username: user.username, role: user.role, tenantId: user.tenantId });
    });
    app.get('/api/rbac/authorize', (c) => {
      const userId = c.req.query('userId') || '';
      const resource = c.req.query('resource') || '';
      const action = c.req.query('action') || '';
      return c.json({ authorized: rbac.authorize(userId, resource, action) });
    });

    // API Keys
    app.post('/api/rbac/api-keys', async (c) => {
      const body = await c.req.json();
      const result = rbac.generateApiKey(body.userId, body.name, body.permissions);
      return c.json({ keyPrefix: result.apiKey.keyPrefix, key: result.key, id: result.apiKey.id }, 201);
    });
    app.post('/api/rbac/api-keys/validate', async (c) => {
      const body = await c.req.json();
      const apiKey = rbac.validateApiKey(body.key);
      return apiKey ? c.json({ valid: true, userId: apiKey.userId, tenantId: apiKey.tenantId }) : c.json({ valid: false }, 401);
    });

    // Tenants
    app.get('/api/rbac/tenants', (c) => c.json(rbac.getTenants()));
    app.post('/api/rbac/tenants', async (c) => {
      const body = await c.req.json();
      const tenant = rbac.createTenant(body.name, body.slug, body.plan);
      return c.json(tenant, 201);
    });
  }

  // Start server
  const server = serve({ fetch: app.fetch, port });
  console.log(`  ✓ HTTP API listening on http://localhost:${port}`);

  eventBus.emit('transport:http_request', { port }, 'HttpServer');
  return { app, server };
}
