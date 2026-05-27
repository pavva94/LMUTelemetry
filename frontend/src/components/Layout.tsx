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
  Map,
  FileSpreadsheet,
  Radio,
  Settings,
  Table2,
  Timer,
  Wrench,
} from "lucide-react";

const items = [
  ["live", "Live Dashboard", Gauge],
  ["motec", "MoTeC CSV", FileSpreadsheet],
  ["race-info", "Race Info", Activity],
  ["driving", "Driving", Wrench],
  ["track-map", "Track Map", Map],
  ["circle-map", "Circle Map", CircleDot],
  ["lap-compare", "Lap Compare", GitCompare],
  ["one-lap", "One-Lap Timing", Timer],
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

export type PageKey = (typeof items)[number][0];

export function Layout({ page, setPage, connected, children }: { page: PageKey; setPage: (page: PageKey) => void; connected: boolean; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1 className="brand">LMU Race Strategy Assistant</h1>
        <nav className="nav">
          {items.map(([key, label, Icon]) => (
            <button key={key} className={page === key ? "active" : ""} onClick={() => setPage(key)}>
              <Icon size={16} style={{ verticalAlign: "text-bottom", marginRight: 8 }} />{label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <strong>{items.find(([key]) => key === page)?.[1]}</strong>
          <span className={connected ? "badge green" : "badge red"}>{connected ? "Live socket" : "Reconnecting"}</span>
        </header>
        {children}
      </main>
    </div>
  );
}
