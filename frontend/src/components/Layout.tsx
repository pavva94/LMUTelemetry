import {
  Activity,
  BarChart3,
  CircleDot,
  Flag,
  FileText,
  Gauge,
  GitCompare,
  History,
  LineChart,
  FileSpreadsheet,
  Settings,
  Timer,
  UserRound,
  Wrench,
} from "lucide-react";

const liveItems = [
  ["live", "Live Dashboard", Gauge],
  ["race-info", "Race Info", Activity],
  ["circle-map", "Circle Map", CircleDot],
  ["lap-compare", "Lap Compare", GitCompare],
  ["one-lap", "Standings", Timer],
  ["race-history", "Race History", History],
  ["xy-plotter", "X-Y Plotter", LineChart],
  ["planner", "Strategy Planner", Activity],
  ["race-prep", "Session Report", FileText],
  ["pit", "Pit Window", Flag],
  ["settings", "Settings", Settings],
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
  ["csv", "CSV Analysis", "Offline MoTeC-style tools", FileSpreadsheet, csvItems],
  ["profile", "User Profile", "History and records", UserRound, profileItems],
] as const;

const items = [...liveItems, ...csvItems, ...profileItems] as const;

export type PageKey = (typeof items)[number][0];
type ModeKey = (typeof modes)[number][0];

const pageDescriptions: Record<PageKey, string> = {
  live: "Live telemetry for the current LMU session: speed, inputs, tyres, brakes, fuel, warnings, and real-time strategy signals.",
  "race-info": "Live race context built from the current telemetry stream, focused on fuel, tyres, pace, and position while the session is running.",
  "circle-map": "Live competitor placement and traffic awareness based on current shared-memory telemetry.",
  "lap-compare": "Live and recent lap traces for comparing pace, inputs, fuel, tyres, and setup channels from the active session.",
  "one-lap": "Current-session standings and timing built from live competitor telemetry.",
  "race-history": "Current-session lap, stint, event, and recommendation history built from temporary live telemetry summaries.",
  "xy-plotter": "Custom plots for live and current-session channels while detailed telemetry is still available.",
  planner: "Strategy assumptions and planning tools that combine live telemetry with configurable race targets.",
  "race-prep": "Selected-session report builder for reviewing pace, fuel, tyres, environment, and preparation notes.",
  pit: "Pit-window guidance based on current strategy assumptions and live session state.",
  settings: "Configuration for connection, display, recording behavior, and strategy assumptions.",
  motec: "Offline CSV analysis workspace for imported MoTeC-style files and their persisted summaries.",
  profile: "Lifetime profile and personal records; global totals include all completed sessions, even sessions removed from visible history.",
  review: "Saved session history based on compact aggregated summaries; remove sessions here to hide them from saved-session analytics.",
};

const firstPageByMode: Record<ModeKey, PageKey> = {
  live: "live",
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
  const [, modeLabel, , , activeItems] = activeMode;
  const isCsvMode = activeMode[0] === "csv";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1 className="brand">LMU Race Strategy Assistant</h1>
        <div className="mode-menu" aria-label="Main modes">
          {modes.map(([key, label, description, Icon]) => (
            <button key={key} className={activeMode[0] === key ? "active" : ""} onClick={() => setPage(firstPageByMode[key])}>
              <Icon size={18} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="nav-section-title">{modeLabel}</div>
        <nav className="nav">
          {activeItems.map(([key, label, Icon]) => (
            <button key={key} className={page === key ? "active" : ""} onClick={() => setPage(key)}>
              <Icon size={16} style={{ verticalAlign: "text-bottom", marginRight: 8 }} />{label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <strong>{items.find(([key]) => key === page)?.[1]}</strong>
            <span className="topbar-mode">{modeLabel}</span>
            <span className="topbar-description">{pageDescriptions[page]}</span>
          </div>
          <span className={isCsvMode ? "badge blue" : connected ? "badge green" : "badge red"}>{isCsvMode ? "Offline analysis" : connected ? "Live socket" : "Reconnecting"}</span>
        </header>
        {children}
      </main>
    </div>
  );
}
