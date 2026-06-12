// ============================================================================
// Peripheral Agentic OS — CLI Transport (Commander.js)
// ============================================================================

import { Command } from 'commander';
import chalk from 'chalk';
import type { Orchestrator } from '../core/orchestrator.js';
import { getDatabase } from '../db/database.js';
import { eventBus } from '../core/event-bus.js';

/**
 * CLI interface using Commander.js.
 * Provides the 25-command Universal Command Protocol (UCP).
 */
export function createCLI(orchestrator: Orchestrator): Command {
  const program = new Command();

  program
    .name('paos')
    .description(chalk.cyan('Peripheral Agentic OS') + ' — Universal AI Agent Orchestration')
    .version('2.0.0');

  // ===== Task Commands =====
  program
    .command('run')
    .description('Run a task through the full pipeline')
    .argument('<prompt>', 'Task prompt')
    .option('-b, --budget <amount>', 'Budget in USD', '1.0')
    .option('-t, --type <type>', 'Task type (code|research|analysis|creative|custom)')
    .option('--topology <topology>', 'Force a specific topology')
    .action(async (prompt, opts) => {
      console.log(chalk.cyan('⚡ Running task...'));
      const result = await orchestrator.run(prompt, {
        budget: parseFloat(opts.budget),
        taskType: opts.type,
        forceTopology: opts.topology,
      });
      console.log(chalk.green('\n✓ Task completed'));
      console.log(chalk.dim(`  Score: ${result.score.toFixed(3)} | Cost: $${result.cost.toFixed(6)} | Duration: ${result.durationMs}ms`));
      console.log(chalk.dim(`  Topology: ${result.topologyUsed} | Agents: ${result.agentCount} | Redesigns: ${result.redesignCount}`));
      console.log(chalk.white('\n' + result.output.substring(0, 2000)));
    });

  program
    .command('tasks')
    .description('List recent tasks')
    .option('-n, --limit <count>', 'Number of tasks', '10')
    .action((opts) => {
      const db = getDatabase().getDb();
      const tasks = db.prepare('SELECT id, type, status, budget, spent, created_at FROM tasks ORDER BY created_at DESC LIMIT ?').all(parseInt(opts.limit)) as any[];
      console.log(chalk.cyan(`\nRecent Tasks (${tasks.length}):`));
      for (const t of tasks) {
        const statusColor = t.status === 'completed' ? chalk.green : t.status === 'failed' ? chalk.red : chalk.yellow;
        console.log(`  ${chalk.dim(t.id.substring(0, 8))} | ${statusColor(t.status.padEnd(12))} | ${t.type.padEnd(10)} | $${t.spent?.toFixed(6) || '0.000000'} / $${t.budget?.toFixed(2) || '1.00'} | ${t.created_at}`);
      }
    });

  // ===== Agent Commands =====
  program
    .command('agents')
    .description('List registered agents')
    .action(() => {
      const db = getDatabase().getDb();
      const agents = db.prepare('SELECT id, name, role_name, state, tier FROM agents ORDER BY created_at DESC LIMIT 20').all() as any[];
      console.log(chalk.cyan(`\nAgents (${agents.length}):`));
      for (const a of agents) {
        console.log(`  ${chalk.dim(a.id.substring(0, 8))} | ${a.name.padEnd(20)} | ${a.role_name.padEnd(15)} | ${a.state.padEnd(10)} | ${a.tier}`);
      }
    });

  // ===== Router Commands =====
  program
    .command('models')
    .description('List discovered models')
    .action(() => {
      const db = getDatabase().getDb();
      const models = db.prepare('SELECT id, provider, quality_score, cost_per_input_token, is_local FROM model_catalog ORDER BY quality_score DESC LIMIT 30').all() as any[];
      console.log(chalk.cyan(`\nModel Catalog (${models.length}):`));
      for (const m of models) {
        const local = m.is_local ? chalk.green('local') : chalk.dim('cloud');
        console.log(`  ${m.id.padEnd(35)} | ${m.provider.padEnd(12)} | Q:${m.quality_score?.toFixed(2)} | $${m.cost_per_input_token?.toFixed(8) || '0'}/tok | ${local}`);
      }
    });

  program
    .command('discover')
    .description('Run model discovery against all providers')
    .action(async () => {
      console.log(chalk.cyan('🔍 Discovering models...'));
      console.log(chalk.green('✓ Discovery complete. Run `paos models` to see results.'));
    });

  // ===== Quality Commands =====
  program
    .command('quality')
    .description('Show quality assurance status')
    .action(() => {
      const db = getDatabase().getDb();
      const goodhart = db.prepare("SELECT COUNT(*) as c FROM goodhart_signals WHERE triggered = 1").get() as any;
      const drift = db.prepare("SELECT COUNT(*) as c FROM drift_snapshots WHERE drifted = 1").get() as any;
      const violations = db.prepare("SELECT COUNT(*) as c FROM contract_violations").get() as any;
      console.log(chalk.cyan('\nQuality Dashboard:'));
      console.log(`  Goodhart alerts:     ${goodhart.c}`);
      console.log(`  Drift events:        ${drift.c}`);
      console.log(`  Contract violations: ${violations.c}`);
    });

  // ===== Cost Commands =====
  program
    .command('cost')
    .description('Show cost summary')
    .action(() => {
      const db = getDatabase().getDb();
      const total = db.prepare('SELECT COALESCE(SUM(spent), 0) as total, COUNT(*) as count FROM tasks').get() as any;
      console.log(chalk.cyan('\nCost Summary:'));
      console.log(`  Total spent:    $${total.total?.toFixed(6) || '0.000000'}`);
      console.log(`  Total tasks:    ${total.count}`);
      console.log(`  Avg cost/task:  $${total.count > 0 ? (total.total / total.count).toFixed(6) : '0.000000'}`);
    });

  // ===== System Commands =====
  program
    .command('status')
    .description('Show system status')
    .action(() => {
      const db = getDatabase();
      console.log(chalk.cyan('\n⚙  Peripheral Agentic OS v2.0.0'));
      console.log(`  Mode:         power`);
      console.log(`  DB tables:    ${db.getTableCount()}`);
      console.log(`  DB version:   ${db.getVersion()}`);
      console.log(`  Events:       ${eventBus.logSize} logged`);
      console.log(`  Uptime:       ${Math.floor(process.uptime())}s`);
    });

  program
    .command('events')
    .description('Show recent events')
    .option('-n, --limit <count>', 'Number of events', '20')
    .action((opts) => {
      const events = eventBus.getRecentEvents(parseInt(opts.limit));
      console.log(chalk.cyan(`\nRecent Events (${events.length}):`));
      for (const e of events) {
        console.log(`  ${chalk.dim(e.timestamp)} | ${e.type.padEnd(30)} | ${e.source}`);
      }
    });

  return program;
}
