// ============================================================================
// Peripheral Agentic OS — Centralized Message Hub
// ============================================================================

import { v4 as uuid } from 'uuid';
import { eventBus } from '../core/event-bus.js';
import type { TopologyMessage } from '../types/topology.js';

/**
 * Centralized message hub for inter-agent communication.
 * All topology message passing flows through this hub.
 */
export class MsgHub {
  private messages: Map<string, TopologyMessage[]>;  // agentId → messages
  private allMessages: TopologyMessage[];
  private currentRound: number;

  constructor() {
    this.messages = new Map();
    this.allMessages = [];
    this.currentRound = 0;
  }

  /** Send a message from one agent to another */
  send(from: string, to: string, content: string): TopologyMessage {
    const msg: TopologyMessage = {
      id: uuid(),
      from,
      to,
      content,
      round: this.currentRound,
      timestamp: new Date().toISOString(),
    };

    // Store in recipient's inbox
    if (!this.messages.has(to)) {
      this.messages.set(to, []);
    }
    this.messages.get(to)!.push(msg);
    this.allMessages.push(msg);

    eventBus.emit('swarm:message_routed', {
      messageId: msg.id,
      from,
      to,
      round: this.currentRound,
    }, 'MsgHub');

    return msg;
  }

  /** Broadcast a message from one agent to all others */
  broadcast(from: string, content: string, exclude: string[] = []): TopologyMessage[] {
    const messages: TopologyMessage[] = [];
    for (const [agentId] of this.messages) {
      if (agentId !== from && !exclude.includes(agentId)) {
        messages.push(this.send(from, agentId, content));
      }
    }
    return messages;
  }

  /** Get all messages for an agent */
  getMessages(agentId: string): TopologyMessage[] {
    return this.messages.get(agentId) || [];
  }

  /** Get messages for an agent in a specific round */
  getMessagesForRound(agentId: string, round: number): TopologyMessage[] {
    return (this.messages.get(agentId) || []).filter(m => m.round === round);
  }

  /** Register an agent in the hub */
  registerAgent(agentId: string): void {
    if (!this.messages.has(agentId)) {
      this.messages.set(agentId, []);
    }
  }

  /** Advance to next round */
  nextRound(): number {
    this.currentRound++;
    eventBus.emit('swarm:round_started', { round: this.currentRound }, 'MsgHub');
    return this.currentRound;
  }

  /** Get current round */
  getRound(): number {
    return this.currentRound;
  }

  /** Get total message count */
  getTotalMessages(): number {
    return this.allMessages.length;
  }

  /** Check if any new messages arrived in the current round */
  hasNewMessages(round: number): boolean {
    return this.allMessages.some(m => m.round === round);
  }

  /** Clear all messages */
  clear(): void {
    this.messages.clear();
    this.allMessages = [];
    this.currentRound = 0;
  }

  /** Get all agent IDs registered */
  getRegisteredAgents(): string[] {
    return [...this.messages.keys()];
  }
}
