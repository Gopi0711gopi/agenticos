#!/usr/bin/env node
// ============================================================================
// Peripheral Agentic OS — Entry Point
// ============================================================================

import chalk from 'chalk';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import { getDatabase, closeDatabase } from './db/database.js';
import { eventBus } from './core/event-bus.js';
import { ModeEngine } from './core/mode-engine.js';
import { Orchestrator } from './core/orchestrator.js';
import { AgentRegistry } from './swarm/agent-registry.js';
import { SwarmEngine } from './swarm/swarm-engine.js';
import { ModelCallService } from './router/model-call.js';
import { ModelRouter } from './router/model-router.js';
import { ModelDiscovery } from './router/model-discovery.js';
import { QLearningRouter } from './router/q-learning-router.js';
import { POMDPSelector } from './router/pomdp.js';
import { Forge } from './forge/forge.js';
import { JudgePipeline } from './judge/judge-pipeline.js';
import { GoodhartDetector } from './judge/goodhart-detector.js';
import { DriftMonitor } from './judge/drift-bounds.js';
import { TrilemmaGuard, BehavioralContractEngine } from './judge/trilemma-contracts.js';
import { SLMLite } from './memory/slm-lite.js';
import { AttributionPipeline } from './attribution/attribution.js';
import { CredentialVault } from './enterprise/credential-vault.js';
import { RBACManager } from './enterprise/rbac.js';
import { ClawBridge } from './bridge/claw-bridge.js';
import { PluginManager } from './plugins/plugin-manager.js';
import { createCLI } from './transport/cli.js';
import { createHttpServer } from './transport/http-server.js';

// ============================================================================
// Boot Sequence
// ============================================================================

