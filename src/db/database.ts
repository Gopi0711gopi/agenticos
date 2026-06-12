// ============================================================================
// Peripheral Agentic OS — Database Setup & Migration Runner
// ============================================================================

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { eventBus } from '../core/event-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Database manager for SQLite with migration support.
 * Handles 49 tables across 18 migration phases.
 */
export class DatabaseManager {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath = './data/paos.db') {
    this.dbPath = dbPath;
    // Ensure data directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    // Enable WAL mode for better concurrent reading
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
  }

  /** Get the raw database instance */
  getDb(): Database.Database {
    return this.db;
  }

  /** Run all pending migrations */
  migrate(): void {
    eventBus.emit('system:migration_started', { dbPath: this.dbPath }, 'DatabaseManager');

    const currentVersion = this.db.pragma('user_version', { simple: true }) as number;
    const migrations = this.getMigrations();

    let applied = 0;
    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        this.db.transaction(() => {
          this.db.exec(migration.sql);
          this.db.pragma(`user_version = ${migration.version}`);
        })();
        applied++;
        console.log(`  ✓ Migration ${migration.version}: ${migration.name}`);
      }
    }

    if (applied === 0) {
      console.log('  ✓ Database is up to date');
    }

    eventBus.emit('system:migration_completed', {
      dbPath: this.dbPath,
      migrationsApplied: applied,
      currentVersion: this.db.pragma('user_version', { simple: true }),
    }, 'DatabaseManager');
  }

  /** Get all migration definitions */
  private getMigrations(): Array<{ version: number; name: string; sql: string }> {
    return [
      { version: 1, name: 'core_tables', sql: MIGRATION_001 },
      { version: 2, name: 'agent_tables', sql: MIGRATION_002 },
      { version: 3, name: 'task_tables', sql: MIGRATION_003 },
      { version: 4, name: 'forge_tables', sql: MIGRATION_004 },
      { version: 5, name: 'router_tables', sql: MIGRATION_005 },
      { version: 6, name: 'judge_tables', sql: MIGRATION_006 },
      { version: 7, name: 'quality_tables', sql: MIGRATION_007 },
      { version: 8, name: 'memory_tables', sql: MIGRATION_008 },
      { version: 9, name: 'attribution_tables', sql: MIGRATION_009 },
      { version: 10, name: 'marketplace_tables', sql: MIGRATION_010 },
      { version: 11, name: 'enterprise_tables', sql: MIGRATION_011 },
      { version: 12, name: 'event_tables', sql: MIGRATION_012 },
      { version: 13, name: 'transport_tables', sql: MIGRATION_013 },
      { version: 14, name: 'indexes_v1', sql: MIGRATION_014 },
      { version: 15, name: 'fts5_tables', sql: MIGRATION_015 },
      { version: 16, name: 'compatibility_tables', sql: MIGRATION_016 },
      { version: 17, name: 'workflow_tables', sql: MIGRATION_017 },
      { version: 18, name: 'quality_v2', sql: MIGRATION_018 },
      { version: 19, name: 'enterprise_rbac_v2', sql: MIGRATION_019 },
    ];
  }

  /** Close the database */
  close(): void {
    this.db.close();
  }

  /** Check if database is open */
  isOpen(): boolean {
    return this.db.open;
  }

  /** Get table count */
  getTableCount(): number {
    const result = this.db.prepare(
      "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).get() as { count: number };
    return result.count;
  }

  /** Get current migration version */
  getVersion(): number {
    return this.db.pragma('user_version', { simple: true }) as number;
  }
}

// ============================================================================
// Migration SQL Definitions (49 tables across 18 phases)
// ============================================================================

const MIGRATION_001 = `
-- Core system tables
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('healthy', 'degraded', 'unhealthy')),
  details TEXT,
  checked_at TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_002 = `
