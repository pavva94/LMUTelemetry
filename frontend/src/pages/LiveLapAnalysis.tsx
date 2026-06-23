import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AlertOctagon, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight, CircleGauge, Filter, Flag, Gauge, Info, LineChart as LineChartIcon, ShieldCheck, Sparkles, Target, TrendingDown, TrendingUp, Wrench } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { SectionTitle } from "../components/SectionTitle";
import { useI18n } from "../i18n/I18nProvider";
import type { Language } from "../i18n/resources";
import { damperRows, finite, sampleAt, splitInsights, tempColor, wheels, type Wheel } from "../lib/liveTelemetryEngine";
import { formatRaceTime } from "../lib/timeFormat";
import type { CoachingFinding, CornerOpportunity, LiveLapAnalysis as LiveLapAnalysisPayload, LiveLapSample, LiveLapSummary, TelemetryInsight } from "../types/liveLapAnalysis";

const colors: Record<Wheel, string> = { fl: "#6dd6ff", fr: "#ff8c69", rl: "#91e48f", rr: "#c7a8ff" };
const wheelLabels: Record<Wheel, string> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };
const fmt = (value?: number | null, digits = 1, suffix = "") => value == null || Number.isNaN(value) ? "--" : `${value.toFixed(digits)}${suffix}`;
const signed = (value?: number | null) => value == null || Number.isNaN(value) ? "--" : `${value >= 0 ? "+" : ""}${value.toFixed(3)}s`;
const timeOf = (sample: LiveLapSample) => finite(sample.lap_time ?? sample.timestamp);

const coachLiterals: Record<string, string> = {
  "No completed live laps yet": "Nessun giro live completato",
  "Waiting for valid live laps": "In attesa di giri live validi",
  "Driver Coach ready": "Coach Pilota pronto",
  "Complete a lap to unlock Driver Coach": "Completa un giro per sbloccare il Coach Pilota",
  "No lap selected": "Nessun giro selezionato",
  "Clean lap": "Giro pulito",
  "Marked lap": "Giro marcato",
  "Too few samples": "Troppi pochi campioni",
  "Lap invalidated": "Giro invalidato",
  "Pit lane": "Corsia box",
  "Yellow flag": "Bandiera gialla",
  "Missing lap time": "Tempo giro mancante",
  "Lap time outside range": "Tempo giro fuori intervallo",
  "Live session": "Sessione live",
  "Car unavailable": "Auto non disponibile",
  "Track unavailable": "Tracciato non disponibile",
  "Session analysis controls": "Controlli analisi sessione",
  "Analysis mode": "Modalita analisi",
  "Session analysis": "Analisi sessione",
  "Compare laps": "Confronta giri",
  "All clean laps": "Tutti i giri puliti",
  "Lap": "Giro",
  "Reference": "Riferimento",
  "clean": "puliti",
  "excluded": "esclusi",
  "Collecting": "Raccolta",
  "Collecting telemetry": "Raccolta telemetria",
  "Valid": "Valido",
  "Valid but noisy": "Valido ma rumoroso",
  "Partially unreliable": "Parzialmente inaffidabile",
  "Invalid for performance analysis": "Non valido per analisi prestazionale",
  "Personal best valid lap": "Miglior giro valido personale",
  "Representative fast lap": "Giro veloce rappresentativo",
  "Clean comparable lap": "Giro pulito comparabile",
  "Excluded lap": "Giro escluso",
  "High": "Alta",
  "Medium": "Media",
  "Low": "Bassa",
  "Improving": "In miglioramento",
  "Stable": "Stabile",
  "Worsening": "In peggioramento",
  "Degrading": "In calo",
  "Entry": "Ingresso",
  "Approach": "Approccio",
  "Rotation": "Rotazione",
  "Apex": "Apex",
  "Exit": "Uscita",
  "Acceleration": "Accelerazione",
  "Whole corner": "Curva completa",
  "Clean": "Pulito",
  "Coasting": "Rilascio",
  "Brake release": "Rilascio freno",
  "Braking point": "Punto di frenata",
  "Minimum speed": "Velocita minima",
  "Throttle": "Gas",
  "Exit speed": "Velocita uscita",
  "Steering": "Sterzo",
  "Corner time": "Tempo curva",
  "On target": "In linea",
  "Close the coast gap": "Chiudi il gap in rilascio",
  "Release earlier": "Rilascia prima",
  "Stabilize the brake point": "Stabilizza il punto di frenata",
  "Protect minimum speed": "Proteggi la velocita minima",
  "Throttle sooner": "Dai gas prima",
  "Recover exit speed": "Recupera velocita in uscita",
  "Use one steering arc": "Usa un solo arco di sterzo",
  "Match the clean rhythm": "Replica il ritmo pulito",
  "This pattern repeats on slower clean laps.": "Questo pattern si ripete nei giri puliti piu lenti.",
  "Blend brake release into light throttle.": "Collega il rilascio del freno a un filo di gas.",
  "Do not solve this by braking later.": "Non risolverlo frenando piu tardi.",
  "Taper pressure sooner and let the car rotate.": "Scala la pressione prima e lascia ruotare l'auto.",
  "Avoid an abrupt pedal release.": "Evita un rilascio brusco del pedale.",
  "Use one repeatable marker before chasing distance.": "Usa un riferimento ripetibile prima di cercare metri.",
  "Later is not automatically faster.": "Piu tardi non significa automaticamente piu veloce.",
  "Settle the car once and keep the apex rolling.": "Stabilizza l'auto una volta e mantieni scorrevole l'apex.",
  "Do not add entry speed if exit suffers.": "Non aggiungere velocita in ingresso se l'uscita ne soffre.",
  "Finish rotation, then squeeze throttle earlier.": "Completa la rotazione, poi apri il gas prima e progressivamente.",
  "Do not jump straight to full throttle.": "Non saltare subito al pieno gas.",
  "Prioritize the exit line and earlier acceleration.": "Dai priorita alla traiettoria di uscita e a una accelerazione anticipata.",
  "Do not sacrifice the exit for entry speed.": "Non sacrificare l'uscita per velocita in ingresso.",
  "Make one input and let the car take a set.": "Fai un solo input e lascia che l'auto si appoggi.",
  "Do not chase the apex with more lock.": "Non inseguire l'apex aggiungendo sterzo.",
  "Repeat the timing from your strongest clean pass.": "Ripeti il timing del tuo passaggio pulito migliore.",
  "Change one phase at a time.": "Cambia una fase alla volta.",
  "No driver input thresholds exceeded": "Nessuna soglia sugli input pilota superata",
  "Brake released before 50% steering": "Freno rilasciato prima del 50% di sterzo",
  "Session verdict": "Verdetto sessione",
  "You got faster.": "Sei diventato piu veloce.",
  "Your pace dropped later.": "Il passo e calato piu avanti.",
  "Your pace is stable.": "Il passo e stabile.",
  "Drive more clean laps to build your coaching plan.": "Completa altri giri puliti per costruire il piano di coaching.",
  "Quality checks will appear after a completed lap": "I controlli qualita appariranno dopo un giro completato",
  "Best valid": "Miglior valido",
  "No clean lap": "Nessun giro pulito",
  "Typical pace": "Passo tipico",
  "Median clean pace": "Passo mediano pulito",
  "Consistency": "Costanza",
  "Robust spread": "Dispersione robusta",
  "Available": "Disponibile",
  "To theoretical best": "Dal miglior teorico",
  "02 · Circuit read": "02 - Lettura circuito",
  "Where the time goes": "Dove si perde tempo",
  "All clean laps · repeatable loss only": "Tutti i giri puliti - solo perdita ripetibile",
  "Circuit corner opportunities": "Opportunita curve circuito",
  "Corner opportunities appear after enough clean laps establish a repeatable reference.": "Le opportunita curva appaiono quando abbastanza giri puliti stabiliscono un riferimento ripetibile.",
  "03 · Priorities": "03 - Priorita",
  "Next gains": "Prossimi guadagni",
  "No repeatable coaching opportunity clears the current confidence floor.": "Nessuna opportunita di coaching ripetibile supera la soglia di confidenza attuale.",
  "Show top eight": "Mostra le prime otto",
  "04 · Corner coach": "04 - Coach curva",
  "Select a coaching finding to inspect the exact telemetry evidence.": "Seleziona un finding di coaching per ispezionare la prova telemetrica esatta.",
  "Seen": "Visto",
  "Do this": "Fai questo",
  "Avoid": "Evita",
  "Representative pattern vs strongest clean pass": "Pattern rappresentativo vs passaggio pulito migliore",
  "This lap does not contain enough clean samples inside the selected segment.": "Questo giro non contiene abbastanza campioni puliti nel segmento selezionato.",
  "Segment location": "Posizione segmento",
  "Start / finish": "Inizio / fine",
  "Segment delta": "Delta segmento",
  "Throttle point": "Punto gas",
  "Corrections": "Correzioni",
  "Session laps": "Giri sessione",
  "G-force": "Forze G",
  "Handling": "Handling",
  "Selection sync": "Sincronizzazione selezione",
  "Secondary diagnostics": "Diagnostica secondaria",
  "Engineering diagnostic charts": "Grafici diagnostica ingegneristica",
  "Rule-based findings from the selected live lap. Click a row to synchronize the deep-dive charts to that event.": "Finding rule-based dal giro live selezionato. Clicca una riga per sincronizzare i grafici deep-dive su quell'evento.",
  "Complete a clean lap to populate the engineer notepad.": "Completa un giro pulito per popolare il blocco note ingegnere.",
  "Tire data will appear once the selected lap has live tire samples.": "I dati pneumatici appariranno quando il giro selezionato avra campioni pneumatici live.",
  "Reference speed": "Velocita riferimento",
  "Selected speed": "Velocita selezionata",
  "Reference brake": "Freno riferimento",
  "Selected brake": "Freno selezionato",
  "Reference throttle": "Gas riferimento",
  "Selected throttle": "Gas selezionato",
  "Sustained lateral G": "G laterale sostenuto",
  "05 · Telemetry explorer": "05 - Esplora telemetria",
  "Inspect the engineering layer": "Ispeziona il livello ingegneristico",
  "These full-lap views preserve the raw comparison tools. Flagged samples remain visible but are excluded from coaching baselines.": "Queste viste a giro completo conservano gli strumenti di confronto grezzi. I campioni marcati restano visibili ma sono esclusi dalle baseline di coaching.",
  "Sustained load matters more than an isolated spike.": "Il carico sostenuto conta piu di un picco isolato.",
  "Compare the selected lap with your own clean reference; inferred balance signatures are possibilities, not setup verdicts.": "Confronta il giro selezionato con il tuo riferimento pulito; le firme di bilanciamento inferite sono possibilita, non verdetti setup.",
  "Legacy event findings still move the event marker across these full-lap engineering plots.": "I finding evento legacy muovono ancora il marker evento su questi grafici ingegneristici a giro completo.",
  "Use": "Uso",
  "Time": "Tempo",
  "Data": "Dati",
  "Vs usual": "Vs abituale",
  "Reason": "Motivo",
};

const coachPatterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^Turn (\d+)$/, (match) => `Curva ${match[1]}`],
  [/^Turn (\d+)[:\s][-—â€”]+\s*(.+)$/, (match) => `Curva ${match[1]} - ${coachText(match[2], "it")}`],
  [/^Turn (\d+): Clean execution through this corner\.$/, (match) => `Curva ${match[1]}: esecuzione pulita in questa curva.`],
  [/^Turn (\d+): Initial brake application is too slow\. Spike the pedal harder\.$/, (match) => `Curva ${match[1]}: l'attacco del freno e troppo lento. Dai un picco piu deciso al pedale.`],
  [/^Turn (\d+): Excessive coasting detected\. You are over-slowing\.$/, (match) => `Curva ${match[1]}: rilevato troppo rilascio. Stai rallentando troppo.`],
  [/^Turn (\d+): Releasing brakes too early before turn-in\. Trail brake deeper\.$/, (match) => `Curva ${match[1]}: rilasci il freno troppo presto prima dell'inserimento. Porta il trail braking piu dentro.`],
  [/^Turn (\d+): Over-slowing entry\. Minimum speed reached too early\.$/, (match) => `Curva ${match[1]}: ingresso troppo lento. Raggiungi la velocita minima troppo presto.`],
  [/^Turn (\d+): Under-driving mid-corner\. Grip in reserve\.$/, (match) => `Curva ${match[1]}: stai guidando sotto il limite a centro curva. C'e grip disponibile.`],
  [/^Turn (\d+): Hesitant throttle on exit\.$/, (match) => `Curva ${match[1]}: gas esitante in uscita.`],
  [/^Turn (\d+): 'Sawing' at the wheel detected\.$/, (match) => `Curva ${match[1]}: rilevate correzioni continue al volante.`],
  [/^Setup: Severe rear traction loss\. Soften rear springs\/pressure\.$/, () => "Setup: grave perdita di trazione posteriore. Ammorbidisci molle/pressioni posteriori."],
  [/^Setup: Front locking prematurely\. Move bias rearward\.$/, () => "Setup: l'anteriore blocca troppo presto. Sposta il bias verso il posteriore."],
  [/^Setup: Excessive brake dive\. Stiffen front springs\/bump\.$/, () => "Setup: affondamento in frenata eccessivo. Irrigidisci molle/bump anteriori."],
  [/^Setup: Heavy roll onto outside tires\. Stiffen Anti-Roll Bar\.$/, () => "Setup: rollio marcato sulle gomme esterne. Irrigidisci la barra antirollio."],
  [/^Aero: Front splitter bottoming out\. Stiffen front packer shims\.$/, () => "Aero: lo splitter anteriore tocca il fondo. Irrigidisci gli spessori packer anteriori."],
  [/^Setup: ([A-Z]{2}) inner shoulder overheating\. Reduce negative camber\.$/, (match) => `Setup: spalla interna ${match[1]} surriscaldata. Riduci il camber negativo.`],
  [/^Setup: ([A-Z]{2}) ballooning\. Drop cold pressure\.$/, (match) => `Setup: ${match[1]} sta lavorando al centro. Abbassa la pressione a freddo.`],
  [/^Coasting is (.+)s longer than your best clean pattern\.$/, (match) => `Il rilascio e ${match[1]}s piu lungo del tuo miglior pattern pulito.`],
  [/^Brake release is (.+)% of lap distance later\.$/, (match) => `Il rilascio del freno avviene ${match[1]}% di distanza giro piu tardi.`],
  [/^Brake onset varies by (.+)% of lap distance from the clean target\.$/, (match) => `L'attacco del freno varia di ${match[1]}% di distanza giro rispetto al target pulito.`],
  [/^Minimum speed is (.+) km\/h below your clean target\.$/, (match) => `La velocita minima e ${match[1]} km/h sotto il target pulito.`],
  [/^First throttle is (.+)% of lap distance later\.$/, (match) => `Il primo gas arriva ${match[1]}% di distanza giro piu tardi.`],
  [/^Exit speed is (.+) km\/h below your clean target\.$/, (match) => `La velocita in uscita e ${match[1]} km/h sotto il target pulito.`],
  [/^About (.+) extra steering corrections appear in slower laps\.$/, (match) => `Nei giri piu lenti compaiono circa ${match[1]} correzioni sterzo extra.`],
  [/^This corner is (.+)s slower on affected clean laps\.$/, (match) => `Questa curva e ${match[1]}s piu lenta nei giri puliti interessati.`],
  [/^(.+)s repeatable opportunity\.$/, (match) => `${match[1]}s di opportunita ripetibile.`],
  [/^Seen on laps (.+)\.$/, (match) => `Visto nei giri ${match[1]}.`],
  [/^Main gain: (.+)\.$/, (match) => `Guadagno principale: ${coachText(match[1], "it")}.`],
  [/^(\d+) laps build this coaching model$/, (match) => `${match[1]} giri costruiscono questo modello di coaching`],
  [/^(\d+) supported findings$/, (match) => `${match[1]} finding supportati`],
  [/^Show all (\d+)$/, (match) => `Mostra tutti (${match[1]})`],
  [/^(\d+) of (\d+) samples flagged · preserved for inspection$/, (match) => `${match[1]} di ${match[2]} campioni marcati - conservati per ispezione`],
  [/^(\d+)% confidence$/, (match) => `${match[1]}% confidenza`],
  [/^(.+) confidence$/, (match) => `${coachText(match[1], "it")} confidenza`],
  [/^(\d+)\/(\d+) clean laps$/, (match) => `${match[1]}/${match[2]} giri puliti`],
  [/^(.+) evidence$/, (match) => `Prova ${coachText(match[1], "it").toLowerCase()}`],
  [/^(.+) used · (.+) excluded$/, (match) => `${match[1]} usati - ${match[2]} esclusi`],
  [/^(.+) samples ignored · (.+)% quality$/, (match) => `${match[1]} campioni ignorati - qualita ${match[2]}%`],
  [/^Robust P99: (.+)\. Sustained load matters more than an isolated spike\.$/, (match) => `P99 robusto: ${match[1]}. Il carico sostenuto conta piu di un picco isolato.`],
  [/^Front minus rear slip proxy against lateral G\. K_US (.+)\.$/, (match) => `Proxy slip anteriore meno posteriore rispetto al G laterale. K_US ${match[1]}.`],
  [/^(.+)s brake ramp$/, (match) => `${match[1]}s rampa freno`],
  [/^VMin (.+)s before max steering$/, (match) => `VMin ${match[1]}s prima dello sterzo massimo`],
  [/^(.+)G vs (.+)G peak$/, (match) => `${match[1]}G vs picco ${match[2]}G`],
  [/^(\d+) throttle lift(?:s)?$/, (match) => `${match[1]} lift del gas`],
  [/^(\d+) steering reversals$/, (match) => `${match[1]} inversioni sterzo`],
  [/^(.+)% rear slip$/, (match) => `${match[1]}% slip posteriore`],
  [/^Front decel (.+)% faster$/, (match) => `Decelerazione anteriore ${match[1]}% piu rapida`],
  [/^(.+)mm front drop$/, (match) => `${match[1]}mm abbassamento anteriore`],
  [/^(.+)mm roll$/, (match) => `${match[1]}mm rollio`],
  [/^(.+)mm FL at (.+)km\/h$/, (match) => `${match[1]}mm FL a ${match[2]}km/h`],
  [/^Inner (.+)C \/ outer (.+)C$/, (match) => `Interna ${match[1]}C / esterna ${match[2]}C`],
  [/^Center (.+)C \/ shoulder avg (.+)C$/, (match) => `Centro ${match[1]}C / media spalle ${match[2]}C`],
];

