# AgenticOS — Application-Layer AI Agent Operating System

> The first application-layer operating system for universal AI agent orchestration.

## Overview

AgenticOS is a TypeScript-based runtime that manages AI agent lifecycles, inter-agent communication, persistent state, and orchestration workflows — acting as an OS-level abstraction layer for AI agents.

## Features

- 🤖 **Universal Agent Orchestration** — Manage multiple AI agents as first-class processes
- 🔄 **Event-Driven Architecture** — Agents communicate via typed events using EventEmitter3
- 💾 **Persistent State** — SQLite-backed agent memory and configuration
- 🖥️ **CLI Dashboard** — Real-time agent monitoring and management interface
- ⚙️ **YAML Config** — Declarative agent and workflow configuration
- 🔌 **WebSocket Support** — Real-time agent-to-agent and agent-to-UI communication
- ✅ **Type-Safe** — Full TypeScript with Zod schema validation

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Web Framework:** Hono
- **Database:** SQLite (better-sqlite3)
- **Validation:** Zod
- **Events:** EventEmitter3
- **Config:** YAML
- **CLI:** Commander.js

## Project Structure

```
agenticos/
├── src/          # Core source code
├── dashboard/    # Web UI dashboard
├── config.yaml   # Agent configuration
├── data/         # Persistent storage
├── tests/        # Test suite
└── package.json
```

## Getting Started

```bash
npm install
npm run dev
```

## License

MIT
