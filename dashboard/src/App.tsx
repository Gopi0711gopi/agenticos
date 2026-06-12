import { useState } from 'react';
import { useApi, postApi } from './hooks/useApi';

// ======================== Types ========================
interface HealthData { status: string; version: string; name: string; uptime: number }
interface StatusData { mode: string; events: number; subscriptions: number }
interface CostData { totalSpent: number; taskCount: number; avgCostPerTask: number }
interface MemoryStats { working: number; episodic: number; semantic: number; procedural: number }
interface EventCounts { [key: string]: number }
interface PAOSEvent { id: string; type: string; category: string; source: string; timestamp: string; data: Record<string, unknown> }

// ======================== Tab Definitions ========================
const TABS = [
  { id: 'overview', label: 'Overview', icon: '◉', section: 'Core' },
  { id: 'tasks', label: 'Tasks', icon: '⚡', section: 'Core' },
  { id: 'agents', label: 'Agents', icon: '🤖', section: 'Core' },
  { id: 'topologies', label: 'Topologies', icon: '◎', section: 'Core' },
  { id: 'forge', label: 'Forge', icon: '🔨', section: 'Intelligence' },
  { id: 'router', label: 'Router', icon: '🔀', section: 'Intelligence' },
  { id: 'models', label: 'Models', icon: '🧠', section: 'Intelligence' },
  { id: 'judge', label: 'Judge', icon: '⚖', section: 'Quality' },
  { id: 'consensus', label: 'Consensus', icon: '🗳', section: 'Quality' },
  { id: 'goodhart', label: 'Goodhart', icon: '📊', section: 'Quality' },
  { id: 'drift', label: 'Drift', icon: '📉', section: 'Quality' },
  { id: 'trilemma', label: 'Trilemma', icon: '△', section: 'Quality' },
  { id: 'contracts', label: 'Contracts', icon: '📜', section: 'Quality' },
  { id: 'memory', label: 'Memory', icon: '💾', section: 'Memory' },
  { id: 'events', label: 'Events', icon: '📡', section: 'System' },
  { id: 'cost', label: 'Cost', icon: '💰', section: 'System' },
  { id: 'attribution', label: 'Attribution', icon: '🔏', section: 'System' },
  { id: 'marketplace', label: 'Marketplace', icon: '🏪', section: 'System' },
  { id: 'audit', label: 'Audit', icon: '📋', section: 'Enterprise' },
  { id: 'credentials', label: 'Credentials', icon: '🔑', section: 'Enterprise' },
  { id: 'workflows', label: 'Workflows', icon: '⛓', section: 'Enterprise' },
  { id: 'teams', label: 'Teams', icon: '👥', section: 'Enterprise' },
  { id: 'console', label: 'Console', icon: '▸', section: 'Tools' },
  { id: 'health', label: 'Health', icon: '♥', section: 'Tools' },
];

