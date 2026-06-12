// ============================================================================
// Peripheral Agentic OS — Event Type Definitions (217 event types)
// ============================================================================

/** Event categories */
export type EventCategory =
  | 'system'
  | 'task'
  | 'agent'
  | 'forge'
  | 'swarm'
  | 'router'
  | 'judge'
  | 'quality'
  | 'memory'
  | 'transport'
  | 'marketplace'
  | 'enterprise'
  | 'attribution';

/** Core event interface */
export interface PAOSEvent {
  id: string;
  type: string;
  category: EventCategory;
  data: Record<string, unknown>;
  source: string;
  timestamp: string;
  correlationId?: string;
}

/** Event handler function */
export type EventHandler = (event: PAOSEvent) => void | Promise<void>;

/** Event subscription */
export interface EventSubscription {
  id: string;
  eventType: string | '*';
  handler: EventHandler;
  once: boolean;
}

// ---- System Events ----
export const SYSTEM_EVENTS = [
  'system:boot', 'system:ready', 'system:shutdown', 'system:error',
  'system:config_changed', 'system:mode_changed', 'system:health_check',
  'system:discovery_started', 'system:discovery_completed',
  'system:migration_started', 'system:migration_completed',
] as const;

// ---- Task Events ----
export const TASK_EVENTS = [
  'task:created', 'task:started', 'task:completed', 'task:failed',
  'task:cancelled', 'task:paused', 'task:resumed', 'task:redirected',
  'task:step_started', 'task:step_completed', 'task:step_failed',
  'task:checkpoint_saved', 'task:checkpoint_restored',
  'task:budget_warning', 'task:budget_exceeded',
  'task:human_escalation', 'task:redesign_triggered',
  'task:output_formatted', 'task:finalized',
] as const;

// ---- Agent Events ----
export const AGENT_EVENTS = [
  'agent:created', 'agent:registered', 'agent:state_changed',
  'agent:executing', 'agent:completed', 'agent:error',
  'agent:tool_called', 'agent:tool_completed', 'agent:tool_error',
  'agent:message_sent', 'agent:message_received',
  'agent:behavior_recorded', 'agent:terminated',
] as const;

// ---- Forge Events ----
export const FORGE_EVENTS = [
  'forge:design_started', 'forge:design_completed', 'forge:design_failed',
  'forge:redesign_started', 'forge:redesign_completed',
  'forge:topology_selected', 'forge:roles_assigned',
  'forge:tools_mapped', 'forge:models_mapped',
  'forge:library_hit', 'forge:library_miss',
  'forge:escalation_triggered', 'forge:guard_checked',
  'forge:guard_violation',
] as const;

// ---- Swarm Events ----
export const SWARM_EVENTS = [
  'swarm:started', 'swarm:completed', 'swarm:failed',
  'swarm:topology_executing', 'swarm:round_started', 'swarm:round_completed',
  'swarm:convergence_detected', 'swarm:message_routed',
  'swarm:agent_dispatched', 'swarm:agent_collected',
  'swarm:vote_cast', 'swarm:consensus_reached',
  'swarm:grid_updated', 'swarm:tree_synthesized',
] as const;

// ---- Router Events ----
export const ROUTER_EVENTS = [
  'router:strategy_selected', 'router:model_selected', 'router:model_called',
  'router:model_responded', 'router:model_error',
  'router:circuit_opened', 'router:circuit_closed', 'router:circuit_half_open',
  'router:cascade_step', 'router:cascade_success', 'router:cascade_exhausted',
  'router:pomdp_belief_updated', 'router:q_table_updated', 'router:q_table_persisted',
  'router:discovery_started', 'router:discovery_completed', 'router:discovery_error',
  'router:catalog_updated', 'router:cost_calculated',
] as const;

