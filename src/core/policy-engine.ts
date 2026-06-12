// ============================================================================
// Peripheral Agentic OS — Security Policy Engine
// ============================================================================

import { eventBus } from './event-bus.js';

/** Security policy rule */
export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  pattern: RegExp | string;
  action: 'block' | 'warn' | 'log';
  category: 'content' | 'tool' | 'model' | 'network';
  enabled: boolean;
}

/** Policy evaluation result */
export interface PolicyResult {
  allowed: boolean;
  violations: PolicyViolation[];
  warnings: PolicyViolation[];
}

export interface PolicyViolation {
  ruleId: string;
  ruleName: string;
  action: 'block' | 'warn' | 'log';
  details: string;
}

/**
 * Security Policy Engine.
 * Evaluates tasks and outputs against security rules.
 * Runs outside the self-improvement loop (cannot be modified by RL).
 */
export class PolicyEngine {
  private rules: PolicyRule[];

  constructor() {
    this.rules = this.getDefaultRules();
  }

  /** Evaluate a task prompt against security policies */
  evaluate(prompt: string, context: Record<string, unknown> = {}): PolicyResult {
    const violations: PolicyViolation[] = [];
    const warnings: PolicyViolation[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      let matched = false;
      if (typeof rule.pattern === 'string') {
        matched = prompt.toLowerCase().includes(rule.pattern.toLowerCase());
      } else {
        matched = rule.pattern.test(prompt);
      }

      if (matched) {
        const violation: PolicyViolation = {
          ruleId: rule.id,
          ruleName: rule.name,
          action: rule.action,
          details: `Matched rule: ${rule.description}`,
        };

        if (rule.action === 'block') {
          violations.push(violation);
        } else if (rule.action === 'warn') {
          warnings.push(violation);
        }

        eventBus.emit('quality:guard_verdict', {
          ruleId: rule.id,
          action: rule.action,
          prompt: prompt.substring(0, 100),
        }, 'PolicyEngine');
      }
    }

    const result: PolicyResult = {
      allowed: violations.length === 0,
      violations,
      warnings,
    };

    return result;
  }

  /** Add a custom policy rule */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  /** Remove a policy rule by ID */
  removeRule(ruleId: string): boolean {
    const idx = this.rules.findIndex(r => r.id === ruleId);
    if (idx === -1) return false;
    this.rules.splice(idx, 1);
    return true;
  }

  /** Toggle a rule on/off */
  toggleRule(ruleId: string, enabled: boolean): boolean {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return false;
    rule.enabled = enabled;
    return true;
  }

  /** Get all rules */
  getRules(): PolicyRule[] {
    return [...this.rules];
  }

  /** Evaluate an output for content safety */
  evaluateOutput(output: string): PolicyResult {
    return this.evaluate(output, { phase: 'output' });
  }

  /** Default security rules */
  private getDefaultRules(): PolicyRule[] {
    return [
      {
        id: 'sec-001',
        name: 'Harmful Content',
        description: 'Block requests for harmful or dangerous content',
        pattern: /\b(how to (make|build|create) (a )?(bomb|weapon|explosive|virus|malware))\b/i,
        action: 'block',
        category: 'content',
        enabled: true,
      },
      {
        id: 'sec-002',
        name: 'PII Exfiltration',
        description: 'Warn on potential PII exfiltration attempts',
        pattern: /\b(social security|ssn|credit card number|passport number)\b/i,
        action: 'warn',
        category: 'content',
        enabled: true,
      },
      {
        id: 'sec-003',
        name: 'System Prompt Extraction',
        description: 'Block attempts to extract system prompts',
        pattern: /\b(ignore (previous|above|all) (instructions|prompt)|reveal (your|the) (system|original) prompt)\b/i,
        action: 'block',
        category: 'content',
        enabled: true,
      },
      {
        id: 'sec-004',
        name: 'Shell Injection',
        description: 'Block potential shell injection in tool calls',
        pattern: /[;&|`$]\s*(rm\s+-rf|sudo|chmod|chown|mkfs|dd\s+if)/i,
        action: 'block',
        category: 'tool',
        enabled: true,
      },
      {
        id: 'sec-005',
        name: 'SQL Injection',
        description: 'Warn on potential SQL injection patterns',
        pattern: /('|\b(union|select|drop|delete|insert|update|alter)\b.*\b(from|table|database)\b)/i,
        action: 'warn',
        category: 'content',
        enabled: true,
      },
    ];
  }
}