// ======================== Tab Components ========================
function OverviewTab() {
  const { data: health } = useApi<HealthData>('/health', 5000);
  const { data: status } = useApi<StatusData>('/status', 5000);
  const { data: cost } = useApi<CostData>('/cost/summary', 10000);
  const { data: mem } = useApi<MemoryStats>('/memory/stats', 10000);
  const { data: counts } = useApi<EventCounts>('/events/counts', 5000);

  const totalEvents = counts ? Object.values(counts).reduce((s, v) => s + v, 0) : 0;

  return (<>
    <div className="grid-4 mb-24">
      <div className="stat-card"><div className="stat-label">Status</div><div className="stat-value green">{health?.status || '...'}</div><div className="stat-change">v{health?.version}</div></div>
      <div className="stat-card"><div className="stat-label">Mode</div><div className="stat-value purple">{status?.mode || '...'}</div><div className="stat-change">{status?.subscriptions ?? 0} subscriptions</div></div>
      <div className="stat-card"><div className="stat-label">Total Tasks</div><div className="stat-value cyan">{cost?.taskCount ?? 0}</div><div className="stat-change">${cost?.totalSpent?.toFixed(6) ?? '0'} spent</div></div>
      <div className="stat-card"><div className="stat-label">Events</div><div className="stat-value blue">{totalEvents}</div><div className="stat-change">{counts ? Object.keys(counts).length : 0} categories</div></div>
    </div>
    <div className="grid-3 mb-24">
      <div className="stat-card"><div className="stat-label">Uptime</div><div className="stat-value cyan">{health ? formatUptime(health.uptime) : '...'}</div></div>
      <div className="stat-card"><div className="stat-label">Avg Cost/Task</div><div className="stat-value yellow">${cost?.avgCostPerTask?.toFixed(6) ?? '0'}</div></div>
      <div className="stat-card"><div className="stat-label">Memory Entries</div><div className="stat-value purple">{mem ? (mem.working + mem.episodic + mem.semantic + mem.procedural) : 0}</div></div>
    </div>
    <div className="card">
      <div className="card-header"><span className="card-title">Memory Distribution</span></div>
      <div className="bar-row"><span className="bar-label">Working</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min((mem?.working ?? 0) * 10, 100)}%` }}></div></div><span className="bar-value">{mem?.working ?? 0}</span></div>
      <div className="bar-row"><span className="bar-label">Episodic</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min((mem?.episodic ?? 0) * 10, 100)}%` }}></div></div><span className="bar-value">{mem?.episodic ?? 0}</span></div>
      <div className="bar-row"><span className="bar-label">Semantic</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min((mem?.semantic ?? 0) * 10, 100)}%` }}></div></div><span className="bar-value">{mem?.semantic ?? 0}</span></div>
      <div className="bar-row"><span className="bar-label">Procedural</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min((mem?.procedural ?? 0) * 10, 100)}%` }}></div></div><span className="bar-value">{mem?.procedural ?? 0}</span></div>
    </div>
  </>);
}

function DataTableTab({ endpoint, title, columns }: { endpoint: string; title: string; columns: { key: string; label: string; render?: (v: any, row: any) => any }[] }) {
  const { data, loading, refresh } = useApi<any[]>(endpoint, 15000);
  return (
    <div className="card">
      <div className="card-header"><span className="card-title">{title}</span><button className="btn" onClick={refresh}>↻ Refresh</button></div>
      {loading ? <div className="loading"><div className="spinner" /></div> :
        !data || data.length === 0 ? <div className="empty"><div className="empty-icon">📭</div><div className="empty-text">No data yet</div></div> :
        <div className="table-container"><table><thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>
          {data.map((row: any, i: number) => <tr key={i}>{columns.map(c => <td key={c.key}>{c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}</td>)}</tr>)}
        </tbody></table></div>}
    </div>
  );
}

function TasksTab() {
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const run = async () => { if (!prompt.trim()) return; setRunning(true); try { await postApi('/tasks', { prompt, budget: 1.0, taskType: 'custom' }); setPrompt(''); } finally { setRunning(false); } };

  return (<>
    <div className="card mb-24">
      <div className="card-title" style={{ marginBottom: 12 }}>Run New Task</div>
      <textarea className="input" placeholder="Describe your task..." value={prompt} onChange={e => setPrompt(e.target.value)} style={{ marginBottom: 12 }} />
      <button className="btn btn-primary" onClick={run} disabled={running}>{running ? '⏳ Running...' : '⚡ Run Task'}</button>
    </div>
    <DataTableTab endpoint="/tasks" title="Task History" columns={[
      { key: 'id', label: 'ID', render: (v: string) => <span className="mono">{v?.substring(0, 8)}</span> },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status', render: (v: string) => <span className={`badge ${v}`}>{v}</span> },
      { key: 'budget', label: 'Budget', render: (v: number) => `$${v?.toFixed(2) ?? '0'}` },
      { key: 'spent', label: 'Spent', render: (v: number) => `$${v?.toFixed(6) ?? '0'}` },
      { key: 'created_at', label: 'Created', render: (v: string) => v ? new Date(v).toLocaleString() : '—' },
    ]} />
  </>);
}

