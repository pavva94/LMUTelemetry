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
  Settings,
  Signal,
  Timer,
  UserRound,
} from "lucide-react";
import { useT } from "../i18n/I18nProvider";

const liveItems = [
  ["live", "navigation.liveDashboard", Gauge],
  ["circle-map", "navigation.circleMap", CircleDot],
  ["lap-compare", "navigation.lapStats", GitCompare],
  ["one-lap", "navigation.standings", Timer],
  ["race-history", "navigation.sessionHistory", History],
  ["xy-plotter", "navigation.xyPlotter", LineChart],
  ["lap-analysis", "navigation.driverCoach", Microscope],
  ["pit", "navigation.pitWindow", Flag],
  ["settings", "navigation.settings", Settings],
] as const;

const planItems = [
  ["planner", "navigation.strategyPlanner", Activity],
  ["race-prep", "navigation.sessionReport", FileText],
] as const;

const profileItems = [
  ["profile", "navigation.userProfile", UserRound],
  ["review", "navigation.sessionReview", BarChart3],
] as const;

const modes = [
  ["live", "navigation.liveMode", "navigation.liveModeDescription", Gauge, liveItems],
  ["plan", "navigation.planMode", "navigation.planModeDescription", FileText, planItems],
  ["profile", "navigation.profileMode", "navigation.profileModeDescription", UserRound, profileItems],
] as const;

const items = [...liveItems, ...planItems, ...profileItems] as const;

export type PageKey = (typeof items)[number][0];
type ModeKey = (typeof modes)[number][0];

const pageDescriptions: Record<PageKey, string> = {
  live: "navigation.descriptions.live",
  "circle-map": "navigation.descriptions.circleMap",
  "lap-compare": "navigation.descriptions.lapCompare",
  "one-lap": "navigation.descriptions.standings",
  "race-history": "navigation.descriptions.raceHistory",
  "xy-plotter": "navigation.descriptions.xyPlotter",
  planner: "navigation.descriptions.planner",
  "race-prep": "navigation.descriptions.racePrep",
  "lap-analysis": "navigation.descriptions.lapAnalysis",
  pit: "navigation.descriptions.pit",
  settings: "navigation.descriptions.settings",
  profile: "navigation.descriptions.profile",
  review: "navigation.descriptions.review",
};

const firstPageByMode: Record<ModeKey, PageKey> = {
  live: "live",
  plan: "planner",
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
  const t = useT();
  const activeMode = modeForPage(page);
  const [, modeLabelKey, modeDescriptionKey, ActiveModeIcon, activeItems] = activeMode;
  const activePage = items.find(([key]) => key === page);
  const modeLabel = t(modeLabelKey);
  const modeDescription = t(modeDescriptionKey);
  const activePageLabel = activePage?.[1] ? t(activePage[1]) : t("common.dashboard");
  const isOfflineMode = activeMode[0] === "profile" || activeMode[0] === "plan";
  const statusText = isOfflineMode ? t("common.offlineAnalysis") : connected ? t("common.liveSocket") : t("common.reconnecting");
  const statusClass = isOfflineMode ? "blue" : connected ? "green" : "red";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <Flag size={18} />
          </div>
          <div>
            <h1 className="brand">{t("common.appName")}</h1>
            <span className="brand-subtitle">{t("common.appSubtitle")}</span>
          </div>
        </div>
        <div className="mode-menu" aria-label={t("navigation.mainModes")}>
          {modes.map(([key, labelKey, descriptionKey, Icon]) => (
            <button key={key} className={activeMode[0] === key ? "active" : ""} onClick={() => setPage(firstPageByMode[key])} aria-current={activeMode[0] === key ? "page" : undefined}>
              <Icon size={18} />
              <span>
                <strong>{t(labelKey)}</strong>
                <small>{t(descriptionKey)}</small>
              </span>
              <ChevronRight className="mode-chevron" size={15} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="nav-section-title">
          <span>{modeLabel}</span>
          <small>{t("common.panels", { count: activeItems.length })}</small>
        </div>
        <nav className="nav">
          {activeItems.map(([key, labelKey, Icon]) => (
            <button key={key} className={page === key ? "active" : ""} onClick={() => setPage(key)} aria-current={page === key ? "page" : undefined}>
              <Icon size={16} />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <span className="mode-flag"><ActiveModeIcon size={16} /> {modeLabel}</span>
            <strong>{activePageLabel}</strong>
            <span className="topbar-description">{t(pageDescriptions[page])}</span>
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
