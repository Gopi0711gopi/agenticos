// ============================================================================
// Peripheral Agentic OS — Enterprise RBAC & Multi-Tenant System
// Role-based access control, tenant isolation, and SSO hooks
// ============================================================================

import { v4 as uuid } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { eventBus } from '../core/event-bus.js';
import { getDatabase } from '../db/database.js';

// ── Types ─────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  role: string;
  tenantId: string;
  status: 'active' | 'suspended' | 'pending';
  createdAt: string;
  lastLoginAt?: string;
  metadata: Record<string, unknown>;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  tenantId: string;
  isSystem: boolean;
}

export interface Permission {
  resource: string;
  actions: ('create' | 'read' | 'update' | 'delete' | 'execute')[];
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'pro' | 'enterprise';
  maxAgents: number;
  maxTasksPerDay: number;
  budgetLimit: number;
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface APIKey {
  id: string;
  userId: string;
  tenantId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  permissions: string[];
  expiresAt?: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface AuditEntry {
  id: string;
  userId: string;
  tenantId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details: string;
  ip?: string;
  timestamp: string;
}

// ── RBAC Manager ──────────────────────────────────────────────────────────

export class RBACManager {
  private roles: Map<string, Role> = new Map();

  constructor() {
    this.ensureTables();
    this.registerSystemRoles();
    this.registerDefaultTenant();
    eventBus.emit('enterprise:rbac_init', { roles: this.roles.size }, 'RBACManager');
  }

  private ensureTables(): void {
    const db = getDatabase().getDb();
    db.prepare(`CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      plan TEXT DEFAULT 'free', max_agents INTEGER DEFAULT 10,
      max_tasks_per_day INTEGER DEFAULT 100, budget_limit REAL DEFAULT 10.0,
      status TEXT DEFAULT 'active', created_at TEXT NOT NULL
    )`).run();

    db.prepare(`CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
      key_hash TEXT NOT NULL, key_prefix TEXT NOT NULL, name TEXT NOT NULL,
      permissions TEXT DEFAULT '[]', expires_at TEXT, created_at TEXT NOT NULL,
      last_used_at TEXT
    )`).run();
  }

  // ── System Roles ────────────────────────────────────────────────────────

  private registerSystemRoles(): void {
    const systemRoles: Role[] = [
      {
        id: 'admin', name: 'Administrator', description: 'Full system access',
        isSystem: true, tenantId: '*',
        permissions: [
          { resource: '*', actions: ['create', 'read', 'update', 'delete', 'execute'] },
        ],
      },
      {
        id: 'operator', name: 'Operator', description: 'Run tasks, manage agents, view quality',
        isSystem: true, tenantId: '*',
        permissions: [
          { resource: 'tasks', actions: ['create', 'read', 'update', 'execute'] },
          { resource: 'agents', actions: ['create', 'read', 'update'] },
          { resource: 'quality', actions: ['read'] },
          { resource: 'events', actions: ['read'] },
          { resource: 'memory', actions: ['read'] },
        ],
      },
      {
        id: 'viewer', name: 'Viewer', description: 'Read-only access to dashboards',
        isSystem: true, tenantId: '*',
        permissions: [
          { resource: 'tasks', actions: ['read'] },
          { resource: 'agents', actions: ['read'] },
          { resource: 'quality', actions: ['read'] },
          { resource: 'events', actions: ['read'] },
          { resource: 'cost', actions: ['read'] },
        ],
      },
      {
        id: 'agent-runner', name: 'Agent Runner', description: 'Can only execute tasks',
        isSystem: true, tenantId: '*',
        permissions: [
          { resource: 'tasks', actions: ['create', 'read', 'execute'] },
        ],
      },
    ];
    for (const role of systemRoles) {
      this.roles.set(role.id, role);
      getDatabase().getDb().prepare(`INSERT OR REPLACE INTO roles (id, name, description, permissions, tenant_id, is_system)
                                     VALUES (?, ?, ?, ?, ?, ?)`).run(
        role.id, role.name, role.description, JSON.stringify(role.permissions), role.tenantId, role.isSystem ? 1 : 0,
      );
    }
  }

  // ── Default Tenant ──────────────────────────────────────────────────────

  private registerDefaultTenant(): void {
    const db = getDatabase().getDb();
    const existing = db.prepare('SELECT id FROM tenants WHERE slug = ?').get('default');
    if (!existing) {
      db.prepare(`INSERT INTO tenants (id, name, slug, plan, max_agents, max_tasks_per_day, budget_limit, status, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        'default', 'Default Tenant', 'default', 'enterprise', 1000, 10000, 1000.0, 'active', new Date().toISOString(),
      );
    }
  }

  // ── User Management ─────────────────────────────────────────────────────

  createUser(username: string, email: string, password: string, role: string = 'viewer', tenantId: string = 'default'): User {
    const id = uuid();
    const salt = randomBytes(16).toString('hex');
    const passwordHash = createHash('sha256').update(password + salt).digest('hex') + ':' + salt;
    const now = new Date().toISOString();

    const user: User = { id, username, email, passwordHash, role, tenantId, status: 'active', createdAt: now, metadata: {} };

    getDatabase().getDb().prepare(`INSERT INTO users (id, username, email, password_hash, role, tenant_id, status, created_at)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, username, email, passwordHash, role, tenantId, 'active', now,
    );

    this.audit(id, tenantId, 'user.created', 'users', id, `User ${username} created with role ${role}`);
    return user;
  }

  authenticateUser(username: string, password: string): User | null {
    const db = getDatabase().getDb();
    const row = db.prepare('SELECT * FROM users WHERE username = ? AND status = ?').get(username, 'active') as any;
    if (!row) return null;

    const [hash, salt] = row.password_hash.split(':');
    const attempt = createHash('sha256').update(password + salt).digest('hex');
    if (attempt !== hash) return null;

    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    this.audit(row.id, row.tenant_id, 'user.login', 'users', row.id, `User ${username} logged in`);

    return {
      id: row.id, username: row.username, email: row.email, passwordHash: row.password_hash,
      role: row.role, tenantId: row.tenant_id, status: row.status, createdAt: row.created_at,
      metadata: {},
    };
  }

  // ── API Key Management ──────────────────────────────────────────────────

  generateApiKey(userId: string, name: string, permissions: string[] = ['*']): { key: string; apiKey: APIKey } {
    const rawKey = `paos_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12);
    const now = new Date().toISOString();

    const db = getDatabase().getDb();
    const userRow = db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(userId) as any;
    const tenantId = userRow?.tenant_id || 'default';

    const apiKey: APIKey = {
      id: uuid(), userId, tenantId, keyHash, keyPrefix, name,
      permissions, createdAt: now,
    };

    db.prepare(`INSERT INTO api_keys (id, user_id, tenant_id, key_hash, key_prefix, name, permissions, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      apiKey.id, userId, tenantId, keyHash, keyPrefix, name, JSON.stringify(permissions), now,
    );

    this.audit(userId, tenantId, 'api_key.created', 'api_keys', apiKey.id, `API key "${name}" created`);
    return { key: rawKey, apiKey };
  }

  validateApiKey(rawKey: string): APIKey | null {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const db = getDatabase().getDb();
    const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash) as any;
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    return {
      id: row.id, userId: row.user_id, tenantId: row.tenant_id, keyHash: row.key_hash,
      keyPrefix: row.key_prefix, name: row.name, permissions: JSON.parse(row.permissions),
      createdAt: row.created_at, lastUsedAt: new Date().toISOString(),
    };
  }

  // ── Authorization ───────────────────────────────────────────────────────

  authorize(userId: string, resource: string, action: string): boolean {
    const db = getDatabase().getDb();
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any;
    if (!user) return false;

    const role = this.roles.get(user.role);
    if (!role) return false;

    return role.permissions.some(p =>
      (p.resource === '*' || p.resource === resource) &&
      (p.actions as string[]).includes(action)
    );
  }

  // ── Tenant Operations ──────────────────────────────────────────────────

  createTenant(name: string, slug: string, plan: Tenant['plan'] = 'free'): Tenant {
    const limits = {
      free: { maxAgents: 5, maxTasks: 50, budget: 5.0 },
      pro: { maxAgents: 50, maxTasks: 1000, budget: 100.0 },
      enterprise: { maxAgents: 1000, maxTasks: 10000, budget: 1000.0 },
    };
    const l = limits[plan];
    const tenant: Tenant = {
      id: uuid(), name, slug, plan, maxAgents: l.maxAgents,
      maxTasksPerDay: l.maxTasks, budgetLimit: l.budget,
      status: 'active', createdAt: new Date().toISOString(),
    };

    getDatabase().getDb().prepare(`INSERT INTO tenants (id, name, slug, plan, max_agents, max_tasks_per_day, budget_limit, status, created_at)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      tenant.id, tenant.name, tenant.slug, tenant.plan, tenant.maxAgents,
      tenant.maxTasksPerDay, tenant.budgetLimit, tenant.status, tenant.createdAt,
    );
    return tenant;
  }

  getTenants(): Tenant[] {
    return getDatabase().getDb().prepare('SELECT * FROM tenants ORDER BY created_at').all() as any[];
  }

  // ── Audit Logging ──────────────────────────────────────────────────────

  audit(userId: string, tenantId: string, action: string, resource: string, resourceId: string, details: string, ip?: string): void {
    const entry: AuditEntry = {
      id: uuid(), userId, tenantId, action, resource, resourceId, details, ip,
      timestamp: new Date().toISOString(),
    };
    getDatabase().getDb().prepare(`INSERT INTO audit_log (id, actor, action, resource, details, timestamp)
                                   VALUES (?, ?, ?, ?, ?, ?)`).run(
      entry.id, userId, action, resource, details, entry.timestamp,
    );
  }

  // ── Role Management ─────────────────────────────────────────────────────

  getRoles(): Role[] { return [...this.roles.values()]; }
  getRole(id: string): Role | undefined { return this.roles.get(id); }

  createCustomRole(name: string, description: string, permissions: Permission[], tenantId: string): Role {
    const role: Role = { id: uuid(), name, description, permissions, tenantId, isSystem: false };
    this.roles.set(role.id, role);
    getDatabase().getDb().prepare(`INSERT INTO roles (id, name, description, permissions, tenant_id, is_system)
                                   VALUES (?, ?, ?, ?, ?, 0)`).run(
      role.id, role.name, role.description, JSON.stringify(role.permissions), tenantId,
    );
    return role;
  }
}