function coachText(text: string | null | undefined, language: Language) {
  if (!text || language !== "it") return text || "";
  const normalized = text.replace(/\s+/g, " ").trim();
  const exact = coachLiterals[normalized];
  if (exact) return exact;
  if (normalized.includes(", ")) {
    const translatedParts = normalized.split(", ").map((part) => coachLiterals[part] || part);
    if (translatedParts.some((part, index) => part !== normalized.split(", ")[index])) return translatedParts.join(", ");
  }
  const pattern = coachPatterns.find(([regex]) => regex.test(normalized));
  return pattern ? normalized.replace(pattern[0], (...parts) => pattern[1](parts as unknown as RegExpMatchArray)) : text;
}

function EmptyState({ detail, language = "en" }: { detail: string; language?: Language }) {
  return <div className="empty-state"><strong>{coachText("No completed live laps yet", language)}</strong><span>{coachText(detail, language)}</span></div>;
}

const lapStatus = (lap?: LiveLapSummary, language: Language = "en") => {
  if (!lap) return coachText("No lap selected", language);
  return lap.valid_lap === false ? coachText(lap.reason || "Marked lap", language) : coachText("Clean lap", language);
};

const lapOptionLabel = (lap: LiveLapSummary, language: Language = "en") => `${coachText("Lap", language)} ${lap.lap_number} - ${formatRaceTime(lap.lap_time)} - ${lapStatus(lap, language)}`;

function InsightIcon({ insight }: { insight: TelemetryInsight }) {
  if (insight.icon === "check") return <CheckCircle2 size={18} />;
  if (insight.icon === "wrench") return <Wrench size={18} />;
  return <AlertOctagon size={18} />;
}

function InsightCard({ title, insights, selectedTimestamp, onSelect, language }: { title: string; insights: TelemetryInsight[]; selectedTimestamp: number | null; onSelect: (insight: TelemetryInsight) => void; language: Language }) {
  return (
    <section className="card span-6 lap-analysis-notepad-card">
      <SectionTitle title={coachText(title, language)} help={coachText("Rule-based findings from the selected live lap. Click a row to synchronize the deep-dive charts to that event.", language)} />
      {insights.length ? (
        <div className="lap-insight-list">
          {insights.map((insight, index) => {
            const active = selectedTimestamp != null && insight.timestamp != null && Math.abs(selectedTimestamp - insight.timestamp) < 0.05;
            return (
              <button key={`${insight.message}-${index}`} className={`lap-insight-row ${insight.severity} ${active ? "active" : ""}`} onClick={() => onSelect(insight)}>
                <span className="lap-insight-icon"><InsightIcon insight={insight} /></span>
                <span>
                  <strong>{coachText(insight.message, language)}</strong>
                  <small>{formatRaceTime(insight.lap_time)} {insight.evidence?.length ? `/ ${insight.evidence.map((item) => coachText(item, language)).join(" / ")}` : ""}</small>
                </span>
              </button>
            );
          })}
        </div>
      ) : <EmptyState detail="Complete a clean lap to populate the engineer notepad." language={language} />}
    </section>
  );
}

