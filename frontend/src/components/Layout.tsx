import {
  Activity,
  BarChart3,
  ChevronRight,
  CircleDot,
  Cloud,
  Flag,
  FileText,
  Microscope,
  Gauge,
  History,
  LineChart,
  RadioTower,
  Settings,
  Timer,
  UserRound,
} from "lucide-react";
import { useT } from "../i18n/I18nProvider";

const liveItems = [
  ["live", "navigation.liveDashboard", Gauge],
  ["circle-map", "navigation.circleMap", CircleDot],
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

const teamItems = [
  ["live", "navigation.liveDashboard", Gauge],
  ["circle-map", "navigation.circleMap", CircleDot],
  ["one-lap", "navigation.standings", Timer],
  ["race-history", "navigation.sessionHistory", History],
  ["xy-plotter", "navigation.xyPlotter", LineChart],
  ["pit", "navigation.pitWindow", Flag],
] as const;

const modes = [
  ["live", "navigation.liveMode", "navigation.liveModeDescription", Gauge, liveItems],
  ["plan", "navigation.planMode", "navigation.planModeDescription", FileText, planItems],
  ["profile", "navigation.profileMode", "navigation.profileModeDescription", UserRound, profileItems],
] as const;

const items = [...liveItems, ...planItems, ...profileItems] as const;

export type PageKey = (typeof items)[number][0] | "team-session";
export type ViewMode = "local" | "team";
type ModeKey = (typeof modes)[number][0];

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
  viewMode,
  setViewMode,
  publishing,
  teamOnly = false,
  teamReady = true,
  teamSummary,
  children,
}: {
  page: PageKey;
  setPage: (page: PageKey) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  publishing?: boolean;
  teamOnly?: boolean;
  teamReady?: boolean;
  teamSummary?: { connected: boolean; viewerCount: number; activeDriver?: string | null; sessionCode: string };
  children: React.ReactNode;
}) {
  const t = useT();
  const activeMode = modeForPage(page);
  const [, modeLabelKey, , , localActiveItems] = activeMode;
  const activeItems = viewMode === "team" ? teamItems : localActiveItems;
  const modeLabel = viewMode === "team" ? "Team Race Engineer" : t(modeLabelKey);
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
        {!teamOnly && <div className="mode-menu" aria-label={t("navigation.mainModes")}>
          <button className={viewMode === "team" ? "active team-mode-button" : "team-mode-button"} onClick={() => setViewMode("team")} aria-current={viewMode === "team" ? "page" : undefined}>
            <RadioTower size={18} />
            <span>
              <strong>Team Race Engineer</strong>
              <small>Watch the active driver from the shared team session</small>
            </span>
            {publishing && <i className="publishing-dot" title="This PC is publishing" />}
            <ChevronRight className="mode-chevron" size={15} aria-hidden="true" />
          </button>
          {modes.map(([key, labelKey, descriptionKey, Icon]) => (
            <button key={key} className={viewMode === "local" && activeMode[0] === key ? "active" : ""} onClick={() => { setViewMode("local"); setPage(firstPageByMode[key]); }} aria-current={viewMode === "local" && activeMode[0] === key ? "page" : undefined}>
              <Icon size={18} />
              <span>
                <strong>{t(labelKey)}</strong>
                <small>{t(descriptionKey)}</small>
              </span>
              <ChevronRight className="mode-chevron" size={15} aria-hidden="true" />
            </button>
          ))}
        </div>}
        <div className="nav-section-title">
          <span>{modeLabel}</span>
          {viewMode !== "team" && <small>{t("common.panels", { count: activeItems.length })}</small>}
        </div>
        {viewMode === "team" && (
          <nav className="nav">
            <button className={`team-session-nav ${page === "team-session" ? "active" : ""}`} onClick={() => setPage("team-session")} aria-current={page === "team-session" ? "page" : undefined}>
              <Cloud size={16} />
              <span className="team-session-nav-copy">
                <strong>Team Session</strong>
                {teamSummary
                  ? <small><i className={teamSummary.connected ? "online" : ""} />{teamSummary.viewerCount} viewer{teamSummary.viewerCount === 1 ? "" : "s"} · {teamSummary.connected ? "live" : "reconnecting"}<b>{teamSummary.activeDriver || teamSummary.sessionCode}</b></small>
                  : <small>Join or create a session</small>}
              </span>
            </button>
          </nav>
        )}
        {viewMode === "team" && (
          <div className="nav-section-title">
            <span>Team Race Engineering panels</span>
            <small>{t("common.panels", { count: activeItems.length })}</small>
          </div>
        )}
        <nav className="nav">
          {activeItems.map(([key, labelKey, Icon]) => (
            <button key={key} className={page === key ? "active" : ""} onClick={() => setPage(key)} aria-current={page === key ? "page" : undefined} disabled={viewMode === "team" && !teamReady}>
              <Icon size={16} />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        {children}
      </main>
    </div>
  );
}