-- Agent tables
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_name TEXT NOT NULL,
  role_description TEXT,
  system_prompt TEXT,
  state TEXT NOT NULL DEFAULT 'idle' CHECK(state IN ('idle','working','paused','error','terminated')),
  tier TEXT DEFAULT 'standard' CHECK(tier IN ('frontier','standard','lightweight')),
  team_id TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_behaviors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  pattern TEXT NOT NULL,
  success_rate REAL DEFAULT 0,
  sample_size INTEGER DEFAULT 0,
  last_used TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_003 = `
-- Task tables
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom' CHECK(type IN ('code','research','analysis','creative','custom')),
  status TEXT NOT NULL DEFAULT 'pending',
  budget REAL NOT NULL DEFAULT 1.0,
  spent REAL DEFAULT 0,
  team_id TEXT,
  parent_task_id TEXT,
  redesign_count INTEGER DEFAULT 0,
  max_redesigns INTEGER DEFAULT 5,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  output TEXT NOT NULL,
  score REAL,
  cost REAL,
  duration_ms INTEGER,
  topology_used TEXT,
  agent_count INTEGER,
  redesign_count INTEGER,
  judge_verdict TEXT,
  quality_report TEXT,
  attribution_data TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  step INTEGER NOT NULL,
  step_name TEXT NOT NULL,
  state TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_steering (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  action TEXT NOT NULL CHECK(action IN ('pause','resume','redirect','cancel')),
  new_prompt TEXT,
  reason TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_004 = `
-- Forge tables
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT,
  task_id TEXT,
  topology TEXT NOT NULL,
  agent_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL REFERENCES teams(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  role TEXT NOT NULL,
  model TEXT,
  position INTEGER
);