function ContextHeader({ payload, selectedLap, referenceLap, setSelectedLap, setReferenceLap }: {
  payload: LiveLapAnalysisPayload;
  selectedLap: number | null;
  referenceLap: number | null;
  setSelectedLap: (lap: number | null) => void;
  setReferenceLap: (lap: number | null) => void;
}) {
  const sessionLabel = [payload.session.session_type, payload.session.track_name, payload.session.vehicle_model || payload.session.vehicle_name].filter(Boolean).join(" - ") || "Live session";
  const selectedSummary = payload.laps.find((lap) => lap.lap_number === selectedLap);
  const referenceSummary = payload.laps.find((lap) => lap.lap_number === referenceLap);
  const validCount = payload.laps.filter((lap) => lap.valid_lap !== false).length;
  return (
    <section className="card span-12 lap-analysis-sticky">
      <div className="lap-context-grid">
        <label>Session<input value={sessionLabel} readOnly /></label>
        <label>Lap<select value={selectedLap ?? ""} onChange={(event) => setSelectedLap(event.target.value ? Number(event.target.value) : null)}>
          {payload.laps.map((lap) => <option value={lap.lap_number} key={lap.lap_number}>{lapOptionLabel(lap)}</option>)}
        </select></label>
        <label>Ghost lap<select value={referenceLap ?? ""} onChange={(event) => setReferenceLap(event.target.value ? Number(event.target.value) : null)}>
          {payload.laps.map((lap) => <option value={lap.lap_number} key={lap.lap_number}>{lapOptionLabel(lap)}</option>)}
        </select></label>
        <div className="lap-metric"><span className="label">Peak combined G</span><strong>{fmt(payload.metrics.session_peak_combined_g, 2, "G")}</strong></div>
        <div className="lap-metric"><span className="label">K_US</span><strong>{fmt(payload.metrics.understeer_gradient, 4)}</strong></div>
        <div className="lap-metric"><span className="label">W_latGeom</span><strong>{fmt(payload.metrics.load_transfer_geom, 0, "N")}</strong></div>
      </div>
      <div className="lap-validity-note">
        <span>{payload.laps.length} completed laps, {validCount} clean</span>
        <span>Selected: {lapStatus(selectedSummary)}</span>
        <span>Ghost: {lapStatus(referenceSummary)}</span>
      </div>
      <div className="table-wrap lap-sector-table">
        <table>
          <thead><tr><th>Sector</th><th>Selected</th><th>Ghost</th><th>Delta</th></tr></thead>
          <tbody>{payload.sectors.map((sector) => (
            <tr key={sector.sector}><td>S{sector.sector}</td><td>{formatRaceTime(sector.time)}</td><td>{formatRaceTime(sector.reference_time)}</td><td className={sector.delta != null && sector.delta <= 0 ? "ok-text" : "warn-text"}>{signed(sector.delta)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function FrictionCircle({ current, ghost, selectedTimestamp }: { current: LiveLapSample[]; ghost: LiveLapSample[]; selectedTimestamp: number | null }) {
  const currentData = current.map((sample) => ({ x: sample.g_force_lat, y: sample.g_force_long, t: timeOf(sample) })).filter((row) => row.x != null && row.y != null);
  const ghostData = ghost.map((sample) => ({ x: sample.g_force_lat, y: sample.g_force_long })).filter((row) => row.x != null && row.y != null);
  const selected = sampleAt(current, selectedTimestamp);
  return (
    <section className="card span-6 lap-chart-card">
      <SectionTitle title="Friction Circle" help="Longitudinal G versus lateral G. The faint gray ghost shows the reference lap." />
      <ResponsiveContainer width="100%" height={310}>
        <ScatterChart>
          <CartesianGrid stroke="#27313a" />
          <XAxis type="number" dataKey="x" name="Lat G" stroke="#8896a3" domain={["dataMin - 0.2", "dataMax + 0.2"]} />
          <YAxis type="number" dataKey="y" name="Long G" stroke="#8896a3" domain={["dataMin - 0.2", "dataMax + 0.2"]} />
          <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
          <Scatter name="Ghost lap" data={ghostData} fill="#7f8c98" opacity={0.18} />
          <Scatter name="Selected lap" data={currentData} fill="#e6b450" />
          {selected?.g_force_lat != null && selected.g_force_long != null && <Scatter name="Event" data={[{ x: selected.g_force_lat, y: selected.g_force_long }]} fill="#ff6961" />}
        </ScatterChart>
      </ResponsiveContainer>
    </section>
  );
}

function TireHealthMatrix({ samples, selectedTimestamp }: { samples: LiveLapSample[]; selectedTimestamp: number | null }) {
  const sample = sampleAt(samples, selectedTimestamp);
  return (
    <section className="card span-6 lap-chart-card">
      <SectionTitle title="Tire Health Matrix" help="Inner, center, and outer tire temperatures at the selected timestamp, with live pressure overlaid." />
      {sample ? (
        <div className="tire-matrix">
          {wheels.map((wheel) => {
            const inner = finite(sample[`tyre_temp_${wheel}_inner` as keyof LiveLapSample]);
            const center = finite(sample[`tyre_temp_${wheel}_center` as keyof LiveLapSample]);
            const outer = finite(sample[`tyre_temp_${wheel}_outer` as keyof LiveLapSample]);
            const pressure = finite(sample[`tyre_pressure_${wheel}` as keyof LiveLapSample]);
            return (
              <div className={`tire-block tire-${wheel}`} key={wheel}>
                <strong>{wheelLabels[wheel]}</strong>
                <div className="tire-zones">
                  {[inner, center, outer].map((temp, index) => <span key={index} style={{ background: tempColor(temp) }}>{fmt(temp, 0)}</span>)}
                </div>
                <small>{fmt(pressure, 1)} psi</small>
              </div>
            );
          })}
        </div>
      ) : <EmptyState detail="Tire data will appear once the selected lap has live tire samples." />}
    </section>
  );
}

function HandlingDiagram({ current, selectedTimestamp, kus }: { current: LiveLapSample[]; selectedTimestamp: number | null; kus?: number | null }) {
  const selectedLatG = finite(sampleAt(current, selectedTimestamp)?.g_force_lat);
  const rows = current.map((sample) => ({
    x: sample.g_force_lat,
    y: sample.front_rear_slip_delta ?? (sample.steering_angle != null && sample.g_force_lat != null ? Number(sample.steering_angle) - Math.abs(Number(sample.g_force_lat)) * 0.02 : null),
    t: timeOf(sample),
  })).filter((row) => row.x != null && row.y != null);
  if (!rows.length) return <section className="card span-6"><SectionTitle title="Handling Diagram" help="Plots front minus rear slip angle against lateral G when available." /><EmptyState detail="Slip-angle channels are unavailable; K_US is shown in the sticky context when estimable." /></section>;
  return (
    <section className="card span-6 lap-chart-card">
      <SectionTitle title="Handling Diagram" help={`Front minus rear slip proxy against lateral G. K_US ${fmt(kus, 4)}.`} />
      <ResponsiveContainer width="100%" height={310}>
        <LineChart data={rows}>
          <CartesianGrid stroke="#27313a" />
          <XAxis dataKey="x" stroke="#8896a3" />
          <YAxis stroke="#8896a3" />
          <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
          <Line dataKey="y" name="Front - rear slip" stroke="#6dd6ff" dot={false} connectNulls />
          {selectedLatG != null && <ReferenceLine x={selectedLatG} stroke="#ff6961" strokeDasharray="4 4" />}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

function PowerOutputChart({ current, ghost, selectedTimestamp }: { current: LiveLapSample[]; ghost: LiveLapSample[]; selectedTimestamp: number | null }) {
  const currentData = current.map((sample) => ({
    rpm: finite(sample.rpm),
    power_kw: finite(sample.power_kw),
    power_hp: finite(sample.power_hp),
    t: timeOf(sample),
  })).filter((row) => row.rpm != null && row.rpm > 0 && (row.power_hp != null || row.power_kw != null));
  if (!currentData.length) return null;

  const useHp = currentData.some((row) => row.power_hp != null);
  const powerKey = useHp ? "power_hp" : "power_kw";
  const unit = useHp ? "hp" : "kW";
  const ghostData = ghost.map((sample) => ({
    rpm: finite(sample.rpm),
    power_kw: finite(sample.power_kw),
    power_hp: finite(sample.power_hp),
  })).filter((row) => row.rpm != null && row.rpm > 0 && row[powerKey] != null);
  const selected = sampleAt(current, selectedTimestamp);
  const selectedPower = selected ? finite(selected[powerKey]) : null;
  const selectedRpm = selected ? finite(selected.rpm) : null;

  return (
    <section className="card span-6 lap-chart-card">
      <SectionTitle title="Power Output" help="Derived engine power over RPM when live RPM and engine torque channels are available." />
      <ResponsiveContainer width="100%" height={310}>
        <ScatterChart>
          <CartesianGrid stroke="#27313a" />
          <XAxis type="number" dataKey="rpm" name="RPM" stroke="#8896a3" domain={["dataMin - 250", "dataMax + 250"]} tickFormatter={(value) => Number(value).toFixed(0)} />
          <YAxis type="number" dataKey={powerKey} name={`Power (${unit})`} stroke="#8896a3" domain={["dataMin - 25", "dataMax + 25"]} tickFormatter={(value) => Number(value).toFixed(0)} />
          <Tooltip
            contentStyle={{ background: "#141a20", border: "1px solid #27313a" }}
            formatter={(value, name) => {
              const numeric = Number(value);
              if (name === "rpm") return [numeric.toFixed(0), "RPM"];
              return [numeric.toFixed(useHp ? 0 : 1), `Power (${unit})`];
            }}
          />
          <Scatter name="Ghost power" data={ghostData} fill="#7f8c98" opacity={0.18} />
          <Scatter name={`Power (${unit})`} data={currentData} fill="#e6b450" />
          {selectedRpm != null && selectedPower != null && <Scatter name="Event" data={[{ rpm: selectedRpm, [powerKey]: selectedPower }]} fill="#ff6961" />}
        </ScatterChart>
      </ResponsiveContainer>
    </section>
  );
}

function SuspensionPlatform({ current, ghost, selectedTimestamp }: { current: LiveLapSample[]; ghost: LiveLapSample[]; selectedTimestamp: number | null }) {
  const rows = current.map((sample) => ({ x: timeOf(sample), ...sample }));
  const ghostRows = ghost.map((sample) => ({ x: timeOf(sample), ...sample }));
  const dampers = damperRows(current);
  return (
    <section className="card span-6 lap-chart-card">
      <SectionTitle title="Suspension & Platform" help="Top chart shows damper velocity. Bottom chart shows ride heights with ghost overlay." />
      <ResponsiveContainer width="100%" height={145}>
        <LineChart data={dampers}>
          <CartesianGrid stroke="#27313a" />
          <XAxis dataKey="x" stroke="#8896a3" hide />
          <YAxis stroke="#8896a3" />
          <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
          {wheels.map((wheel) => <Line key={wheel} dataKey={`damper_${wheel}`} name={`${wheelLabels[wheel]} damper`} stroke={colors[wheel]} dot={false} connectNulls />)}
          {selectedTimestamp != null && <ReferenceLine x={selectedTimestamp} stroke="#ff6961" strokeDasharray="4 4" />}
        </LineChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={170}>
        <LineChart data={rows}>
          <CartesianGrid stroke="#27313a" />
          <XAxis dataKey="x" stroke="#8896a3" />
          <YAxis stroke="#8896a3" />
          <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
          {wheels.map((wheel) => <Line key={`${wheel}-ghost`} data={ghostRows} dataKey={`ride_height_${wheel}_mm`} name={`${wheelLabels[wheel]} ghost`} stroke="#7f8c98" opacity={0.22} dot={false} connectNulls />)}
          {wheels.map((wheel) => <Line key={wheel} dataKey={`ride_height_${wheel}_mm`} name={`${wheelLabels[wheel]} ride`} stroke={colors[wheel]} dot={false} connectNulls />)}
          {selectedTimestamp != null && <ReferenceLine x={selectedTimestamp} stroke="#ff6961" strokeDasharray="4 4" />}
          <Legend />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

const qualityClass = (value?: string | null) => value === "Valid" ? "good" : value === "Valid but noisy" ? "watch" : "bad";
const trendIcon = (trend?: string | null) => trend === "Improving" ? <TrendingUp size={14} /> : trend === "Worsening" || trend === "Degrading" ? <TrendingDown size={14} /> : <ChevronRight size={14} />;
const sampleDistance = (sample: LiveLapSample) => finite(sample.distance_pct) ?? 0;

function SessionControls({ payload, selectedLap, referenceLap, setSelectedLap, setReferenceLap, mode, setMode, language }: {
  payload: LiveLapAnalysisPayload;
  selectedLap: number | null;
  referenceLap: number | null;
  setSelectedLap: (lap: number | null) => void;
  setReferenceLap: (lap: number | null) => void;
  mode: "session" | "compare";
  setMode: (mode: "session" | "compare") => void;
  language: Language;
}) {
  const sessionLabel = payload.session.session_type || coachText("Live session", language);
  const car = payload.session.vehicle_model || payload.session.vehicle_name || coachText("Car unavailable", language);
  const track = payload.session.track_name || coachText("Track unavailable", language);
  return (
    <header className="coach-context" aria-label={coachText("Session analysis controls", language)}>
      <div className="coach-context-identity">
        <span>{sessionLabel}</span>
        <strong>{track}</strong>
        <small>{car}</small>
      </div>
      <div className="coach-control-group">
        <div className="coach-mode-switch" aria-label={coachText("Analysis mode", language)}>
          <button className={mode === "session" ? "active" : ""} onClick={() => setMode("session")} aria-pressed={mode === "session"}>{coachText("Session analysis", language)}</button>
          <button className={mode === "compare" ? "active" : ""} onClick={() => setMode("compare")} aria-pressed={mode === "compare"}>{coachText("Compare laps", language)}</button>
        </div>
        {mode === "session" ? <div className="coach-scope"><Target size={15} /><span><strong>{coachText("All clean laps", language)}</strong><small>{coachText(`${payload.quality?.clean_laps ?? 0} laps build this coaching model`, language)}</small></span></div> : <>
          <label><span>{coachText("Lap", language)}</span><select value={selectedLap ?? ""} onChange={(event) => setSelectedLap(Number(event.target.value))}>
            {payload.laps.map((lap) => <option value={lap.lap_number} key={lap.lap_number}>{lapOptionLabel(lap, language)}</option>)}
          </select></label>
          <label><span>{coachText("Reference", language)}</span><select value={referenceLap ?? ""} onChange={(event) => setReferenceLap(Number(event.target.value))}>
            {payload.laps.filter((lap) => lap.valid_lap !== false).map((lap) => <option value={lap.lap_number} key={lap.lap_number}>{coachText("Lap", language)} {lap.lap_number} · {coachText(lap.role || lapStatus(lap), language)}</option>)}
          </select></label>
        </>}
      </div>
      <div className="coach-context-counts">
        <span><b>{payload.quality?.clean_laps ?? 0}</b> {coachText("clean", language)}</span>
        <span><b>{payload.quality?.excluded_laps ?? 0}</b> {coachText("excluded", language)}</span>
        <span className={qualityClass(payload.quality?.status)}><ShieldCheck size={14} /> {coachText(payload.quality?.status || "Collecting", language)}</span>
      </div>
    </header>
  );
}

function SessionVerdict({ payload, language }: { payload: LiveLapAnalysisPayload; language: Language }) {
  const summary = payload.session_summary;
  const quality = payload.quality;
  const potential = summary?.time_to_theoretical;
  return (
    <section className="coach-verdict" aria-labelledby="session-verdict-title">
      <div className="coach-verdict-copy">
        <span className="eyebrow"><Sparkles size={14} /> {coachText("Session verdict", language)}</span>
        <h2 id="session-verdict-title">{coachText(summary?.pace_trend === "Improving" ? "You got faster." : summary?.pace_trend === "Degrading" ? "Your pace dropped later." : "Your pace is stable.", language)}</h2>
        <p>{summary?.largest_opportunity_corner ? coachText(`Main gain: ${summary.largest_opportunity_corner}.`, language) : coachText("Drive more clean laps to build your coaching plan.", language)}</p>
        <div className={`coach-trust ${qualityClass(quality?.status)}`}><ShieldCheck size={17} /><span><strong>{coachText(quality?.status || "Collecting telemetry", language)}</strong><small>{quality ? coachText(`${quality.flagged_samples} of ${quality.total_samples} samples flagged · preserved for inspection`, language) : coachText("Quality checks will appear after a completed lap", language)}</small></span></div>
      </div>
      <div className="coach-kpi-grid">
        <div><span>{coachText("Best valid", language)}</span><strong>{formatRaceTime(summary?.best_valid_lap)}</strong><small>{summary?.best_valid_lap_number ? `${coachText("Lap", language)} ${summary.best_valid_lap_number}` : coachText("No clean lap", language)}</small></div>
        <div><span>{coachText("Typical pace", language)}</span><strong>{formatRaceTime(summary?.representative_pace)}</strong><small>{coachText("Median clean pace", language)}</small></div>
        <div><span>{coachText("Consistency", language)}</span><strong>{fmt(summary?.robust_consistency, 3, "s")}</strong><small>{coachText("Robust spread", language)}</small></div>
        <div className="opportunity"><span>{coachText("Available", language)}</span><strong>{potential != null ? `${potential.toFixed(2)}s` : "--"}</strong><small>{coachText("To theoretical best", language)}</small></div>
      </div>
    </section>
  );
}

function OpportunityMap({ corners, selectedCorner, onSelect, language }: { corners: CornerOpportunity[]; selectedCorner: number | null; onSelect: (corner: number) => void; language: Language }) {
  const max = Math.max(...corners.map((corner) => corner.opportunity), 0.01);
  return (
    <section className="coach-opportunity-map" aria-labelledby="opportunity-map-title">
      <div className="coach-section-heading"><div><span>{coachText("02 · Circuit read", language)}</span><h2 id="opportunity-map-title">{coachText("Where the time goes", language)}</h2></div><p>{coachText("All clean laps · repeatable loss only", language)}</p></div>
      {corners.length ? <div className="corner-ribbon" role="list" aria-label={coachText("Circuit corner opportunities", language)}>
        {corners.map((corner) => (
          <button key={corner.id} role="listitem" className={`corner-node ${selectedCorner === corner.id ? "active" : ""}`} onClick={() => onSelect(corner.id)} style={{ "--loss": `${Math.max(18, corner.opportunity / max * 100)}%` } as CSSProperties}>
            <span className="corner-node-index">T{corner.id}</span><i aria-hidden="true" />
            <span className="corner-node-top"><strong>{corner.opportunity.toFixed(2)}s</strong><em>{corner.affected_laps}/{corner.clean_laps} laps</em></span>
            <span className="corner-signals">{(corner.signals || [{ category: corner.category, phase: corner.phase, opportunity: corner.opportunity }]).slice(0, 2).map((signal) => <span key={`${signal.phase}-${signal.category}`}><small>{coachText(signal.phase, language)} · {coachText(signal.category, language)}</small><b>{signal.opportunity.toFixed(2)}s</b></span>)}</span>
            <em>{coachText(`${corner.confidence} confidence`, language)} · {trendIcon(corner.trend)} {coachText(corner.trend, language)}</em>
          </button>
        ))}
      </div> : <EmptyState detail="Corner opportunities appear after enough clean laps establish a repeatable reference." language={language} />}
    </section>
  );
}

function FindingList({ findings, activeId, onSelect, showAll, setShowAll, language }: { findings: CoachingFinding[]; activeId: string | null; onSelect: (finding: CoachingFinding) => void; showAll: boolean; setShowAll: (value: boolean) => void; language: Language }) {
  const visible = showAll ? findings : findings.slice(0, 8);
  return (
    <aside className="coach-findings" aria-labelledby="findings-title">
      <div className="coach-findings-head"><div><span>{coachText("03 · Priorities", language)}</span><h2 id="findings-title">{coachText("Next gains", language)}</h2></div><small>{coachText(`${findings.length} supported findings`, language)}</small></div>
      <div className="coach-finding-list">
        {visible.map((finding, index) => <button key={finding.id} className={`coach-finding ${activeId === finding.id ? "active" : ""}`} onClick={() => onSelect(finding)}>
          <span className="finding-rank">0{index + 1}</span>
          <span className="finding-main"><small>{coachText(finding.phase, language)} · {coachText(finding.category, language)}</small><strong>{coachText(finding.title, language)}</strong></span>
          <span className="finding-proof"><b>{finding.opportunity.toFixed(2)}s</b><small>{coachText(`${finding.confidence} confidence`, language)}</small><em>{trendIcon(finding.trend)} {coachText(finding.trend, language)}</em></span>
        </button>)}
        {!visible.length && <EmptyState detail="No repeatable coaching opportunity clears the current confidence floor." language={language} />}
      </div>
      {findings.length > 8 && <button className="coach-show-all" onClick={() => setShowAll(!showAll)}>{coachText(showAll ? "Show top eight" : `Show all ${findings.length}`, language)}</button>}
    </aside>
  );
}

function focusedRows(current: LiveLapSample[], reference: LiveLapSample[], finding: CoachingFinding) {
  const ref = reference.filter((sample) => sampleDistance(sample) >= finding.start_pct && sampleDistance(sample) <= finding.end_pct);
  const nearest = (distance: number) => ref.reduce<LiveLapSample | null>((best, sample) => !best || Math.abs(sampleDistance(sample) - distance) < Math.abs(sampleDistance(best) - distance) ? sample : best, null);
  return current.filter((sample) => sampleDistance(sample) >= finding.start_pct && sampleDistance(sample) <= finding.end_pct).map((sample) => {
    const ghost = nearest(sampleDistance(sample));
    return {
      x: sampleDistance(sample), speed: finite(sample.speed_kph), speedRef: finite(ghost?.speed_kph), brake: finite(sample.brake_pct), brakeRef: finite(ghost?.brake_pct),
      throttle: finite(sample.throttle_pct), throttleRef: finite(ghost?.throttle_pct), steering: finite(sample.steering_angle) != null ? Number(sample.steering_angle) * 100 : null,
      steeringRef: finite(ghost?.steering_angle) != null ? Number(ghost?.steering_angle) * 100 : null, g: finite(sample.g_force_lat) != null ? Math.abs(Number(sample.g_force_lat)) * 35 : null,
      gRef: finite(ghost?.g_force_lat) != null ? Math.abs(Number(ghost?.g_force_lat)) * 35 : null,
    };
  });
}

const metricLabel: Record<string, string> = { segment_time_delta: "Segment delta", brake_release_delta_pct: "Brake release", throttle_delta_pct: "Throttle point", exit_speed_delta: "Exit speed", coast_time_delta: "Coasting", steering_correction_delta: "Corrections" };
function metricValue(key: string, value?: number | null) {
  if (value == null) return "--";
  if (key === "segment_time_delta" || key === "coast_time_delta") return `${value >= 0 ? "+" : ""}${value.toFixed(2)}s`;
  if (key === "exit_speed_delta") return `${value >= 0 ? "+" : ""}${value.toFixed(1)} km/h`;
  if (key === "steering_correction_delta") return `${value >= 0 ? "+" : ""}${value.toFixed(0)}`;
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}% lap`;
}

function FindingDetail({ finding, current, reference, language }: { finding: CoachingFinding | null; current: LiveLapSample[]; reference: LiveLapSample[]; language: Language }) {
  if (!finding) return <section className="coach-detail"><EmptyState detail="Select a coaching finding to inspect the exact telemetry evidence." language={language} /></section>;
  const rows = focusedRows(current, reference, finding);
  const channels = new Set(finding.relevant_channels);
  return (
    <section className="coach-detail" aria-labelledby="finding-detail-title">
      <div className="coach-detail-title"><div><span>{coachText("04 · Corner coach", language)}</span><h2 id="finding-detail-title">{coachText(finding.title, language)}</h2><p>{coachText(finding.summary, language)}{finding.affected_lap_numbers?.length ? ` ${coachText(`Seen on laps ${finding.affected_lap_numbers.join(", ")}.`, language)}` : ""}</p></div><div className={`confidence-stamp ${finding.confidence.toLowerCase()}`}><strong>{coachText(finding.confidence, language)}</strong><span>{coachText(`${finding.confidence_score}% confidence`, language)}</span><small>{coachText(`${finding.affected_laps}/${finding.clean_laps} clean laps`, language)}</small></div></div>
      <div className="coach-explanation">
        <div><span>{coachText("Seen", language)}</span><p>{coachText(finding.what_happened, language)}</p></div>
        <div className="coach-try"><span>{coachText("Do this", language)}</span><p>{coachText(finding.primary_action, language)}</p></div>
        {finding.avoid && <div className="coach-avoid"><span>{coachText("Avoid", language)}</span><p>{coachText(finding.avoid, language)}</p></div>}
      </div>
      <div className="coach-trace-wrap">
        <div className="coach-trace-head"><div><LineChartIcon size={17} /><span><strong>{coachText(`${finding.phase} evidence`, language)}</strong><small>{coachText("Representative pattern vs strongest clean pass", language)}</small></span></div><span className="trace-range">{finding.start_pct.toFixed(1)}-{finding.end_pct.toFixed(1)}%</span></div>
        {rows.length ? <ResponsiveContainer width="100%" height={330}><LineChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="#253039" vertical={false} /><XAxis dataKey="x" stroke="#72808a" tickFormatter={(value) => `${Number(value).toFixed(1)}%`} /><YAxis yAxisId="speed" stroke="#8d999f" width={42} /><YAxis yAxisId="input" orientation="right" domain={[0, 100]} stroke="#8d999f" width={38} />
          <Tooltip contentStyle={{ background: "#0c1115", border: "1px solid #34414a" }} labelFormatter={(value) => `${Number(value).toFixed(2)}% lap distance`} />
          {channels.has("speed") && <><Line yAxisId="speed" dataKey="speedRef" name={coachText("Reference speed", language)} stroke="#55c7f7" strokeWidth={2} dot={false} connectNulls /><Line yAxisId="speed" dataKey="speed" name={coachText("Selected speed", language)} stroke="#f0eadc" strokeWidth={2.4} dot={false} connectNulls /></>}
          {channels.has("brake") && <><Line yAxisId="input" dataKey="brakeRef" name={coachText("Reference brake", language)} stroke="#55c7f7" strokeDasharray="4 4" dot={false} /><Line yAxisId="input" dataKey="brake" name={coachText("Selected brake", language)} stroke="#ff8c69" dot={false} /></>}
          {channels.has("throttle") && <><Line yAxisId="input" dataKey="throttleRef" name={coachText("Reference throttle", language)} stroke="#55c7f7" strokeDasharray="4 4" dot={false} /><Line yAxisId="input" dataKey="throttle" name={coachText("Selected throttle", language)} stroke="#6ee7a8" dot={false} /></>}
          {channels.has("steering") && <Line yAxisId="input" dataKey="steering" name="Steering x100" stroke="#f3b642" dot={false} />}
          {channels.has("g_force") && <Line yAxisId="input" dataKey="g" name={coachText("Sustained lateral G", language)} stroke="#b59cff" dot={false} />}
          <Legend />
        </LineChart></ResponsiveContainer> : <EmptyState detail="This lap does not contain enough clean samples inside the selected segment." language={language} />}
      </div>
      <div className="coach-evidence-footer">
        <div className="segment-minimap"><span>{coachText("Segment location", language)}</span><div><i style={{ left: `${finding.start_pct}%`, width: `${Math.max(2, finding.end_pct - finding.start_pct)}%` }} /></div><small>{coachText("Start / finish", language)}</small></div>
        <div className="coach-metrics">{Object.entries(finding.metrics).filter(([, value]) => value != null && Math.abs(Number(value)) > 0.001).map(([key, value]) => <div key={key}><span>{coachText(metricLabel[key] || key, language)}</span><strong>{metricValue(key, value)}</strong></div>)}</div>
      </div>
    </section>
  );
}

function LapQualityLedger({ laps, language }: { laps: LiveLapSummary[]; language: Language }) {
  return <section className="coach-ledger" aria-labelledby="session-laps-title"><div className="coach-ledger-head"><span><ShieldCheck size={17} /><strong id="session-laps-title">{coachText("Session laps", language)}</strong></span><small>{coachText(`${laps.filter((lap) => lap.valid_lap !== false).length} used · ${laps.filter((lap) => lap.valid_lap === false).length} excluded`, language)}</small></div>
    <div className="table-wrap"><table><thead><tr><th>{coachText("Lap", language)}</th><th>{coachText("Use", language)}</th><th>{coachText("Time", language)}</th><th>{coachText("Data", language)}</th><th>{coachText("Vs usual", language)}</th><th>{coachText("Reason", language)}</th></tr></thead><tbody>{laps.map((lap) => <tr key={lap.lap_number}><td><strong>#{lap.lap_number}</strong></td><td>{coachText(lap.role || "--", language)}</td><td>{formatRaceTime(lap.lap_time)}</td><td><span className={`quality-word ${qualityClass(lap.quality_state)}`}>{coachText(lap.quality_state || lapStatus(lap), language)}</span></td><td>{signed(lap.gap_to_representative)}</td><td>{coachText(lap.reason || `${lap.flagged_samples || 0} samples ignored · ${lap.quality_score ?? "--"}% quality`, language)}</td></tr>)}</tbody></table></div>
  </section>;
}

export function LiveLapAnalysis() {
  const { language } = useI18n();
  const [payload, setPayload] = useState<LiveLapAnalysisPayload | null>(null);
  const [selectedLap, setSelectedLap] = useState<number | null>(null);
  const [referenceLap, setReferenceLap] = useState<number | null>(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(null);
  const [status, setStatus] = useState("Waiting for valid live laps");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [selectedCorner, setSelectedCorner] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<"session" | "compare">("session");

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const data = await api.liveLapAnalysis(selectedLap, referenceLap);
        if (cancelled) return;
        setPayload(data);
        setSelectedLap((current) => data.laps.some((lap) => lap.lap_number === current) ? current : data.selected_lap_number ?? null);
        setReferenceLap((current) => data.laps.some((lap) => lap.lap_number === current) ? current : data.reference_lap_number ?? null);
        setSelectedTimestamp((current) => {
          const stillInLap = current != null && data.current_lap_data.some((sample) => {
            const time = timeOf(sample);
            return time != null && Math.abs(time - current) < 0.05;
          });
          return stillInLap ? current : data.insights.find((item) => item.timestamp != null)?.timestamp ?? data.current_lap_data[0]?.lap_time ?? null;
        });
        setStatus(data.laps.length ? "Driver Coach ready" : "Complete a lap to unlock Driver Coach");
      } catch (exc) {
        if (!cancelled) setStatus(exc instanceof Error ? exc.message : String(exc));
      } finally {
        if (!cancelled) timer = window.setTimeout(load, 2500);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [selectedLap, referenceLap]);

  const insights = useMemo(() => splitInsights(payload?.insights || []), [payload?.insights]);
  const findings = useMemo(() => (payload?.findings || []).filter((finding) => selectedCorner == null || finding.corner_id === selectedCorner), [payload?.findings, selectedCorner]);
  const selectedFinding = useMemo(() => (payload?.findings || []).find((finding) => finding.id === selectedFindingId) || findings[0] || null, [payload?.findings, selectedFindingId, findings]);
  useEffect(() => {
    if (selectedFinding && selectedFinding.id !== selectedFindingId) setSelectedFindingId(selectedFinding.id);
  }, [selectedFinding, selectedFindingId]);
  if (!payload) return <div className="page grid"><section className="card span-12"><EmptyState detail={status} language={language} /></section></div>;
  const handleInsight = (insight: TelemetryInsight) => {
    if (insight.timestamp != null) setSelectedTimestamp(insight.timestamp);
  };
  const chooseCorner = (corner: number) => { setSelectedCorner((current) => current === corner ? null : corner); const match = (payload.findings || []).find((finding) => finding.corner_id === corner); if (match) setSelectedFindingId(match.id); };
  const changeMode = (mode: "session" | "compare") => {
    setAnalysisMode(mode);
    if (mode === "session") {
      setSelectedLap(payload.references?.representative_pace_lap ?? payload.session_summary?.representative_lap_number ?? selectedLap);
      setReferenceLap(payload.references?.personal_best_lap ?? referenceLap);
    }
  };
  return <div className="page lap-analysis-page coach-page">
    <SessionControls payload={payload} selectedLap={selectedLap} referenceLap={referenceLap} setSelectedLap={setSelectedLap} setReferenceLap={setReferenceLap} mode={analysisMode} setMode={changeMode} language={language} />
    {!payload.laps.length ? <section className="coach-empty"><Flag size={26} /><EmptyState detail={status} language={language} /></section> : <>
      <SessionVerdict payload={payload} language={language} />
      <OpportunityMap corners={payload.corner_opportunities || []} selectedCorner={selectedCorner} onSelect={chooseCorner} language={language} />
      <div className="coach-workspace">
        <FindingList findings={findings} activeId={selectedFinding?.id || null} onSelect={(finding) => setSelectedFindingId(finding.id)} showAll={showAll} setShowAll={setShowAll} language={language} />
        <FindingDetail finding={selectedFinding} current={payload.current_lap_data} reference={payload.reference_lap_data} language={language} />
      </div>
      <section className="coach-explorer" aria-labelledby="telemetry-explorer-title">
        <div className="coach-section-heading"><div><span>{coachText("05 · Telemetry explorer", language)}</span><h2 id="telemetry-explorer-title">{coachText("Inspect the engineering layer", language)}</h2></div><p>{coachText("These full-lap views preserve the raw comparison tools. Flagged samples remain visible but are excluded from coaching baselines.", language)}</p></div>
        <div className="coach-graph-notes"><div><Gauge size={17} /><span><strong>{coachText("G-force", language)}</strong><small>{coachText(`Robust P99: ${fmt(payload.session_summary?.robust_peak_combined_g, 2, "G")}. Sustained load matters more than an isolated spike.`, language)}</small></span></div><div><CircleGauge size={17} /><span><strong>{coachText("Handling", language)}</strong><small>{coachText("Compare the selected lap with your own clean reference; inferred balance signatures are possibilities, not setup verdicts.", language)}</small></span></div><div><Info size={17} /><span><strong>{coachText("Selection sync", language)}</strong><small>{coachText("Legacy event findings still move the event marker across these full-lap engineering plots.", language)}</small></span></div></div>
        <div className="coach-explorer-workspace">
          <aside className="coach-diagnostics-rail" aria-label={coachText("Secondary diagnostics", language)}>
            <InsightCard title="Secondary diagnostics" insights={[...insights.driver, ...insights.setup]} selectedTimestamp={selectedTimestamp} onSelect={handleInsight} language={language} />
          </aside>
          <div className="coach-diagnostic-charts" aria-label={coachText("Engineering diagnostic charts", language)}>
            <FrictionCircle current={payload.current_lap_data} ghost={payload.reference_lap_data} selectedTimestamp={selectedTimestamp} />
            <TireHealthMatrix samples={payload.current_lap_data} selectedTimestamp={selectedTimestamp} />
            <HandlingDiagram current={payload.current_lap_data} selectedTimestamp={selectedTimestamp} kus={payload.metrics.understeer_gradient} />
            <PowerOutputChart current={payload.current_lap_data} ghost={payload.reference_lap_data} selectedTimestamp={selectedTimestamp} />
            <SuspensionPlatform current={payload.current_lap_data} ghost={payload.reference_lap_data} selectedTimestamp={selectedTimestamp} />
          </div>
        </div>
      </section>
      <LapQualityLedger laps={payload.laps} language={language} />
    </>}
  </div>;
}
