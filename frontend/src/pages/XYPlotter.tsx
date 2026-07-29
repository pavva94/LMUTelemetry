import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Check,
  Download,
  Filter,
  FlaskConical,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { api } from "../api/client";
import { PageSection } from "../components/PageSection";
import { SectionTitle } from "../components/SectionTitle";
import { useI18n } from "../i18n/I18nProvider";
import { localize, xyPlotCatalog, type XYPlotDefinition } from "../lib/xyPlotCatalog";
import { calculatePlotDomains } from "../lib/xyPlotScale";
import type { SavedSession } from "../types/session";
import type { TelemetrySnapshot } from "../types/telemetry";
import type { XYPlotResponse, XYPoint } from "../types/xyPlot";

type Props = {
  telemetry: TelemetrySnapshot | null;
  strategy?: unknown;
  competitors?: unknown[];
};

type Filters = {
  lap: string;
  corner: string;
  speedMin: string;
  speedMax: string;
  compound: string;
  fuelMin: string;
  fuelMax: string;
  validOnly: boolean;
};

const seriesColours = ["#f3b642", "#55c7f7", "#6ee7a8", "#b59cff", "#ff8c69", "#ff7da7", "#d6e2e8"];
const fieldLabel = (field: string) => field.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const optionalNumber = (value: string) => value.trim() === "" ? null : Number(value);

