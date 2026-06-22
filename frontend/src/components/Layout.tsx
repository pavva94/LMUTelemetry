import {
  Activity,
  BarChart3,
  ChevronRight,
  CircleDot,
  Flag,
  FileText,
  Microscope,
  Gauge,
  GitCompare,
  History,
  LineChart,
  FileSpreadsheet,
  Settings,
  Signal,
  Timer,
  UserRound,
} from "lucide-react";

const liveItems = [
  ["live", "Live Dashboard", Gauge],
  ["circle-map", "Circle Map", CircleDot],
  ["lap-compare", "Lap Stats", GitCompare],
  ["one-lap", "Standings", Timer],
  ["race-history", "Session History", History],
  ["xy-plotter", "X-Y Plotter", LineChart],
  ["lap-analysis", "Driver Coach", Microscope],
  ["pit", "Pit Window", Flag],
  ["settings", "Settings", Settings],
] as const;

const planItems = [
  ["planner", "Strategy Planner", Activity],
  ["race-prep", "Session Report", FileText],
] as const;

const csvItems = [
  ["motec", "MoTeC Workspace", FileSpreadsheet],
] as const;

const profileItems = [
  ["profile", "User Profile", UserRound],
  ["review", "Session Review", BarChart3],
] as const;

const modes = [
  ["live", "Live Mode", "Real-time telemetry", Gauge, liveItems],
  ["plan", "Plan Mode", "Strategy and session reports", FileText, planItems],
  ["csv", "CSV Analysis", "Offline MoTeC-style tools", FileSpreadsheet, csvItems],
  ["profile", "User Profile", "DuckDB career and review", UserRound, profileItems],
] as const;

const items = [...liveItems, ...planItems, ...csvItems, ...profileItems] as const;

export type PageKey = (typeof items)[number][0];
type ModeKey = (typeof modes)[number][0];

const pageDescriptions: Record<PageKey, string> = {
  live: "Live telemetry for the current LMU session: speed, inputs, tyres, brakes, fuel, warnings, and real-time strategy signals.",
  "circle-map": "Live competitor placement and traffic awareness based on current shared-memory telemetry.",
  "lap-compare": "Live and recent lap traces for comparing pace, inputs, fuel, tyres, and setup channels from the active session.",
  "one-lap": "Current-session standings and timing built from live competitor telemetry.",
  "race-history": "Current-session lap, stint, event, and recommendation history built from temporary live telemetry summaries.",
  "xy-plotter": "Custom plots for live and current-session channels while detailed telemetry is still available.",
  planner: "Strategy assumptions and planning tools that combine live telemetry with configurable race targets.",
  "race-prep": "Selected-session report builder for reviewing pace, fuel, tyres, environment, and preparation notes.",
  "lap-analysis": "Whole-session coaching from every clean lap: where time is lost, what repeats, and what to try next.",
  pit: "Pit-window guidance based on current strategy assumptions and live session state.",
  settings: "Configuration for connection, display, recording behavior, and strategy assumptions.",
  motec: "Offline CSV analysis workspace for imported MoTeC-style files and their persisted summaries.",
  profile: "DuckDB-only career profile and personal records built from the configured Le Mans Ultimate telemetry folder.",
  review: "Read-only DuckDB session review using cached file metadata and raw samples loaded on demand from the selected database.",
};

const firstPageByMode: Record<ModeKey, PageKey> = {
  live: "live",
  plan: "planner",
  csv: "motec",
  profile: "profile",
};

function modeForPage(page: PageKey) {
  return modes.find(([, , , , modeItems]) => modeItems.some(([key]) => key === page)) || modes[0];
}

export function Layout({
  page,
  setPage,
  connected,
  children,
}: {
  page: PageKey;
  setPage: (page: PageKey) => void;
  connected: boolean;
  children: React.ReactNode;
}) {
  const activeMode = modeForPage(page);
  const [, modeLabel, modeDescription, ActiveModeIcon, activeItems] = activeMode;
  const activePage = items.find(([key]) => key === page);
  const activePageLabel = activePage?.[1] || "Dashboard";
  const isOfflineMode = activeMode[0] === "csv" || activeMode[0] === "profile" || activeMode[0] === "plan";
  const statusText = isOfflineMode ? "Offline analysis" : connected ? "Live socket" : "Reconnecting";
  const statusClass = isOfflineMode ? "blue" : connected ? "green" : "red";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <Flag size={18} />
          </div>
          <div>
            <h1 className="brand">LMU Race Control</h1>
            <span className="brand-subtitle">Telemetry command center</span>
          </div>
        </div>
        <div className="mode-menu" aria-label="Main modes">
          {modes.map(([key, label, description, Icon]) => (
            <button key={key} className={activeMode[0] === key ? "active" : ""} onClick={() => setPage(firstPageByMode[key])} aria-current={activeMode[0] === key ? "page" : undefined}>
              <Icon size={18} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <ChevronRight className="mode-chevron" size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="nav-section-title">
          <span>{modeLabel}</span>
          <small>{activeItems.length} panels</small>
        </div>
        <nav className="nav">
          {activeItems.map(([key, label, Icon]) => (
            <button key={key} className={page === key ? "active" : ""} onClick={() => setPage(key)} aria-current={page === key ? "page" : undefined}>
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <span className="mode-flag"><ActiveModeIcon size={16} /> {modeLabel}</span>
            <strong>{activePageLabel}</strong>
            <span className="topbar-description">{pageDescriptions[page]}</span>
          </div>
          <div className="topbar-status" aria-label={`Current mode: ${modeDescription}`}>
            <span className={`socket-light ${statusClass}`} aria-hidden="true" />
            <span className={`badge ${statusClass}`}><Signal size={13} />{statusText}</span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
