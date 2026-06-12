// ============================================================================
// Peripheral Agentic OS — Credential Vault (AES-256-GCM)
// ============================================================================

import crypto from 'crypto';
import { getDatabase } from '../db/database.js';
import { eventBus } from '../core/event-bus.js';

/**
 * AES-256-GCM encrypted credential vault.
 * Stores API keys and secrets securely in SQLite.
 */
export class CredentialVault {
  private masterKey: Buffer;

  constructor(masterKeyHex?: string) {
    // Derive master key from environment or generate
    if (masterKeyHex) {
      this.masterKey = Buffer.from(masterKeyHex, 'hex');
    } else {
      const envKey = process.env.PAOS_MASTER_KEY;
      if (envKey) {
        this.masterKey = Buffer.from(envKey, 'hex');
      } else {
        // Generate and warn
        this.masterKey = crypto.randomBytes(32);
        console.warn('  ⚠ No PAOS_MASTER_KEY set — generated ephemeral key (credentials will not persist across restarts)');
      }
    }
  }

  /** Store an encrypted credential */
  store(name: string, value: string): string {
    const id = crypto.randomUUID();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);

    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    const db = getDatabase().getDb();
    db.prepare(`
      INSERT OR REPLACE INTO credentials (id, name, encrypted_value, iv, auth_tag, algorithm)
      VALUES (?, ?, ?, ?, ?, 'aes-256-gcm')
    `).run(id, name, encrypted, iv.toString('hex'), authTag);

    eventBus.emit('enterprise:credential_stored', { name, id }, 'CredentialVault');
    return id;
  }

  /** Retrieve and decrypt a credential by name */
  retrieve(name: string): string | null {
    const db = getDatabase().getDb();
    const row = db.prepare(
      'SELECT encrypted_value, iv, auth_tag FROM credentials WHERE name = ? ORDER BY updated_at DESC LIMIT 1'
    ).get(name) as { encrypted_value: string; iv: string; auth_tag: string } | undefined;

    if (!row) return null;

    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.masterKey,
        Buffer.from(row.iv, 'hex')
      );
      decipher.setAuthTag(Buffer.from(row.auth_tag, 'hex'));

      let decrypted = decipher.update(row.encrypted_value, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      eventBus.emit('enterprise:credential_accessed', { name }, 'CredentialVault');
      return decrypted;
    } catch {
      return null;
    }
  }

  /** Delete a credential */
  delete(name: string): boolean {
    const db = getDatabase().getDb();
    const result = db.prepare('DELETE FROM credentials WHERE name = ?').run(name);
    return result.changes > 0;
  }

  /** List all credential names (not values) */
  list(): string[] {
    const db = getDatabase().getDb();
    const rows = db.prepare('SELECT DISTINCT name FROM credentials ORDER BY name').all() as { name: string }[];
    return rows.map(r => r.name);
  }

  /** Check if a credential exists */
  has(name: string): boolean {
    const db = getDatabase().getDb();
    const row = db.prepare('SELECT 1 FROM credentials WHERE name = ? LIMIT 1').get(name);
    return !!row;
  }

  /**
   * Resolve a credential: try vault first, then environment variable.
   * This is the primary method for getting API keys.
   */
  resolve(name: string, envVar?: string): string | null {
    // Try vault first
    const vaultValue = this.retrieve(name);
    if (vaultValue) return vaultValue;

    // Fall back to environment variable
    if (envVar && process.env[envVar]) {
      return process.env[envVar]!;
    }

    // Try common env var patterns
    const envName = name.toUpperCase().replace(/-/g, '_');
    if (process.env[envName]) return process.env[envName]!;
    if (process.env[`${envName}_API_KEY`]) return process.env[`${envName}_API_KEY`]!;

    return null;
  }
}
