// ============================================================================
// Peripheral Agentic OS — Central EventBus (217 event types)
// ============================================================================

import EventEmitter from 'eventemitter3';
import { v4 as uuid } from 'uuid';
import type { PAOSEvent, EventHandler, EventSubscription, EventCategory } from '../types/events.js';

/**
 * Central EventBus for the entire system.
 * All modules emit and subscribe to typed events through this bus.
 * Supports wildcards, once-subscriptions, and event persistence.
 */
export class EventBus {
  private emitter: EventEmitter;
  private subscriptions: Map<string, EventSubscription>;
  private eventLog: PAOSEvent[];
  private maxLogSize: number;
  private persistHandler?: (event: PAOSEvent) => Promise<void>;

  constructor(maxLogSize = 10000) {
    this.emitter = new EventEmitter();
    this.subscriptions = new Map();
    this.eventLog = [];
    this.maxLogSize = maxLogSize;
  }

  /**
   * Emit a typed event to all subscribers
   */
  emit(type: string, data: Record<string, unknown>, source: string, correlationId?: string): PAOSEvent {
    const event: PAOSEvent = {
      id: uuid(),
      type,
      category: this.categorize(type),
      data,
      source,
      timestamp: new Date().toISOString(),
      correlationId,
    };

    // Store in log
    this.eventLog.push(event);
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }

    // Emit to specific type listeners
    this.emitter.emit(type, event);
    // Emit to wildcard listeners
    this.emitter.emit('*', event);
    // Emit to category listeners
    this.emitter.emit(`category:${event.category}`, event);

    // Persist if handler is set
    if (this.persistHandler) {
      this.persistHandler(event).catch(err => {
        console.error(`[EventBus] Failed to persist event ${type}:`, err);
      });
    }

    return event;
  }

  /**
   * Subscribe to events of a specific type
   */
  on(eventType: string, handler: EventHandler): string {
    const sub: EventSubscription = {
      id: uuid(),
      eventType,
      handler,
      once: false,
    };
    this.subscriptions.set(sub.id, sub);
    this.emitter.on(eventType, handler);
    return sub.id;
  }

  /**
   * Subscribe to a single occurrence of an event
   */
  once(eventType: string, handler: EventHandler): string {
    const sub: EventSubscription = {
      id: uuid(),
      eventType,
      handler,
      once: true,
    };
    this.subscriptions.set(sub.id, sub);
    this.emitter.once(eventType, handler);
    return sub.id;
  }

  /**
   * Unsubscribe by subscription ID
   */
  off(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;
    this.emitter.removeListener(sub.eventType, sub.handler);
    this.subscriptions.delete(subscriptionId);
    return true;
  }

  /**
   * Subscribe to all events in a category
   */
  onCategory(category: EventCategory, handler: EventHandler): string {
    return this.on(`category:${category}`, handler);
  }

  /**
   * Subscribe to all events (wildcard)
   */
  onAll(handler: EventHandler): string {
    return this.on('*', handler);
  }

  /**
   * Set a handler for persisting events to database
   */
  setPersistHandler(handler: (event: PAOSEvent) => Promise<void>): void {
    this.persistHandler = handler;
  }

  /**
   * Get recent events from in-memory log
   */
  getRecentEvents(count = 50, filter?: { type?: string; category?: EventCategory }): PAOSEvent[] {
    let events = [...this.eventLog];
    if (filter?.type) {
      events = events.filter(e => e.type === filter.type);
    }
    if (filter?.category) {
      events = events.filter(e => e.category === filter.category);
    }
    return events.slice(-count);
  }

  /**
   * Get event count by category
   */
  getEventCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const event of this.eventLog) {
      counts[event.category] = (counts[event.category] || 0) + 1;
    }
    return counts;
  }

  /**
   * Clear all subscriptions and log
   */
  clear(): void {
    this.emitter.removeAllListeners();
    this.subscriptions.clear();
    this.eventLog = [];
  }

  /**
   * Get subscription count
   */
  get subscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get event log size
   */
  get logSize(): number {
    return this.eventLog.length;
  }

  /**
   * Categorize an event type string into its category
   */
  private categorize(type: string): EventCategory {
    const prefix = type.split(':')[0];
    const categoryMap: Record<string, EventCategory> = {
      system: 'system',
      task: 'task',
      agent: 'agent',
      forge: 'forge',
      swarm: 'swarm',
      router: 'router',
      judge: 'judge',
      quality: 'quality',
      memory: 'memory',
      transport: 'transport',
      marketplace: 'marketplace',
      enterprise: 'enterprise',
      attribution: 'attribution',
    };
    return categoryMap[prefix] || 'system';
  }
}

/** Singleton EventBus instance */
export const eventBus = new EventBus();
