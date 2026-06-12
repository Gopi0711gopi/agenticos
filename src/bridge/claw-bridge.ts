// ============================================================================
// Peripheral Agentic OS — Claw Bridge: Unified Protocol Bridge
// Manages MCP + A2A connections and routes between external agents
// ============================================================================

import { v4 as uuid } from 'uuid';
import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';
import { MCPServer } from './mcp-server.js';
import { A2AServer } from './a2a-server.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { BridgeConnection } from '../types/bridge.js';

export class ClawBridge {
  readonly mcp: MCPServer;
  readonly a2a: A2AServer;
  private connections: Map<string, BridgeConnection> = new Map();

  constructor(orchestrator: Orchestrator) {
    this.mcp = new MCPServer(orchestrator);
    this.a2a = new A2AServer(orchestrator);

    eventBus.emit('bridge:claw_init', {
      mcpTools: this.mcp.getToolCount(),
      mcpResources: this.mcp.getResourceCount(),
      a2aSkills: 4,
    }, 'ClawBridge');
  }

  // ── Connection Management ───────────────────────────────────────────────

  registerConnection(protocol: 'mcp' | 'a2a', direction: 'inbound' | 'outbound', endpoint: string): BridgeConnection {
    const conn: BridgeConnection = {
      id: uuid(),
      protocol, direction, endpoint,
      status: 'connected',
      connectedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      messagesExchanged: 0,
    };
    this.connections.set(conn.id, conn);

    const db = getDatabase().getDb();
    db.prepare(`INSERT INTO bridge_connections (id, protocol, direction, status, endpoint, connected_at, last_activity)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      conn.id, conn.protocol, conn.direction, conn.status, conn.endpoint, conn.connectedAt, conn.lastActivity
    );

    eventBus.emit('bridge:connection_registered', { id: conn.id, protocol, direction }, 'ClawBridge');
    return conn;
  }

  disconnectConnection(id: string): boolean {
    const conn = this.connections.get(id);
    if (!conn) return false;
    conn.status = 'disconnected';
    conn.lastActivity = new Date().toISOString();
    const db = getDatabase().getDb();
    db.prepare('UPDATE bridge_connections SET status = ?, last_activity = ? WHERE id = ?').run('disconnected', conn.lastActivity, id);
    return true;
  }

  getConnections(): BridgeConnection[] { return [...this.connections.values()]; }

  getStats(): { mcpTools: number; mcpResources: number; mcpPrompts: number; a2aSkills: number; connections: number } {
    return {
      mcpTools: this.mcp.getToolCount(),
      mcpResources: this.mcp.getResourceCount(),
      mcpPrompts: this.mcp.getPromptCount(),
      a2aSkills: this.a2a.getAgentCard().skills.length,
      connections: this.connections.size,
    };
  }
}