const pageCopy = {
  en: {
    eyebrow: "TELEMETRY LAB",
    title: "X-Y Plotter",
    intro: "Turn recorded channels into engineering relationships. Build a custom comparison or load a curated analysis with its method and data requirements.",
    source: "Selected session",
    samples: "Source samples",
    status: "Data status",
    ready: "Ready to analyse",
    waiting: "Waiting for recorded data",
    build: "Build a Plot",
    buildHelp: "Choose the session, scope and display treatment, then compare any two numeric channels or load a curated relationship.",
    chart: "Relationship",
    chartHelp: "Every point comes from the selected session after filtering. Preset calculations run on full-resolution samples before display downsampling.",
    insight: "What to Look For",
    insightHelp: "A practical guide to reading the dots and recognising useful patterns.",
    dotLabel: "What one dot means",
    patternLabel: "Pattern to look for",
    exampleLabel: "Reference example",
    exampleNote: "Examples are reading aids, not universal setup targets. Compare like-for-like laps, corners and conditions.",
    customDot: "One filtered telemetry sample. The tooltip reports its X-channel value first and its Y-channel value second.",
    customInsight: "Look for a repeatable shape, trend or cluster rather than isolated points. Changes in slope, widening scatter, plateaus and outliers can reveal thresholds or operating-state changes; correlation alone does not prove cause.",
    customExample: "Example: if Y rises consistently as X rises, the channels have a positive relationship. A flat band means Y changes little; a widening cloud means the relationship becomes less consistent.",
    filters: "Filters & display",
    custom: "Custom channels",
    session: "Session",
    driver: "Driver",
    setup: "Setup",
    allLaps: "All laps",
    allCorners: "All corners",
    allCompounds: "All compounds",
    lap: "Lap",
    corner: "Corner",
    compound: "Tyre compound",
    speedMin: "Min speed",
    speedMax: "Max speed",
    fuelMin: "Min fuel",
    fuelMax: "Max fuel",
    xAxis: "X channel",
    yAxis: "Y channel",
    validOnly: "Valid laps only",
    trend: "Trend line",
    envelope: "Percentile envelope",
    colour: "Colour points by",
    exportPng: "Export PNG",
    exportCsv: "Export CSV",
    unavailableSetup: "Not recorded",
    player: "Player only",
    min: "Minimum",
    max: "Maximum",
    average: "Average",
    deviation: "Std deviation",
    points: "Points",
    library: "Curated Engineering Plots",
    libraryHelp: "Supported telemetry relationships, grouped by the data they use. Select any entry to load its calculation and inspect its method.",
    search: "Search plots",
    all: "All",
    available: "Available",
    unavailable: "Needs data",
    tier: "Tier",
    tier1: "Common telemetry",
    tier2: "Vehicle parameters",
    tier3: "Modelled channels",
    supported: "Supported",
    needs: "Requires",
    selected: "Selected",
    noMatch: "No supported plots match this search.",
    noSession: "No recorded session is available yet.",
    noPoints: "No points match the selected plot and filters.",
    loading: "Calculating relationship…",
    speed: "Speed",
    lapColour: "Lap",
    throttle: "Throttle",
    brake: "Brake",
    tyre: "Tyre condition",
  },
  it: {
    eyebrow: "LABORATORIO TELEMETRIA",
    title: "Grafico X-Y",
    intro: "Trasforma i canali registrati in relazioni ingegneristiche. Crea un confronto personalizzato o carica un'analisi curata con metodo e requisiti.",
    source: "Sessione selezionata",
    samples: "Campioni sorgente",
    status: "Stato dati",
    ready: "Pronto per l'analisi",
    waiting: "In attesa di dati registrati",
    build: "Crea un grafico",
    buildHelp: "Scegli sessione, ambito e visualizzazione, poi confronta due canali numerici o carica una relazione curata.",
    chart: "Relazione",
    chartHelp: "Ogni punto proviene dalla sessione selezionata dopo i filtri. I calcoli usano i campioni a piena risoluzione prima della riduzione grafica.",
    insight: "Cosa osservare",
    insightHelp: "Una guida pratica per leggere i punti e riconoscere gli andamenti utili.",
    dotLabel: "Cosa rappresenta un punto",
    patternLabel: "Andamento da cercare",
    exampleLabel: "Esempio di riferimento",
    exampleNote: "Gli esempi aiutano la lettura, non sono obiettivi universali di setup. Confronta giri, curve e condizioni equivalenti.",
    customDot: "Un campione telemetrico filtrato. Il tooltip mostra prima il valore del canale X e poi quello del canale Y.",
    customInsight: "Cerca una forma, una tendenza o un gruppo ripetibile, non punti isolati. Variazioni di pendenza, dispersione crescente, plateau e valori anomali possono rivelare soglie o cambi di stato operativo; la correlazione da sola non dimostra una causa.",
    customExample: "Esempio: se Y cresce regolarmente mentre X aumenta, i canali hanno una relazione positiva. Una fascia piatta indica che Y cambia poco; una nuvola che si allarga indica una relazione meno coerente.",
    filters: "Filtri e visualizzazione",
    custom: "Canali personalizzati",
    session: "Sessione",
    driver: "Pilota",
    setup: "Setup",
    allLaps: "Tutti i giri",
    allCorners: "Tutte le curve",
    allCompounds: "Tutte le mescole",
    lap: "Giro",
    corner: "Curva",
    compound: "Mescola pneumatici",
    speedMin: "Velocità min",
    speedMax: "Velocità max",
    fuelMin: "Carburante min",
    fuelMax: "Carburante max",
    xAxis: "Canale X",
    yAxis: "Canale Y",
    validOnly: "Solo giri validi",
    trend: "Linea di tendenza",
    envelope: "Inviluppo percentile",
    colour: "Colore punti per",
    exportPng: "Esporta PNG",
    exportCsv: "Esporta CSV",
    unavailableSetup: "Non registrato",
    player: "Solo pilota",
    min: "Minimo",
    max: "Massimo",
    average: "Media",
    deviation: "Deviazione std",
    points: "Punti",
    library: "Grafici ingegneristici curati",
    libraryHelp: "Relazioni telemetriche supportate, raggruppate per dati utilizzati. Seleziona una voce per caricarne il calcolo e vederne il metodo.",
    search: "Cerca grafici",
    all: "Tutti",
    available: "Disponibili",
    unavailable: "Richiede dati",
    tier: "Livello",
    tier1: "Telemetria comune",
    tier2: "Parametri veicolo",
    tier3: "Canali modellati",
    supported: "Supportato",
    needs: "Richiede",
    selected: "Selezionato",
    noMatch: "Nessun grafico supportato corrisponde alla ricerca.",
    noSession: "Non è ancora disponibile una sessione registrata.",
    noPoints: "Nessun punto corrisponde al grafico e ai filtri selezionati.",
    loading: "Calcolo relazione…",
    speed: "Velocità",
    lapColour: "Giro",
    throttle: "Acceleratore",
    brake: "Freno",
    tyre: "Stato pneumatici",
  },
} as const;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function pointColour(point: XYPoint, colorBy: string, bounds: { min: number; max: number }, seriesIndex: number) {
  if (point.series !== "Data") return seriesColours[seriesIndex % seriesColours.length];
  const raw = colorBy === "lap" ? point.lap
    : colorBy === "throttle" ? point.throttle
      : colorBy === "brake" ? point.brake
        : colorBy === "tyre_condition" ? point.tyre_condition
          : point.speed;
  const value = Number(raw);
  if (!Number.isFinite(value) || bounds.max <= bounds.min) return seriesColours[seriesIndex % seriesColours.length];
  const fraction = Math.max(0, Math.min(1, (value - bounds.min) / (bounds.max - bounds.min)));
  return `hsl(${198 - fraction * 158} 82% ${62 - fraction * 5}%)`;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="xy-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function PlotCard({
  definition,
  language,
  active,
  onSelect,
  copy,
}: {
  definition: XYPlotDefinition;
  language: "en" | "it";
  active: boolean;
  onSelect: () => void;
  copy: typeof pageCopy.en | typeof pageCopy.it;
}) {
  return (
    <button type="button" className={`xy-catalog-item${active ? " active" : ""}`} onClick={onSelect} aria-pressed={active}>
      <div className="xy-catalog-top">
        <span>{copy.tier} {definition.tier}</span>
        <i className={definition.supported ? "ready" : "blocked"}>
          {definition.supported ? <Check size={12} /> : <AlertTriangle size={12} />}
          {definition.supported ? copy.supported : copy.unavailable}
        </i>
      </div>
      <strong>{localize(definition.title, language)}</strong>
      <small className="xy-axes">{localize(definition.axes, language)}</small>
      <p>{localize(definition.explanation, language)}</p>
      <code>{definition.formula}</code>
      {!definition.supported && definition.requirements && <em>{copy.needs}: {localize(definition.requirements, language)}</em>}
      {active && <b>{copy.selected}</b>}
    </button>
  );
}

