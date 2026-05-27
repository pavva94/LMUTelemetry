import { Activity, BarChart3, Flag, Gauge, Table2 } from "lucide-react";

const items = [
  ["live", "Live Dashboard", Gauge],
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