// ---- Judge Events ----
export const JUDGE_EVENTS = [
  'judge:pipeline_started', 'judge:pipeline_completed',
  'judge:evaluation_started', 'judge:evaluation_completed',
  'judge:verdict_rendered', 'judge:consensus_computed',
  'judge:approved', 'judge:revised', 'judge:rejected',
  'judge:drift_detected', 'judge:anti_fabrication_check',
  'judge:profile_loaded', 'judge:model_rotated',
] as const;

// ---- Quality Events ----
export const QUALITY_EVENTS = [
  'quality:goodhart_check', 'quality:goodhart_warning', 'quality:goodhart_critical',
  'quality:drift_check', 'quality:drift_warning', 'quality:drift_recalibration',
  'quality:trilemma_check', 'quality:trilemma_bound', 'quality:trilemma_escape',
  'quality:contract_pre_check', 'quality:contract_post_check',
  'quality:contract_violation', 'quality:contract_passed',
  'quality:guard_verdict', 'quality:overall_assessment',
  'quality:score_inflation', 'quality:diversity_collapse',
  'quality:entropy_low', 'quality:calibration_drift',
] as const;

// ---- Memory Events ----
export const MEMORY_EVENTS = [
  'memory:working_stored', 'memory:working_retrieved', 'memory:working_cleared',
  'memory:episodic_stored', 'memory:episodic_retrieved', 'memory:episodic_searched',
  'memory:semantic_stored', 'memory:semantic_retrieved', 'memory:semantic_validated',
  'memory:procedural_stored', 'memory:procedural_retrieved',
  'memory:promoted', 'memory:trust_updated',
  'memory:belief_updated', 'memory:belief_decayed',
  'memory:auto_invoked', 'memory:context_recalled',
] as const;

// ---- Transport Events ----
export const TRANSPORT_EVENTS = [
  'transport:http_request', 'transport:http_response',
  'transport:ws_connected', 'transport:ws_disconnected', 'transport:ws_message',
  'transport:cli_command', 'transport:cli_response',
  'transport:mcp_tool_called', 'transport:mcp_tool_responded',
  'transport:a2a_task_received', 'transport:a2a_task_delegated',
  'transport:discord_message', 'transport:telegram_message',
  'transport:webhook_sent', 'transport:webhook_received',
  'transport:ucp_command', 'transport:ucp_response',
] as const;

// ---- Marketplace Events ----
export const MARKETPLACE_EVENTS = [
  'marketplace:search', 'marketplace:install_started', 'marketplace:install_completed',
  'marketplace:install_failed', 'marketplace:uninstalled',
  'marketplace:enabled', 'marketplace:disabled',
  'marketplace:configured', 'marketplace:verified',
  'marketplace:security_scan', 'marketplace:permission_check',
] as const;

// ---- Enterprise Events ----
export const ENTERPRISE_EVENTS = [
  'enterprise:login', 'enterprise:logout', 'enterprise:access_denied',
  'enterprise:role_assigned', 'enterprise:permission_granted',
  'enterprise:audit_logged', 'enterprise:credential_stored',
  'enterprise:credential_accessed', 'enterprise:rate_limited',
] as const;

// ---- Attribution Events ----
export const ATTRIBUTION_EVENTS = [
  'attribution:signed', 'attribution:verified', 'attribution:watermarked',
  'attribution:timestamped', 'attribution:tamper_detected',
  'attribution:credit_added',
] as const;

/** All event types combined */
export const ALL_EVENT_TYPES = [
  ...SYSTEM_EVENTS,
  ...TASK_EVENTS,
  ...AGENT_EVENTS,
  ...FORGE_EVENTS,
  ...SWARM_EVENTS,
  ...ROUTER_EVENTS,
  ...JUDGE_EVENTS,
  ...QUALITY_EVENTS,
  ...MEMORY_EVENTS,
  ...TRANSPORT_EVENTS,
  ...MARKETPLACE_EVENTS,
  ...ENTERPRISE_EVENTS,
  ...ATTRIBUTION_EVENTS,
] as const;

/** Union type of all event type strings */
export type EventType = typeof ALL_EVENT_TYPES[number];