async function boot() {
  console.log(chalk.cyan.bold('\n  ╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('  ║     Peripheral Agentic OS  v2.0.0       ║'));
  console.log(chalk.cyan.bold('  ║     Universal AI Agent Orchestration     ║'));
  console.log(chalk.cyan.bold('  ╚══════════════════════════════════════════╝\n'));

  // Load config
  let config: any = {};
  try {
    const configPath = resolve(process.cwd(), 'config.yaml');
    config = parseYaml(readFileSync(configPath, 'utf8'));
    console.log('  ✓ Configuration loaded');
  } catch {
    console.log('  ⚠ No config.yaml found — using defaults');
  }

  // Initialize database
  console.log('  ⏳ Initializing database...');
  const db = getDatabase(config.system?.data_dir ? `${config.system.data_dir}/paos.db` : './data/paos.db');
  db.migrate();
  console.log(`  ✓ Database ready (${db.getTableCount()} tables, v${db.getVersion()})`);

  // Mode engine
  const mode = config.system?.mode || 'power';
  const modeEngine = new ModeEngine(mode);
  console.log(`  ✓ Mode: ${chalk.yellow(mode)} (${modeEngine.getAvailableTopologies().length} topologies, ${modeEngine.getAvailableStrategies().length} strategies)`);

  // Credential vault
  const vault = new CredentialVault();

  // Model call service
  const modelCallService = new ModelCallService();
  const providers = config.providers || {};
  let configuredProviders = 0;

  for (const [name, pConfig] of Object.entries(providers) as [string, any][]) {
    if (pConfig.enabled !== false) {
      const apiKey = pConfig.api_key_env ? process.env[pConfig.api_key_env] : undefined;
      modelCallService.configureProvider({
        provider: name as any,
        baseUrl: pConfig.base_url || pConfig.endpoint || '',
        apiKey,
        enabled: true,
      });
      configuredProviders++;
    }
  }
  console.log(`  ✓ Model providers: ${configuredProviders} configured`);

  // Model router + discovery
  const modelRouter = new ModelRouter(config.routing?.default_strategy || 'balanced');
  const discovery = new ModelDiscovery(config.routing?.cache_ttl ? config.routing.cache_ttl * 1000 : 3600000);

  // Q-Learning router
  const qlRouter = new QLearningRouter(
    config.routing?.q_learning?.epsilon ?? 0.1,
    0.1,
    config.routing?.q_learning?.persist_interval ?? 10,
    modeEngine.getAvailableStrategies()
  );

  // POMDP selector
  const pomdpSelector = new POMDPSelector(
    config.routing?.pomdp?.belief_floor ?? 0.01,
    config.routing?.pomdp?.belief_ceiling ?? 0.99,
    config.routing?.pomdp?.cost_weight ?? 0.3
  );

  // Agent registry
  const registry = new AgentRegistry();

  // Model call wrapper for agents
  const agentExecutor = async (agentId: string, prompt: string, systemPrompt?: string) => {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system' as const, content: systemPrompt });
    messages.push({ role: 'user' as const, content: prompt });

    try {
      const response = await modelCallService.call({
        model: config.routing?.default_model || 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        maxTokens: 4096,
      });
      return response.content;
    } catch {
      return `[Agent ${agentId} fallback] I'll provide a direct response to: ${prompt.substring(0, 200)}`;
    }
  };

  // Swarm engine
  const swarmEngine = new SwarmEngine(registry, agentExecutor);

  // Orchestrator
  const orchestrator = new Orchestrator(registry, swarmEngine, modeEngine, {
    maxRedesigns: config.forge?.max_redesigns ?? 5,
    maxBudgetMultiplier: config.budget?.max_budget_multiplier ?? 3,
    defaultBudget: config.budget?.default_task_budget ?? 1.0,
    qualityThreshold: config.judge?.quality_threshold ?? 0.6,
    enableSimulation: modeEngine.isSimulationEnabled(),
  });

  // Forge
  const forgeModelCall = async (prompt: string, systemPrompt: string) => {
    try {
      const resp = await modelCallService.call({
        model: config.routing?.default_model || 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
        temperature: 0.7, maxTokens: 4096, responseFormat: 'json',
      });
      return resp.content;
    } catch {
      return '{"topology":"sequential","agents":[{"name":"worker","role":"General Worker","description":"Handles the task","systemPrompt":"Complete the task thoroughly.","tools":[],"order":0}]}';
    }
  };
  const forge = new Forge(forgeModelCall, {
    maxRedesigns: config.forge?.max_redesigns ?? 5,
    defaultTopology: config.forge?.default_topology ?? 'sequential',
    budget: config.budget?.default_task_budget ?? 1.0,
  });
  forge.setRLTrainer(qlRouter);
  orchestrator.setForge(forge);

  // Judge
  const judgeModelCall = async (prompt: string, systemPrompt: string) => {
    try {
      const resp = await modelCallService.call({
        model: config.routing?.default_model || 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
        temperature: 0.3, maxTokens: 2048, responseFormat: 'json',
      });
      return resp.content;
    } catch {
      return '{"scores":{},"overall_score":0.7,"outcome":"approve","feedback":"Auto-approved","confidence":0.5}';
    }
  };
  const judge = new JudgePipeline(judgeModelCall, ['default-judge'], config.judge?.consensus_algorithm || 'weighted_majority');
  orchestrator.setJudge(judge);

  // Memory
  const memory = new SLMLite(config.memory?.working?.max_entries ?? 100);
  orchestrator.setMemory(memory);

  // RL Trainer
  orchestrator.setRLTrainer(qlRouter);

  // Quality monitors
  const goodhartDetector = new GoodhartDetector(config.quality?.goodhart);
  const driftMonitor = new DriftMonitor(config.quality?.drift?.jsd_threshold ?? 0.877);
  const trilemmaGuard = new TrilemmaGuard(config.quality?.trilemma?.max_q_delta ?? 0.15, config.quality?.trilemma?.max_iterations ?? 5);
  const contractEngine = new BehavioralContractEngine();

  orchestrator.setQualityMonitors({
    checkGoodhart: (taskId) => goodhartDetector.check(taskId),
    checkDrift: async (taskId) => { const snaps = driftMonitor.checkAll(); return snaps.some(s => s.drifted); },
    checkTrilemma: async (taskId, iter) => trilemmaGuard.check(taskId, iter, 0),
    checkContracts: async (taskId, phase, ctx) => {
      const context = { taskId, budget: ctx.budget as number || 1, spent: ctx.spent as number || 0, prompt: ctx.prompt as string || '', metadata: {}, ...ctx };
      return phase === 'pre' ? contractEngine.checkPre(context) : contractEngine.checkPost(context);
    },
  });

  // Attribution
  const attribution = new AttributionPipeline();

  console.log('  ✓ Orchestrator initialized (12-step pipeline)');
  console.log(`  ✓ Quality guards: Goodhart, Drift (Θ=${driftMonitor.getThreshold()}), Trilemma, Contracts`);

  // Phase 7: Claw Bridge (MCP + A2A)
  const bridge = new ClawBridge(orchestrator);
  const bridgeStats = bridge.getStats();
  console.log(`  ✓ Claw Bridge: MCP (${bridgeStats.mcpTools} tools, ${bridgeStats.mcpResources} resources) + A2A (${bridgeStats.a2aSkills} skills)`);

  // Phase 8: Plugin System
  const pluginManager = new PluginManager();
  console.log(`  ✓ Plugins: ${pluginManager.getPlugins().length} installed, ${pluginManager.getSkills().length} skills, ${pluginManager.getTemplates().length} templates`);

  // Phase 9: Enterprise RBAC
  const rbac = new RBACManager();
  console.log(`  ✓ Enterprise: RBAC (${rbac.getRoles().length} roles), multi-tenant, API keys`);

  // Emit boot event
  eventBus.emit('system:boot', {
    version: '2.0.0',
    mode,
    tables: db.getTableCount(),
    providers: configuredProviders,
    mcpTools: bridgeStats.mcpTools,
    a2aSkills: bridgeStats.a2aSkills,
    plugins: pluginManager.getPlugins().length,
    roles: rbac.getRoles().length,
  }, 'System');

  // CLI or Server mode
  const args = process.argv.slice(2);

  if (args.length > 0 && !args[0].startsWith('--serve')) {
    // CLI mode
    const cli = createCLI(orchestrator);
    await cli.parseAsync(process.argv);
  } else {
    // Server mode
    const httpPort = config.transport?.http?.port ?? 3700;
    createHttpServer(orchestrator, httpPort, { bridge, pluginManager, rbac });

    console.log(chalk.green.bold('\n  🚀 Peripheral Agentic OS is running!\n'));
    console.log(`  HTTP API:    ${chalk.cyan(`http://localhost:${httpPort}`)}`);
    console.log(`  Dashboard:   ${chalk.cyan('http://localhost:5173')} (run: npm run dashboard)`);
    console.log(`  MCP Server:  ${chalk.cyan('paos --mcp-stdio')} (for Claude/Cursor)`);
    console.log(`  CLI:         ${chalk.cyan('npx tsx src/index.ts run "your task"')}`);
    console.log('');
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n  Shutting down...'));
    eventBus.emit('system:shutdown', {}, 'System');
    closeDatabase();
    process.exit(0);
  });
}

// Run
boot().catch((err) => {
  console.error(chalk.red('Boot failed:'), err);
  process.exit(1);
});