function TopologiesTab() {
  const topos = ['sequential','parallel','hierarchical','dag','mixture','debate','mesh','star','circular','grid','forest','maker'];
  const descriptions: Record<string,string> = {
    sequential: 'Chain — agents execute one after another, passing output forward',
    parallel: 'Fan-out — all agents run simultaneously, results merged',
    hierarchical: 'Manager decomposes task, workers execute, manager synthesizes',
    dag: 'Directed acyclic graph with dependency-based parallel execution',
    mixture: 'N generators propose, 1 aggregator synthesizes best answer',
    debate: 'Proposer-critic rounds until consensus or max iterations',
    mesh: 'All-to-all broadcast with convergence detection',
    star: 'Hub agent coordinates spoke agents in radial pattern',
    circular: 'Ring topology — each agent refines previous output',
    grid: '2D cellular automaton with 4-neighbor refinement rounds',
    forest: 'Multiple independent tree hierarchies with cross-tree synthesis',
    maker: 'Democratic voting — majority threshold for approval',
  };
  return (
    <div className="grid-auto">
      {topos.map(t => (
        <div className="stat-card" key={t}>
          <div className="stat-label">{t.toUpperCase()}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>{descriptions[t]}</div>
        </div>
      ))}
    </div>
  );
}

function CostTab() {
  const { data: cost } = useApi<CostData>('/cost/summary', 10000);
  return (
    <div className="grid-3">
      <div className="stat-card"><div className="stat-label">Total Spent</div><div className="stat-value cyan">${cost?.totalSpent?.toFixed(6) ?? '0'}</div></div>
      <div className="stat-card"><div className="stat-label">Total Tasks</div><div className="stat-value blue">{cost?.taskCount ?? 0}</div></div>
      <div className="stat-card"><div className="stat-label">Avg Cost / Task</div><div className="stat-value yellow">${cost?.avgCostPerTask?.toFixed(6) ?? '0'}</div></div>
    </div>
  );
}