export function XYPlotter({ telemetry }: Props) {
  const { language, formatNumber } = useI18n();
  const copy = pageCopy[language];
  const chartRef = useRef<HTMLDivElement>(null);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [sessionId, setSessionId] = useState(telemetry?.session_id || "");
  const [activePlot, setActivePlot] = useState("gg");
  const [xChannel, setXChannel] = useState("lap_number");
  const [yChannel, setYChannel] = useState("speed_kph");
  const [filters, setFilters] = useState<Filters>({ lap: "", corner: "", speedMin: "", speedMax: "", compound: "", fuelMin: "", fuelMax: "", validOnly: true });
  const [colorBy, setColorBy] = useState("speed");
  const [showTrend, setShowTrend] = useState(false);
  const [showEnvelope, setShowEnvelope] = useState(false);
  const [data, setData] = useState<XYPlotResponse | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [filterOptions, setFilterOptions] = useState<NonNullable<XYPlotResponse["filter_options"]>>({ laps: [], corners: [], compounds: [], drivers: ["Player"], setups: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let mounted = true;
    api.sessions()
      .then((items) => {
        if (!mounted) return;
        setSessions(items);
        setSessionId((current) => current || telemetry?.session_id || items[0]?.id || "");
      })
      .catch(() => mounted && setError(copy.noSession));
    return () => { mounted = false; };
  }, [telemetry?.session_id, copy.noSession]);

  useEffect(() => {
    if (!sessionId) return;
    let mounted = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      api.xyPlot(sessionId, {
        plotId: activePlot,
        xChannel,
        yChannel,
        laps: filters.lap ? [Number(filters.lap)] : [],
        corners: filters.corner ? [filters.corner] : [],
        speedMin: optionalNumber(filters.speedMin),
        speedMax: optionalNumber(filters.speedMax),
        compound: filters.compound,
        fuelMin: optionalNumber(filters.fuelMin),
        fuelMax: optionalNumber(filters.fuelMax),
        validOnly: filters.validOnly,
        colorBy,
        trend: showTrend,
        percentileEnvelope: showEnvelope,
      }).then((result) => {
        if (!mounted) return;
        setData(result);
        if (result.available_fields?.length) setFields(result.available_fields);
        if (result.filter_options) setFilterOptions(result.filter_options);
      }).catch((reason) => {
        if (mounted) setError(reason instanceof Error ? reason.message : String(reason));
      }).finally(() => mounted && setLoading(false));
    }, 180);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [activePlot, colorBy, filters, sessionId, showEnvelope, showTrend, xChannel, yChannel]);

  const selectedSession = sessions.find((session) => session.id === sessionId);
  const activeDefinition = xyPlotCatalog.find((definition) => definition.id === activePlot);
  const series = useMemo(() => {
    const grouped = new Map<string, XYPoint[]>();
    (data?.points || []).forEach((point) => grouped.set(point.series, [...(grouped.get(point.series) || []), point]));
    return [...grouped.entries()];
  }, [data?.points]);
  const colourBounds = useMemo(() => {
    const values = (data?.points || []).map((point) => Number(colorBy === "lap" ? point.lap : colorBy === "throttle" ? point.throttle : colorBy === "brake" ? point.brake : colorBy === "tyre_condition" ? point.tyre_condition : point.speed)).filter(Number.isFinite);
    return { min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 1 };
  }, [colorBy, data?.points]);
  const axisDomains = useMemo(
    () => calculatePlotDomains(activePlot, data?.points || []),
    [activePlot, data?.points],
  );
  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLowerCase();
    return xyPlotCatalog.filter((definition) => {
      const text = `${localize(definition.title, language)} ${localize(definition.explanation, language)} ${localize(definition.axes, language)}`.toLowerCase();
      return definition.supported && (!query || text.includes(query));
    });
  }, [language, search]);

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const selectCustomAxis = (axis: "x" | "y", value: string) => {
    if (axis === "x") setXChannel(value);
    else setYChannel(value);
    setActivePlot("custom");
  };

  const exportCsv = () => {
    if (!data?.points.length) return;
    const columns: Array<keyof XYPoint> = ["x", "y", "series", "lap", "corner", "speed", "throttle", "brake", "tyre_condition", "fuel", "timestamp"];
    const rows = [columns.join(","), ...data.points.map((point) => columns.map((column) => csvCell(point[column])).join(","))];
    downloadBlob(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }), `${activePlot}-${sessionId}.csv`);
  };

  const exportPng = () => {
    const svg = chartRef.current?.querySelector("svg");
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const bounds = svg.getBoundingClientRect();
    const source = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bounds.width * scale));
      canvas.height = Math.max(1, Math.round(bounds.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      context.fillStyle = "#0b1117";
      context.fillRect(0, 0, bounds.width, bounds.height);
      context.drawImage(image, 0, 0, bounds.width, bounds.height);
      canvas.toBlob((blob) => blob && downloadBlob(blob, `${activePlot}-${sessionId}.png`), "image/png");
      URL.revokeObjectURL(url);
    };
    image.src = url;
  };

  const axisLabel = (axis: "x" | "y") => {
    const meta = data?.axes?.[axis];
    return meta ? `${meta.label}${meta.unit ? ` (${meta.unit})` : ""}` : axis === "x" ? fieldLabel(xChannel) : fieldLabel(yChannel);
  };

  return (
    <div className="page grid xy-page">
      <section className="card span-12 xy-intro">
        <div>
          <span className="eyebrow"><FlaskConical size={14} /> {copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </div>
        <div className="xy-source-summary">
          <Metric label={copy.source} value={selectedSession ? `${selectedSession.track_name || "—"} · ${selectedSession.session_type || "—"}` : telemetry?.session?.track_name || "—"} />
          <Metric label={copy.samples} value={data?.source_count ?? selectedSession?.sample_count ?? "—"} />
          <Metric label={copy.status} value={data?.points.length ? copy.ready : copy.waiting} />
        </div>
      </section>

      <PageSection number="02" title={copy.build} description={copy.buildHelp} className="xy-build-section">
        <section className="card span-12 xy-control-panel">
          <div className="xy-control-heading"><SlidersHorizontal size={17} /><strong>{copy.filters}</strong></div>
          <div className="xy-filter-grid">
            <label>{copy.session}<select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>{telemetry?.session_id && !sessions.some((session) => session.id === telemetry.session_id) && <option value={telemetry.session_id}>{telemetry.session?.track_name || "Current session"}</option>}{sessions.map((session) => <option value={session.id} key={session.id}>{session.track_name || "Unknown track"} · {session.session_type || "Session"} · {session.id.slice(0, 8)}</option>)}</select></label>
            <label>{copy.driver}<input value={copy.player} disabled /></label>
            <label>{copy.setup}<input value={copy.unavailableSetup} disabled /></label>
            <label>{copy.lap}<select value={filters.lap} onChange={(event) => updateFilter("lap", event.target.value)}><option value="">{copy.allLaps}</option>{filterOptions.laps.map((lap) => <option key={lap} value={lap}>{copy.lap} {lap}</option>)}</select></label>
            <label>{copy.corner}<select value={filters.corner} onChange={(event) => updateFilter("corner", event.target.value)}><option value="">{copy.allCorners}</option>{filterOptions.corners.map((corner) => <option key={corner}>{corner}</option>)}</select></label>
            <label>{copy.compound}<select value={filters.compound} onChange={(event) => updateFilter("compound", event.target.value)} disabled={!filterOptions.compounds.length}><option value="">{copy.allCompounds}</option>{filterOptions.compounds.map((compound) => <option key={compound}>{compound}</option>)}</select></label>
            <label>{copy.speedMin}<input type="number" value={filters.speedMin} onChange={(event) => updateFilter("speedMin", event.target.value)} placeholder="km/h" /></label>
            <label>{copy.speedMax}<input type="number" value={filters.speedMax} onChange={(event) => updateFilter("speedMax", event.target.value)} placeholder="km/h" /></label>
            <label>{copy.fuelMin}<input type="number" value={filters.fuelMin} onChange={(event) => updateFilter("fuelMin", event.target.value)} placeholder="L" /></label>
            <label>{copy.fuelMax}<input type="number" value={filters.fuelMax} onChange={(event) => updateFilter("fuelMax", event.target.value)} placeholder="L" /></label>
          </div>
          <div className="xy-custom-row">
            <span><Filter size={14} /> {copy.custom}</span>
            <label>{copy.xAxis}<select value={xChannel} onChange={(event) => selectCustomAxis("x", event.target.value)}>{fields.map((field) => <option key={field}>{field}</option>)}</select></label>
            <label>{copy.yAxis}<select value={yChannel} onChange={(event) => selectCustomAxis("y", event.target.value)}>{fields.map((field) => <option key={field}>{field}</option>)}</select></label>
            <label>{copy.colour}<select value={colorBy} onChange={(event) => setColorBy(event.target.value)}><option value="speed">{copy.speed}</option><option value="lap">{copy.lapColour}</option><option value="throttle">{copy.throttle}</option><option value="brake">{copy.brake}</option><option value="tyre_condition">{copy.tyre}</option></select></label>
          </div>
          <div className="xy-toggle-row">
            <label><input type="checkbox" checked={filters.validOnly} onChange={(event) => updateFilter("validOnly", event.target.checked)} /> {copy.validOnly}</label>
            <label><input type="checkbox" checked={showTrend} onChange={(event) => setShowTrend(event.target.checked)} /> {copy.trend}</label>
            <label><input type="checkbox" checked={showEnvelope} onChange={(event) => setShowEnvelope(event.target.checked)} /> {copy.envelope}</label>
            <span className="xy-control-spacer" />
            <button type="button" onClick={exportPng} disabled={!data?.points.length}><Download size={14} /> {copy.exportPng}</button>
            <button type="button" onClick={exportCsv} disabled={!data?.points.length}><Download size={14} /> {copy.exportCsv}</button>
          </div>
        </section>

        <section className="card span-9 xy-chart-card">
          <SectionTitle title={activeDefinition ? localize(activeDefinition.title, language) : copy.chart} help={copy.chartHelp} />
          {activeDefinition && <div className="xy-active-method"><span>{localize(activeDefinition.axes, language)}</span><code>{activeDefinition.formula}</code><p>{localize(activeDefinition.explanation, language)}</p></div>}
          {(error || data?.warnings?.length) && <div className="xy-warning"><AlertTriangle size={16} /><div>{error && <p>{error}</p>}{data?.warnings?.map((warning) => <p key={warning}>{activeDefinition && !activeDefinition.supported && activeDefinition.requirements ? `${copy.needs}: ${localize(activeDefinition.requirements, language)}` : warning}</p>)}</div></div>}
          <div className="xy-chart-wrap" ref={chartRef}>
            {loading ? <div className="xy-chart-state">{copy.loading}</div> : data?.points.length ? (
              <ResponsiveContainer width="100%" height={430}>
                <ScatterChart margin={{ top: 14, right: 18, bottom: 24, left: 10 }}>
                  <CartesianGrid stroke="#27313a" strokeDasharray="3 5" />
                  {axisDomains.x[0] <= 0 && axisDomains.x[1] >= 0 && <ReferenceLine x={0} stroke="#dbe7ed" strokeWidth={1.5} strokeOpacity={0.72} />}
                  {axisDomains.y[0] <= 0 && axisDomains.y[1] >= 0 && <ReferenceLine y={0} stroke="#dbe7ed" strokeWidth={1.5} strokeOpacity={0.72} />}
                  <XAxis type="number" dataKey="x" name={axisLabel("x")} domain={axisDomains.x} allowDataOverflow axisLine={false} tickLine={false} stroke="#8896a3" tick={{ fontSize: 10 }} label={{ value: axisLabel("x"), position: "insideBottom", offset: -14, fill: "#aebbc5", fontSize: 11 }} />
                  <YAxis type="number" dataKey="y" name={axisLabel("y")} domain={axisDomains.y} allowDataOverflow axisLine={false} tickLine={false} stroke="#8896a3" tick={{ fontSize: 10 }} width={74} label={{ value: axisLabel("y"), angle: -90, position: "insideLeft", fill: "#aebbc5", fontSize: 11 }} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    contentStyle={{ background: "#10171d", border: "1px solid #34414c", borderRadius: 4 }}
                    itemStyle={{ color: "#edf4f8" }}
                    labelStyle={{ color: "#edf4f8" }}
                    formatter={(value: number, name: string) => [formatNumber(Number(value), { maximumFractionDigits: 3 }), name]}
                  />
                  {data.envelope.length > 0 && <Scatter name="P05" data={data.envelope.map((point) => ({ x: point.x, y: point.low }))} line={{ stroke: "#55c7f7", strokeDasharray: "4 4", strokeWidth: 1.2 }} shape={() => <g />} />}
                  {data.envelope.length > 0 && <Scatter name="P95" data={data.envelope.map((point) => ({ x: point.x, y: point.high }))} line={{ stroke: "#55c7f7", strokeDasharray: "4 4", strokeWidth: 1.2 }} shape={() => <g />} />}
                  {data.trend.length > 0 && <Scatter name={copy.trend} data={data.trend} line={{ stroke: "#edf4f8", strokeWidth: 2 }} shape={() => <g />} />}
                  {series.map(([name, points], seriesIndex) => <Scatter key={name} name={name} data={points} isAnimationActive={false}>{points.map((point, index) => <Cell key={`${name}-${index}`} fill={pointColour(point, colorBy, colourBounds, seriesIndex)} />)}</Scatter>)}
                </ScatterChart>
              </ResponsiveContainer>
            ) : <div className="xy-chart-state">{sessionId ? copy.noPoints : copy.noSession}</div>}
          </div>
        </section>

        <section className="card span-3 xy-insight-card">
          <SectionTitle title={copy.insight} help={copy.insightHelp} />
          <div className="xy-insight-body">
            <strong>{activeDefinition ? localize(activeDefinition.title, language) : `${fieldLabel(xChannel)} × ${fieldLabel(yChannel)}`}</strong>
            {activeDefinition && <p>{localize(activeDefinition.explanation, language)}</p>}
            <div className="xy-reading-step">
              <span>01</span>
              <div><strong>{copy.dotLabel}</strong><p>{activeDefinition?.dotMeaning ? localize(activeDefinition.dotMeaning, language) : copy.customDot}</p></div>
            </div>
            <div className="xy-reading-step">
              <span>02</span>
              <div><strong>{copy.patternLabel}</strong><p>{activeDefinition?.whatToLookFor ? localize(activeDefinition.whatToLookFor, language) : copy.customInsight}</p></div>
            </div>
            <div className="xy-reading-step example">
              <span>03</span>
              <div><strong>{copy.exampleLabel}</strong><p>{activeDefinition?.example ? localize(activeDefinition.example, language) : copy.customExample}</p></div>
            </div>
            <small className="xy-insight-note">{copy.exampleNote}</small>
          </div>
        </section>
      </PageSection>

      <PageSection number="01" title={copy.library} description={copy.libraryHelp} className="xy-library-section">
        <section className="card span-12 xy-library">
          <div className="xy-library-toolbar">
            <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.search} /></label>
          </div>
          {([1, 2, 3] as const).map((tier) => {
            const definitions = filteredCatalog.filter((definition) => definition.tier === tier);
            if (!definitions.length) return null;
            return <div className="xy-tier" key={tier}><div className="xy-tier-heading"><span>0{tier}</span><div><strong>{copy[`tier${tier}`]}</strong><small>{definitions.length} plots</small></div></div><div className="xy-catalog-grid">{definitions.map((definition) => <PlotCard key={definition.id} definition={definition} language={language} active={activePlot === definition.id} onSelect={() => { setActivePlot(definition.id); chartRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }} copy={copy} />)}</div></div>;
          })}
          {!filteredCatalog.length && <div className="xy-chart-state">{copy.noMatch}</div>}
        </section>
      </PageSection>
    </div>
  );
}