CREATE TABLE IF NOT EXISTS team_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL REFERENCES teams(id),
  task_id TEXT NOT NULL,
  topology TEXT NOT NULL,
  rounds INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  duration_ms INTEGER,
  final_output TEXT,
  convergence_reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forge_designs (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,
  task_prompt TEXT,
  topology TEXT NOT NULL,
  design_json TEXT NOT NULL,
  score REAL,
  verdict TEXT CHECK(verdict IN ('approved','rejected')),
  feedback TEXT,
  redesign_of TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forge_strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type TEXT NOT NULL,
  topology TEXT NOT NULL,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  avg_score REAL DEFAULT 0,
  last_used TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forge_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_id TEXT NOT NULL REFERENCES forge_designs(id),
  judge_verdict TEXT,
  judge_feedback TEXT,
  score REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_005 = `
-- Router tables
CREATE TABLE IF NOT EXISTS q_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL,
  action TEXT NOT NULL,
  value REAL DEFAULT 0,
  visits INTEGER DEFAULT 0,
  last_updated TEXT DEFAULT (datetime('now')),
  UNIQUE(state, action)
);

CREATE TABLE IF NOT EXISTS model_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  quality_score REAL DEFAULT 0.5,
  cost_per_input_token REAL DEFAULT 0,
  cost_per_output_token REAL DEFAULT 0,
  context_window INTEGER DEFAULT 4096,
  capabilities TEXT DEFAULT '[]',
  is_local INTEGER DEFAULT 0,
  discovered_at TEXT DEFAULT (datetime('now')),
  last_verified TEXT
);

CREATE TABLE IF NOT EXISTS routing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  strategy TEXT NOT NULL,
  selected_model TEXT NOT NULL,
  selected_provider TEXT NOT NULL,
  reason TEXT,
  candidates INTEGER,
  cost REAL,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS model_performance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  latency_ms INTEGER,
  success INTEGER DEFAULT 1,
  tokens_used INTEGER,
  cost REAL,
  quality_score REAL,
  timestamp TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_006 = `
-- Judge tables
CREATE TABLE IF NOT EXISTS judge_verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  judge_id TEXT NOT NULL,
  model_used TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('approve','revise','reject')),
  score REAL NOT NULL,
  criteria_json TEXT,
  feedback TEXT,
  confidence REAL,
  round INTEGER DEFAULT 1,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS judge_profiles (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  criteria_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS judge_consensus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  outcome TEXT NOT NULL,
  final_score REAL NOT NULL,
  entropy REAL,
  agreement_ratio REAL,
  votes_json TEXT,
  details TEXT,
  round INTEGER DEFAULT 1,
  timestamp TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_007 = `
-- Quality tables
CREATE TABLE IF NOT EXISTS goodhart_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  signal_type TEXT NOT NULL,
  value REAL NOT NULL,
  threshold REAL NOT NULL,
  triggered INTEGER DEFAULT 0,
  risk_level TEXT DEFAULT 'none',
  details TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drift_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  judge_id TEXT NOT NULL,
  reference_distribution TEXT NOT NULL,
  current_distribution TEXT NOT NULL,
  jsd REAL NOT NULL,
  threshold REAL NOT NULL DEFAULT 0.877,
  drifted INTEGER DEFAULT 0,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contract_violations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  contract_name TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('pre','post')),
  details TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trilemma_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  optimization_bounded INTEGER DEFAULT 1,
  safety_preserved INTEGER DEFAULT 1,
  alignment_anchored INTEGER DEFAULT 1,
  q_delta REAL DEFAULT 0,
  iteration_count INTEGER DEFAULT 0,
  escape_hatch TEXT,
  details TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_008 = `
-- Memory tables (SLM-Lite)
CREATE TABLE IF NOT EXISTS episodic_memories (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT,
  content TEXT NOT NULL,
  importance REAL DEFAULT 0.5,
  trust_score REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  last_accessed_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS semantic_memories (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT DEFAULT 'system' CHECK(source IN ('user','agent','system')),
  credibility REAL DEFAULT 0.7,
  contradiction_score REAL DEFAULT 0,
  cross_validated INTEGER DEFAULT 0,
  trust_score REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  last_accessed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS procedural_memories (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  task_type TEXT NOT NULL,
  strategy TEXT,
  success_rate REAL DEFAULT 0,
  sample_size INTEGER DEFAULT 0,
  trust_score REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  last_accessed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS belief_nodes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  source TEXT,
  decay_rate REAL DEFAULT 0.95,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS belief_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL REFERENCES belief_nodes(id),
  to_node_id TEXT NOT NULL REFERENCES belief_nodes(id),
  relationship TEXT NOT NULL CHECK(relationship IN ('supports','contradicts','causes','correlates')),
  strength REAL DEFAULT 0.5,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_009 = `
-- Attribution tables
CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  hmac_signature TEXT NOT NULL,
  key_id TEXT,
  algorithm TEXT DEFAULT 'sha256',
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watermarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  method TEXT DEFAULT 'zero_width',
  marker_count INTEGER DEFAULT 0,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS timestamps_blockchain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  protocol TEXT DEFAULT 'opentimestamps',
  anchor TEXT DEFAULT 'bitcoin',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed')),
  proof TEXT,
  confirmed_at TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_010 = `
-- Marketplace tables
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  author TEXT,
  tools_json TEXT DEFAULT '[]',
  permission_tier TEXT DEFAULT 'community' CHECK(permission_tier IN ('verified','community','restricted')),
  sha256 TEXT,
  installed_at TEXT DEFAULT (datetime('now')),
  enabled INTEGER DEFAULT 1,
  config TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  agents_json TEXT DEFAULT '[]',
  topology TEXT,
  tags TEXT DEFAULT '[]',
  author TEXT,
  version TEXT DEFAULT '1.0.0',
  stars INTEGER DEFAULT 0,
  installs INTEGER DEFAULT 0,
  verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS marketplace_entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('plugin','skill')),
  ref_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT DEFAULT '[]',
  stars INTEGER DEFAULT 0,
  installs INTEGER DEFAULT 0,
  verified INTEGER DEFAULT 0,
  author TEXT,
  registry_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_011 = `
-- Enterprise tables
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  role TEXT DEFAULT 'user',
  api_key_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id TEXT NOT NULL REFERENCES roles(id),
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  granted INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  details TEXT,
  ip_address TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT,
  algorithm TEXT DEFAULT 'aes-256-gcm',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_012 = `
-- Event tables
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  source TEXT,
  correlation_id TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_subscriptions (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  handler_name TEXT NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_013 = `
-- Transport tables
CREATE TABLE IF NOT EXISTS transport_sessions (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  client_id TEXT,
  connected_at TEXT DEFAULT (datetime('now')),
  last_activity TEXT DEFAULT (datetime('now')),
  metadata TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS ucp_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT NOT NULL,
  params TEXT DEFAULT '{}',
  channel TEXT NOT NULL,
  session_id TEXT,
  response TEXT,
  status TEXT DEFAULT 'pending',
  duration_ms INTEGER,
  timestamp TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_014 = `
-- Indexes (30+ indexes for performance)
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_agents_state ON agents(state);
CREATE INDEX IF NOT EXISTS idx_agents_team ON agents(team_id);
CREATE INDEX IF NOT EXISTS idx_agent_states_agent ON agent_states(agent_id);
CREATE INDEX IF NOT EXISTS idx_task_results_task ON task_results(task_id);
CREATE INDEX IF NOT EXISTS idx_task_checkpoints_task ON task_checkpoints(task_id);
CREATE INDEX IF NOT EXISTS idx_forge_designs_type ON forge_designs(task_type);
CREATE INDEX IF NOT EXISTS idx_forge_designs_verdict ON forge_designs(verdict);
CREATE INDEX IF NOT EXISTS idx_forge_designs_topology ON forge_designs(topology);
CREATE INDEX IF NOT EXISTS idx_q_table_state ON q_table(state);
CREATE INDEX IF NOT EXISTS idx_model_catalog_provider ON model_catalog(provider);
CREATE INDEX IF NOT EXISTS idx_model_performance_model ON model_performance(model_id);
CREATE INDEX IF NOT EXISTS idx_routing_history_task ON routing_history(task_id);
CREATE INDEX IF NOT EXISTS idx_judge_verdicts_task ON judge_verdicts(task_id);
CREATE INDEX IF NOT EXISTS idx_judge_consensus_task ON judge_consensus(task_id);
CREATE INDEX IF NOT EXISTS idx_goodhart_signals_task ON goodhart_signals(task_id);
CREATE INDEX IF NOT EXISTS idx_drift_snapshots_judge ON drift_snapshots(judge_id);
CREATE INDEX IF NOT EXISTS idx_contract_violations_task ON contract_violations(task_id);
CREATE INDEX IF NOT EXISTS idx_episodic_memories_session ON episodic_memories(session_id);
CREATE INDEX IF NOT EXISTS idx_semantic_memories_category ON semantic_memories(category);
CREATE INDEX IF NOT EXISTS idx_procedural_memories_type ON procedural_memories(task_type);
CREATE INDEX IF NOT EXISTS idx_belief_edges_from ON belief_edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_belief_edges_to ON belief_edges(to_node_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_marketplace_entries_type ON marketplace_entries(type);
`;

const MIGRATION_015 = `
-- FTS5 full-text search for episodic memory
CREATE VIRTUAL TABLE IF NOT EXISTS episodic_memories_fts USING fts5(
  content,
  event_type,
  content='episodic_memories',
  content_rowid='rowid'
);
`;

const MIGRATION_016 = `
-- Compatibility tables
CREATE TABLE IF NOT EXISTS imported_agents (
  id TEXT PRIMARY KEY,
  source_format TEXT NOT NULL CHECK(source_format IN ('openclaw','nemoclaw','deerflow','gitagent')),
  original_path TEXT,
  agent_id TEXT REFERENCES agents(id),
  import_data TEXT,
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  parameters_schema TEXT,
  handler TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  category TEXT DEFAULT 'general',
  created_at TEXT DEFAULT (datetime('now'))
);
`;

const MIGRATION_017 = `
-- Workflow tables
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  nodes_json TEXT NOT NULL DEFAULT '[]',
  edges_json TEXT NOT NULL DEFAULT '[]',
  validated INTEGER DEFAULT 0,
  team_design_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workflow_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  task_id TEXT,
  status TEXT DEFAULT 'pending',
  current_node TEXT,
  execution_log TEXT DEFAULT '[]',
  started_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
`;

const MIGRATION_018 = `
-- Quality v2 tables (Pivot 2 additions)
CREATE TABLE IF NOT EXISTS quality_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  goodhart_risk TEXT DEFAULT 'none',
  drift_detected INTEGER DEFAULT 0,
  trilemma_bounded INTEGER DEFAULT 1,
  contracts_passed INTEGER DEFAULT 1,
  overall_verdict TEXT,
  details TEXT,
  timestamp TEXT DEFAULT (datetime('now'))
);

-- Meta table tracking migration history
CREATE TABLE IF NOT EXISTS _migrations_meta (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO _migrations_meta (version, name) VALUES
  (1, 'core_tables'), (2, 'agent_tables'), (3, 'task_tables'),
  (4, 'forge_tables'), (5, 'router_tables'), (6, 'judge_tables'),
  (7, 'quality_tables'), (8, 'memory_tables'), (9, 'attribution_tables'),
  (10, 'marketplace_tables'), (11, 'enterprise_tables'), (12, 'event_tables'),
  (13, 'transport_tables'), (14, 'indexes_v1'), (15, 'fts5_tables'),
  (16, 'compatibility_tables'), (17, 'workflow_tables'), (18, 'quality_v2');
`;

const MIGRATION_019 = `
-- Enterprise RBAC v2: add missing columns to roles and users
ALTER TABLE roles ADD COLUMN description TEXT DEFAULT '';
ALTER TABLE roles ADD COLUMN tenant_id TEXT DEFAULT '*';
ALTER TABLE roles ADD COLUMN is_system INTEGER DEFAULT 0;

ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN tenant_id TEXT DEFAULT 'default';
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE users ADD COLUMN last_login_at TEXT;

-- Plugin manager columns for marketplace_entries
ALTER TABLE marketplace_entries ADD COLUMN version TEXT DEFAULT '1.0.0';
ALTER TABLE marketplace_entries ADD COLUMN downloads INTEGER DEFAULT 0;
ALTER TABLE marketplace_entries ADD COLUMN published_at TEXT;

-- Plugin status column
ALTER TABLE plugins ADD COLUMN type TEXT DEFAULT 'tool';
ALTER TABLE plugins ADD COLUMN status TEXT DEFAULT 'installed';

-- Audit log actor column
ALTER TABLE audit_log ADD COLUMN actor TEXT DEFAULT '';
ALTER TABLE audit_log ADD COLUMN resource_id TEXT;

-- Imported agents fixes
CREATE TABLE IF NOT EXISTS imported_agents_v2 (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT 'imported',
  data TEXT,
  imported_at TEXT DEFAULT (datetime('now'))
);

-- Bridge connections
CREATE TABLE IF NOT EXISTS bridge_connections (
  id TEXT PRIMARY KEY,
  protocol TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  last_activity TEXT NOT NULL,
  messages_exchanged INTEGER DEFAULT 0
);

INSERT OR IGNORE INTO _migrations_meta (version, name) VALUES (19, 'enterprise_rbac_v2');
`;

/** Singleton database manager */
let dbInstance: DatabaseManager | null = null;

export function getDatabase(dbPath?: string): DatabaseManager {
  if (!dbInstance) {
    dbInstance = new DatabaseManager(dbPath);
  }
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
