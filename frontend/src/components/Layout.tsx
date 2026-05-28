import {
  Activity,
  BarChart3,
  CircleDot,
  ClipboardList,
  Flag,
  Gauge,
  GitCompare,
  History,
  LineChart,
  FileSpreadsheet,
  Radio,
  Settings,
  Table2,
  Timer,
  UserRound,
  Wrench,
} from "lucide-react";

const liveItems = [
  ["live", "Live Dashboard", Gauge],
  ["race-info", "Race Info", Activity],
  ["driving", "Driving", Wrench],
  ["circle-map", "Circle Map", CircleDot],
  ["lap-compare", "Lap Compare", GitCompare],
  ["one-lap", "Standings", Timer],
  ["field-spread", "Field Spread", Radio],
  ["race-history", "Race History", History],
  ["xy-plotter", "X-Y Plotter", LineChart],
  ["stint-data", "Stint Data", ClipboardList],
  ["opponent-stats", "Opponent Stats", Table2],
  ["race-control", "Race Control", Flag],
  ["settings", "Settings", Settings],
  ["planner", "Strategy Planner", Activity],
  ["pit", "Pit Window", Flag],
  ["competitors", "Competitors", Table2],
  ["review", "Session Review", BarChart3],
] as const;

const csvItems = [
  ["motec", "MoTeC Workspace", FileSpreadsheet],
] as const;

const profileItems = [
  ["profile", "User Profile", UserRound],
] as const;

const modes = [
  ["live", "Live Mode", "Real-time telemetry", Gauge, liveItems],
  ["csv", "CSV Analysis", "Offline MoTeC-style tools", FileSpreadsheet, csvItems],
  ["profile", "User Profile", "History and records", UserRound, profileItems],
] as const;

const items = [...liveItems, ...csvItems, ...profileItems] as const;

export type PageKey = (typeof items)[number][0];
type ModeKey = (typeof modes)[number][0];

const firstPageByMode: Record<ModeKey, PageKey> = {
  live: "live",
  csv: "motec",
  profile: "profile",
};

function modeForPage(page: PageKey) {
  return modes.find(([, , , , modeItems]) => modeItems.some(([key]) => key === page)) || modes[0];
}

export function Layout({ page, setPage, connected, children }: { page: PageKey; setPage: (page: PageKey) => void; connected: boolean; children: React.ReactNode }) {
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
          </div>
          <span className={isCsvMode ? "badge blue" : connected ? "badge green" : "badge red"}>{isCsvMode ? "Offline analysis" : connected ? "Live socket" : "Reconnecting"}</span>
        </header>
        {children}
      </main>
    </div>
  );
}