function EventsTab() {
  const { data: counts } = useApi<EventCounts>('/events/counts', 5000);
  const { data: recent } = useApi<PAOSEvent[]>('/events/recent', 5000);
  return (<>
    <div className="card mb-24">
      <div className="card-title" style={{ marginBottom: 16 }}>Event Categories</div>
      {counts && Object.entries(counts).sort((a,b) => b[1]-a[1]).map(([cat, count]) => (
        <div className="bar-row" key={cat}>
          <span className="bar-label">{cat}</span>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(count * 5, 100)}%` }}></div></div>
          <span className="bar-value">{count}</span>
        </div>
      ))}
    </div>
    <div className="card">
      <div className="card-title" style={{ marginBottom: 16 }}>Recent Events</div>
      <div className="table-container"><table><thead><tr><th>Time</th><th>Type</th><th>Source</th></tr></thead><tbody>
        {recent?.map(e => <tr key={e.id}><td className="mono">{new Date(e.timestamp).toLocaleTimeString()}</td><td>{e.type}</td><td>{e.source}</td></tr>)}
      </tbody></table></div>
    </div>
  </>);
}

function MemoryTab() {
  const { data: mem } = useApi<MemoryStats>('/memory/stats', 10000);
  const layers = mem ? [
    { name: 'Working', count: mem.working, color: 'cyan', desc: 'Volatile in-memory cache (TTL-based)' },
    { name: 'Episodic', count: mem.episodic, color: 'blue', desc: 'Event/session memories with FTS5 search' },
    { name: 'Semantic', count: mem.semantic, color: 'purple', desc: 'Long-term knowledge with trust scoring' },
    { name: 'Procedural', count: mem.procedural, color: 'green', desc: 'Learned behavioral patterns' },
  ] : [];
  return (
    <div className="grid-2">
      {layers.map(l => (
        <div className="stat-card" key={l.name}>
          <div className="stat-label">{l.name} Memory</div>
          <div className={`stat-value ${l.color}`}>{l.count}</div>
          <div className="stat-change">{l.desc}</div>
        </div>
      ))}
    </div>
  );
}

function QualityDashboard() {
  const { data: goodhart } = useApi<any[]>('/quality/goodhart');
  const { data: drift } = useApi<any[]>('/quality/drift');
  const { data: contracts } = useApi<any[]>('/quality/contracts');
  const { data: trilemma } = useApi<any[]>('/quality/trilemma');
  return (
    <div className="grid-4 mb-24">
      <div className="stat-card"><div className="stat-label">Goodhart Alerts</div><div className={`stat-value ${(goodhart?.length ?? 0) > 0 ? 'red' : 'green'}`}>{goodhart?.length ?? 0}</div></div>
      <div className="stat-card"><div className="stat-label">Drift Events</div><div className={`stat-value ${(drift?.length ?? 0) > 0 ? 'yellow' : 'green'}`}>{drift?.length ?? 0}</div></div>
      <div className="stat-card"><div className="stat-label">Contract Violations</div><div className={`stat-value ${(contracts?.length ?? 0) > 0 ? 'red' : 'green'}`}>{contracts?.length ?? 0}</div></div>
      <div className="stat-card"><div className="stat-label">Trilemma Events</div><div className={`stat-value ${(trilemma?.length ?? 0) > 0 ? 'yellow' : 'green'}`}>{trilemma?.length ?? 0}</div></div>
    </div>
  );
}

function ConsoleTab() {
  const [cmd, setCmd] = useState('');
  const [output, setOutput] = useState('Welcome to PAOS Console. Try: GET /api/health\n');

  const run = async () => {
    if (!cmd.trim()) return;
    const parts = cmd.trim().split(' ');
    const method = parts[0]?.toUpperCase() === 'POST' ? 'POST' : 'GET';
    const endpoint = parts[1] || parts[0];
    setOutput(prev => prev + `\n> ${cmd}\n`);
    try {
      const r = await fetch(endpoint, { method });
      const data = await r.json();
      setOutput(prev => prev + JSON.stringify(data, null, 2) + '\n');
    } catch (e: any) {
      setOutput(prev => prev + `Error: ${e.message}\n`);
    }
    setCmd('');
  };

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 16 }}>API Console</div>
      <div className="json-viewer" style={{ marginBottom: 12, minHeight: 300 }}>{output}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" placeholder="GET /api/health" value={cmd} onChange={e => setCmd(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
        <button className="btn btn-primary" onClick={run}>Run</button>
      </div>
    </div>
  );
}

function HealthTab() {
  const { data: health } = useApi<HealthData>('/health', 3000);
  const { data: status } = useApi<StatusData>('/status', 3000);

  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 16 }}>System Health</div>
      <div className="json-viewer">{JSON.stringify({ health, status }, null, 2)}</div>
    </div>
  );
}

// ======================== Helper ========================
function formatUptime(s: number): string {
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${Math.floor(s%60)}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}

// ======================== App ========================
export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const { data: health } = useApi<HealthData>('/health', 5000);
  const sections = [...new Set(TABS.map(t => t.section))];

  const renderTab = () => {
    switch (activeTab) {
      case 'overview': return <OverviewTab />;
      case 'tasks': return <TasksTab />;
      case 'topologies': return <TopologiesTab />;
      case 'cost': return <CostTab />;
      case 'events': return <EventsTab />;
      case 'memory': return <MemoryTab />;
      case 'console': return <ConsoleTab />;
      case 'health': return <HealthTab />;
      case 'agents': return <DataTableTab endpoint="/agents" title="Registered Agents" columns={[
        { key: 'id', label: 'ID', render: (v: string) => <span className="mono">{v?.substring(0,8)}</span> },
        { key: 'name', label: 'Name' }, { key: 'role_name', label: 'Role' },
        { key: 'state', label: 'State', render: (v:string) => <span className={`badge ${v}`}>{v}</span> },
        { key: 'tier', label: 'Tier' },
      ]} />;
      case 'forge': return <DataTableTab endpoint="/forge/designs" title="Forge Designs" columns={[
        { key: 'id', label: 'ID', render: (v:string) => <span className="mono">{v?.substring(0,8)}</span> },
        { key: 'task_type', label: 'Task Type' }, { key: 'topology', label: 'Topology' },
        { key: 'agent_count', label: 'Agents' }, { key: 'score', label: 'Score', render: (v:number) => v?.toFixed(3) },
        { key: 'created_at', label: 'Created', render: (v:string) => v ? new Date(v).toLocaleString() : '—' },
      ]} />;
      case 'router': return <DataTableTab endpoint="/router/history" title="Routing History" columns={[
        { key: 'task_id', label: 'Task', render: (v:string) => <span className="mono">{v?.substring(0,8)}</span> },
        { key: 'strategy', label: 'Strategy' }, { key: 'selected_model', label: 'Model' },
        { key: 'selected_provider', label: 'Provider' }, { key: 'cost', label: 'Cost', render: (v:number) => `$${v?.toFixed(6)}` },
        { key: 'timestamp', label: 'Time', render: (v:string) => v ? new Date(v).toLocaleTimeString() : '—' },
      ]} />;
      case 'models': return <DataTableTab endpoint="/router/catalog" title="Model Catalog" columns={[
        { key: 'id', label: 'Model ID' }, { key: 'provider', label: 'Provider' },
        { key: 'quality_score', label: 'Quality', render: (v:number) => v?.toFixed(2) },
        { key: 'cost_per_input_token', label: '$/Input Token', render: (v:number) => `$${v?.toFixed(8)}` },
        { key: 'is_local', label: 'Local', render: (v:number) => v ? '✓' : '☁' },
      ]} />;
      case 'judge': return <><QualityDashboard /><DataTableTab endpoint="/judge/verdicts" title="Judge Verdicts" columns={[
        { key: 'task_id', label: 'Task', render: (v:string) => <span className="mono">{v?.substring(0,8)}</span> },
        { key: 'judge_id', label: 'Judge' }, { key: 'model_used', label: 'Model' },
        { key: 'outcome', label: 'Outcome', render: (v:string) => <span className={`badge ${v}`}>{v}</span> },
        { key: 'score', label: 'Score', render: (v:number) => v?.toFixed(3) },
        { key: 'confidence', label: 'Confidence', render: (v:number) => v?.toFixed(2) },
      ]} /></>;
      case 'consensus': return <DataTableTab endpoint="/judge/consensus" title="Consensus Decisions" columns={[
        { key: 'task_id', label: 'Task', render: (v:string) => <span className="mono">{v?.substring(0,8)}</span> },
        { key: 'algorithm', label: 'Algorithm' },
        { key: 'outcome', label: 'Outcome', render: (v:string) => <span className={`badge ${v}`}>{v}</span> },
        { key: 'final_score', label: 'Score', render: (v:number) => v?.toFixed(3) },
        { key: 'entropy', label: 'Entropy', render: (v:number) => v?.toFixed(3) },
        { key: 'agreement_ratio', label: 'Agreement', render: (v:number) => `${(v*100)?.toFixed(0)}%` },
      ]} />;
      case 'goodhart': return <><QualityDashboard /><DataTableTab endpoint="/quality/goodhart" title="Goodhart Signals" columns={[
        { key: 'signal_type', label: 'Signal' }, { key: 'value', label: 'Value', render: (v:number) => v?.toFixed(3) },
        { key: 'threshold', label: 'Threshold', render: (v:number) => v?.toFixed(3) },
        { key: 'triggered', label: 'Triggered', render: (v:number) => v ? <span className="badge reject">YES</span> : <span className="badge approve">NO</span> },
        { key: 'risk_level', label: 'Risk' },
      ]} /></>;
      case 'drift': return <><QualityDashboard /><DataTableTab endpoint="/quality/drift" title="Drift Snapshots" columns={[
        { key: 'judge_id', label: 'Judge' }, { key: 'jsd', label: 'JSD', render: (v:number) => v?.toFixed(4) },
        { key: 'threshold', label: 'θ', render: (v:number) => v?.toFixed(3) },
        { key: 'drifted', label: 'Drifted', render: (v:number) => v ? <span className="badge reject">YES</span> : <span className="badge approve">NO</span> },
      ]} /></>;
      case 'trilemma': return <><QualityDashboard /><DataTableTab endpoint="/quality/trilemma" title="Trilemma Events" columns={[
        { key: 'task_id', label: 'Task', render: (v:string) => <span className="mono">{v?.substring(0,8)}</span> },
        { key: 'optimization_bounded', label: 'Bounded', render: (v:number) => v ? '✓' : '✗' },
        { key: 'q_delta', label: 'ΔQ', render: (v:number) => v?.toFixed(3) },
        { key: 'iteration_count', label: 'Iteration' }, { key: 'escape_hatch', label: 'Escape Hatch' },
      ]} /></>;
      case 'contracts': return <DataTableTab endpoint="/quality/contracts" title="Contract Violations" columns={[
        { key: 'task_id', label: 'Task', render: (v:string) => <span className="mono">{v?.substring(0,8)}</span> },
        { key: 'contract_name', label: 'Contract' }, { key: 'phase', label: 'Phase' },
        { key: 'details', label: 'Details' },
      ]} />;
      case 'attribution': return <div className="card"><div className="card-title" style={{ marginBottom: 16 }}>Attribution Pipeline</div>
        <div className="grid-4">{['Visible Credit','HMAC-SHA256','Steganographic','Blockchain'].map((l,i) => (
          <div className="stat-card" key={l}><div className="stat-label">Layer {i+1}</div><div className="stat-value" style={{ fontSize: 18 }}>{l}</div></div>
        ))}</div></div>;
      case 'marketplace': return <DataTableTab endpoint="/marketplace" title="Marketplace" columns={[
        { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' }, { key: 'author', label: 'Author' },
        { key: 'stars', label: 'Stars' }, { key: 'downloads', label: 'Downloads' },
      ]} />;
      case 'audit': return <DataTableTab endpoint="/audit" title="Audit Log" columns={[
        { key: 'timestamp', label: 'Time', render: (v:string) => v ? new Date(v).toLocaleString() : '—' },
        { key: 'actor', label: 'Actor' }, { key: 'action', label: 'Action' }, { key: 'details', label: 'Details' },
      ]} />;
      case 'credentials': return <div className="card"><div className="card-title" style={{ marginBottom: 16 }}>Credential Vault</div>
        <div className="empty"><div className="empty-icon">🔐</div><div className="empty-text">AES-256-GCM encrypted credential storage<br/>Set PAOS_MASTER_KEY for persistence</div></div></div>;
      case 'workflows': return <DataTableTab endpoint="/workflows" title="Workflows" columns={[
        { key: 'id', label: 'ID', render: (v:string) => <span className="mono">{v?.substring(0,8)}</span> },
        { key: 'name', label: 'Name' }, { key: 'status', label: 'Status' },
        { key: 'created_at', label: 'Created', render: (v:string) => v ? new Date(v).toLocaleString() : '—' },
      ]} />;
      case 'teams': return <DataTableTab endpoint="/teams" title="Agent Teams" columns={[
        { key: 'id', label: 'ID', render: (v:string) => <span className="mono">{v?.substring(0,8)}</span> },
        { key: 'name', label: 'Name' }, { key: 'topology', label: 'Topology' },
        { key: 'agent_count', label: 'Agents' },
        { key: 'created_at', label: 'Created', render: (v:string) => v ? new Date(v).toLocaleString() : '—' },
      ]} />;
      default: return <div className="empty"><div className="empty-icon">🚧</div><div className="empty-text">Tab: {activeTab}</div></div>;
    }
  };

  const currentTab = TABS.find(t => t.id === activeTab);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">Peripheral Agentic OS</div>
          <div className="sidebar-version">v2.0.0 · {health?.status === 'healthy' ?
            <span style={{ color: 'var(--accent-green)' }}>● online</span> :
            <span style={{ color: 'var(--accent-red)' }}>● offline</span>
          }</div>
        </div>
        {sections.map(section => (
          <div className="sidebar-section" key={section}>
            <div className="sidebar-section-title">{section}</div>
            {TABS.filter(t => t.section === section).map(tab => (
              <div key={tab.id} className={`sidebar-item ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                <span className="sidebar-icon">{tab.icon}</span>
                <span>{tab.label}</span>
              </div>
            ))}
          </div>
        ))}
      </aside>
      <main className="main">
        <div className="topbar">
          <h1>{currentTab?.icon} {currentTab?.label}</h1>
          <div className="topbar-actions">
            <span className={`status-badge ${health?.status === 'healthy' ? 'healthy' : 'error'}`}>
              <span className="status-dot"></span>
              {health?.status ?? 'connecting...'}
            </span>
            <span className="status-badge" style={{ background: 'rgba(167,139,250,0.12)', color: 'var(--accent-purple)' }}>
              {formatUptime(health?.uptime ?? 0)}
            </span>
          </div>
        </div>
        {renderTab()}
      </main>
    </div>
  );
}
