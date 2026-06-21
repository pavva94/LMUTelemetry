import type { ChannelDefinition, ChannelKind, MotecLap, MotecSample, MotecSession, WheelPosition } from "../types/motec";

const DB_NAME = "lmu-motec-workspace";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";

const categoryMap: Array<[string, string[]]> = [
  ["Time / lap", ["Time", "Session Elapsed Time", "Lap Number", "Realtime Loss", "Delta Best", "Marker"]],
  ["Driver inputs", ["Throttle Pos", "Brake Pos", "Clutch Pos", "Steering", "Steering Wheel Position", "Steering Shaft Torque", "FFB Output", "Brake Bias Rear"]],
  ["Speed / powertrain", ["Ground Speed", "Max Straight Speed", "Min Corner Speed", "Engine RPM", "Gear", "Eng Water Temp", "Eng Oil Temp", "Fuel Level", "Battery Charge Level"]],
  ["G-forces", ["G Force Lat", "G Force Long", "G Force Vert"]],
  ["Brakes", ["Brake Temp FL", "Brake Temp FR", "Brake Temp RL", "Brake Temp RR"]],
  ["GPS / environment", ["GPS Latitude", "GPS Longitude", "Ambient Temperature", "Track Temperature"]],
  ["Wheel rotation", ["Wheel Rot Speed FL", "Wheel Rot Speed FR", "Wheel Rot Speed RL", "Wheel Rot Speed RR"]],
  ["Tyre wear", ["Tyre Wear FL", "Tyre Wear FR", "Tyre Wear RL", "Tyre Wear RR"]],
  ["Tyre pressure", ["Tyre Pressure FL", "Tyre Pressure FR", "Tyre Pressure RL", "Tyre Pressure RR"]],
  ["Tyre load", ["Tyre Load FL", "Tyre Load FR", "Tyre Load RL", "Tyre Load RR"]],
  ["Grip fraction", ["Grip Fract FL", "Grip Fract FR", "Grip Fract RL", "Grip Fract RR"]],
  ["Ride height / platform", ["Ride Height FL", "Ride Height FR", "Ride Height RL", "Ride Height RR"]],
  ["Tyre temperatures", [
    "Tyre Temp FL Outer", "Tyre Temp FL Centre", "Tyre Temp FL Inner",
    "Tyre Temp FR Outer", "Tyre Temp FR Centre", "Tyre Temp FR Inner",
    "Tyre Temp RL Outer", "Tyre Temp RL Centre", "Tyre Temp RL Inner",
    "Tyre Temp RR Outer", "Tyre Temp RR Centre", "Tyre Temp RR Inner",
  ]],
];

const derivedDefs: Array<[string, string, string[] | { op: "subtract"; a: string; b: string } | { op: "hypot"; a: string; b: string } | { op: "overlap"; brake: string; throttle: string } | { op: "min"; fields: string[] }]> = [
  ["Front Brake Temp Avg", "C", ["Brake Temp FL", "Brake Temp FR"]],
  ["Rear Brake Temp Avg", "C", ["Brake Temp RL", "Brake Temp RR"]],
  ["Front Tyre Pressure Avg", "kPa", ["Tyre Pressure FL", "Tyre Pressure FR"]],
  ["Rear Tyre Pressure Avg", "kPa", ["Tyre Pressure RL", "Tyre Pressure RR"]],
  ["Front Ride Height Avg", "mm", ["Ride Height FL", "Ride Height FR"]],
  ["Rear Ride Height Avg", "mm", ["Ride Height RL", "Ride Height RR"]],
  ["Rake", "mm", { op: "subtract", a: "Rear Ride Height Avg", b: "Front Ride Height Avg" }],
  ["Tyre Temp Avg FL", "C", ["Tyre Temp FL Outer", "Tyre Temp FL Centre", "Tyre Temp FL Inner"]],
  ["Tyre Temp Avg FR", "C", ["Tyre Temp FR Outer", "Tyre Temp FR Centre", "Tyre Temp FR Inner"]],
  ["Tyre Temp Avg RL", "C", ["Tyre Temp RL Outer", "Tyre Temp RL Centre", "Tyre Temp RL Inner"]],
  ["Tyre Temp Avg RR", "C", ["Tyre Temp RR Outer", "Tyre Temp RR Centre", "Tyre Temp RR Inner"]],
  ["Front Tyre Wear Avg", "%", ["Tyre Wear FL", "Tyre Wear FR"]],
  ["Rear Tyre Wear Avg", "%", ["Tyre Wear RL", "Tyre Wear RR"]],
  ["Left Tyre Wear Avg", "%", ["Tyre Wear FL", "Tyre Wear RL"]],
  ["Right Tyre Wear Avg", "%", ["Tyre Wear FR", "Tyre Wear RR"]],
  ["Brake/Throttle Overlap", "", { op: "overlap", brake: "Brake Pos", throttle: "Throttle Pos" }],
  ["Front Ride Height Min", "mm", { op: "min", fields: ["Ride Height FL", "Ride Height FR"] }],
  ["Rear Ride Height Min", "mm", { op: "min", fields: ["Ride Height RL", "Ride Height RR"] }],
  ["Combined G", "G", { op: "hypot", a: "G Force Lat", b: "G Force Long" }],
  ["Lap-relative time", "s", { op: "subtract", a: "Time", b: "__lapStartTime" }],
];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted && ch === "\"" && next === "\"") {
      cell += "\"";
      i += 1;
    } else if (ch === "\"") {
      quoted = !quoted;
    } else if (!quoted && ch === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

function parseCsvLine(line: string): string[] {
  const row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (quoted && ch === "\"" && next === "\"") {
      cell += "\"";
      i += 1;
    } else if (ch === "\"") {
      quoted = !quoted;
    } else if (!quoted && ch === ",") {
      row.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  return row;
}

function toNumber(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function numeric(sample: MotecSample, channel: string): number | null {
  const value = sample[channel];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function avg(sample: MotecSample, fields: string[]) {
  const values = fields.map((field) => numeric(sample, field)).filter((value): value is number => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function channelCategory(name: string) {
  return categoryMap.find(([, names]) => names.includes(name))?.[0] || "Imported";
}

function wheelPosition(name: string): WheelPosition | undefined {
  return (["FL", "FR", "RL", "RR"] as WheelPosition[]).find((wheel) => name.includes(` ${wheel}`));
}

function channelType(name: string): ChannelKind {
  if (name === "Marker") return "marker";
  if (name === "Lap Number" || name === "Time" || name === "Session Elapsed Time") return "lap";
  if (name.startsWith("GPS ")) return "gps";
  return wheelPosition(name) ? "perWheel" : "scalar";
}

function precisionFor(unit: string, name: string) {
  if (name === "Gear" || name === "Lap Number") return 0;
  if (unit === "%") return 1;
  if (unit === "s") return 3;
  return 1;
}

function scaleFor(name: string, unit: string): Pick<ChannelDefinition, "defaultMin" | "defaultMax"> {
  if (unit === "%") return { defaultMin: 0, defaultMax: 100 };
  if (name === "Gear") return { defaultMin: 0, defaultMax: 8 };
  if (unit === "G") return { defaultMin: -3, defaultMax: 3 };
  if (name.includes("Ground Speed")) return { defaultMin: 0, defaultMax: 360 };
  return {};
}

function buildChannel(name: string, unit: string, derived = false): ChannelDefinition {
  return {
    originalName: name,
    displayName: name,
    unit,
    category: derived ? "Derived" : channelCategory(name),
    type: channelType(name),
    wheelPosition: wheelPosition(name),
    defaultPrecision: precisionFor(unit, name),
    defaultGraphType: name === "Gear" ? "step" : "line",
    derived,
    ...scaleFor(name, unit),
  };
}

function applyDerivedChannels(samples: MotecSample[], channels: ChannelDefinition[]) {
  const existing = new Set(channels.map((channel) => channel.originalName));
  const lapStart = new Map<string, number>();
  samples.forEach((sample) => {
    const lap = String(sample["Lap Number"] ?? "");
    if (!lapStart.has(lap)) lapStart.set(lap, numeric(sample, "Time") ?? 0);
  });
  derivedDefs.forEach(([name, unit, rule]) => {
    samples.forEach((sample) => {
      if (Array.isArray(rule)) sample[name] = avg(sample, rule);
      else if (rule.op === "subtract") sample[name] = (numeric(sample, rule.a) ?? 0) - (rule.b === "__lapStartTime" ? lapStart.get(String(sample["Lap Number"] ?? "")) ?? 0 : numeric(sample, rule.b) ?? 0);
      else if (rule.op === "hypot") sample[name] = Math.hypot(numeric(sample, rule.a) ?? 0, numeric(sample, rule.b) ?? 0);
      else if (rule.op === "overlap") sample[name] = (numeric(sample, rule.brake) ?? 0) > 5 && (numeric(sample, rule.throttle) ?? 0) > 5;
      else if (rule.op === "min") {
        const values = rule.fields.map((field) => numeric(sample, field)).filter((value): value is number => value != null);
        sample[name] = values.length ? Math.min(...values) : null;
      }
    });
    if (!existing.has(name)) channels.push(buildChannel(name, unit, true));
  });
}

function buildLaps(samples: MotecSample[]): MotecLap[] {
  const groups = new Map<string, MotecSample[]>();
  samples.forEach((sample) => {
    const lap = String(sample["Lap Number"] ?? "Unknown");
    if (!groups.has(lap)) groups.set(lap, []);
    groups.get(lap)!.push(sample);
  });
  return Array.from(groups.entries()).map(([lapNumber, lapSamples]) => {
    const times = lapSamples.map((sample) => numeric(sample, "Time") ?? numeric(sample, "Session Elapsed Time")).filter((value): value is number => value != null);
    const speeds = lapSamples.map((sample) => numeric(sample, "Ground Speed")).filter((value): value is number => value != null);
    const cornerSpeeds = lapSamples.map((sample) => numeric(sample, "Min Corner Speed")).filter((value): value is number => value != null);
    const rpm = lapSamples.map((sample) => numeric(sample, "Engine RPM")).filter((value): value is number => value != null);
    const duration = times.length ? Math.max(...times) - Math.min(...times) : null;
    const lapIndex = Number(lapNumber);
    const reasons = [
      ...(!Number.isFinite(lapIndex) || lapIndex < 1 ? ["lap number is not a completed racing lap"] : []),
      ...(duration == null || duration < 40 || duration > 900 ? ["duration is outside 40-900 seconds"] : []),
    ];
    return {
      lapNumber,
      startTime: times.length ? Math.min(...times) : null,
      endTime: times.length ? Math.max(...times) : null,
      duration,
      sampleCount: lapSamples.length,
      maxSpeed: speeds.length ? Math.max(...speeds) : null,
      minCornerSpeed: cornerSpeeds.length ? Math.min(...cornerSpeeds) : null,
      maxRpm: rpm.length ? Math.max(...rpm) : null,
      fuelStart: numeric(lapSamples[0], "Fuel Level"),
      fuelEnd: numeric(lapSamples[lapSamples.length - 1], "Fuel Level"),
      valid: reasons.length === 0,
      quality: reasons.length ? reasons.join("; ") : "complete lap",
    };
  }).sort((a, b) => Number(a.lapNumber) - Number(b.lapNumber));
}

export function importMotecCsv(fileName: string, text: string): MotecSession {
  const rows = parseCsv(text);
  if (rows.length < 3) throw new Error("CSV must contain channel row, unit row, and at least one sample row.");
  const names = rows[0].map((value) => value.trim());
  const units = rows[1].map((value) => value.trim());
  const warnings: string[] = [];
  if (names.length !== units.length) warnings.push("Channel and unit row lengths differ.");
  const channels = names.map((name, index) => buildChannel(name, units[index] || ""));
  const samples = rows.slice(2).map((row) => {
    const sample: MotecSample = {};
    names.forEach((name, index) => {
      const raw = row[index] ?? "";
      const parsed = toNumber(raw);
      sample[name] = parsed ?? (raw.trim() ? raw.trim() : null);
    });
    return sample;
  });
  const invalidGps = samples.filter((sample) => numeric(sample, "GPS Latitude") == null || numeric(sample, "GPS Longitude") == null).length;
  if (invalidGps === samples.length) warnings.push("GPS Latitude/GPS Longitude are missing or invalid; map view will use an empty state.");
  ["Time", "Session Elapsed Time", "Lap Number"].forEach((name) => {
    if (!names.includes(name)) warnings.push(`Missing recommended channel: ${name}`);
  });
  applyDerivedChannels(samples, channels);
  const sessionTimes = samples.map((sample) => numeric(sample, "Session Elapsed Time")).filter((value): value is number => value != null);
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: fileName.replace(/\.csv$/i, ""),
    importedAt: new Date().toISOString(),
    channels,
    samples,
    laps: buildLaps(samples),
    warnings,
    minSessionTime: sessionTimes.length ? Math.min(...sessionTimes) : null,
    maxSessionTime: sessionTimes.length ? Math.max(...sessionTimes) : null,
  };
}

function buildSession(fileName: string, names: string[], units: string[], samples: MotecSample[], warnings: string[]): MotecSession {
  if (samples.length === 0) throw new Error("CSV did not contain any telemetry sample rows.");
  const channels = names.map((name, index) => buildChannel(name, units[index] || ""));
  const invalidGps = samples.filter((sample) => numeric(sample, "GPS Latitude") == null || numeric(sample, "GPS Longitude") == null).length;
  if (invalidGps === samples.length) warnings.push("GPS Latitude/GPS Longitude are missing or invalid; map view will use an empty state.");
  ["Time", "Session Elapsed Time", "Lap Number"].forEach((name) => {
    if (!names.includes(name)) warnings.push(`Missing recommended channel: ${name}`);
  });
  applyDerivedChannels(samples, channels);
  const sessionTimes = samples.map((sample) => numeric(sample, "Session Elapsed Time")).filter((value): value is number => value != null);
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: fileName.replace(/\.csv$/i, ""),
    importedAt: new Date().toISOString(),
    channels,
    samples,
    laps: buildLaps(samples),
    warnings,
    minSessionTime: sessionTimes.length ? Math.min(...sessionTimes) : null,
    maxSessionTime: sessionTimes.length ? Math.max(...sessionTimes) : null,
  };
}

export async function importMotecCsvFile(file: File, onProgress?: (progress: { rows: number; bytes: number; totalBytes: number }) => void): Promise<MotecSession> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let names: string[] | null = null;
  let units: string[] | null = null;
  const samples: MotecSample[] = [];
  const warnings: string[] = [];
  const processLine = (line: string) => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.trim()) return;
    const row = parseCsvLine(trimmed);
    if (!names) {
      names = row.map((value) => value.trim());
      return;
    }
    if (!units) {
      units = row.map((value) => value.trim());
      if (names.length !== units.length) warnings.push("Channel and unit row lengths differ.");
      return;
    }
    const sample: MotecSample = {};
    names.forEach((name, index) => {
      const raw = row[index] ?? "";
      const parsed = toNumber(raw);
      sample[name] = parsed ?? (raw.trim() ? raw.trim() : null);
    });
    samples.push(sample);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(processLine);
    onProgress?.({ rows: samples.length, bytes, totalBytes: file.size });
    if (samples.length % 10000 === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  buffer += decoder.decode();
  processLine(buffer);
  if (!names || !units) throw new Error("CSV must contain channel row, unit row, and at least one sample row.");
  onProgress?.({ rows: samples.length, bytes: file.size, totalBytes: file.size });
  return buildSession(file.name, names, units, samples, warnings);
}

function openMotecDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open telemetry database."));
  });
}

export async function saveMotecSession(session: MotecSession) {
  const db = await openMotecDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SESSION_STORE, "readwrite");
    tx.objectStore(SESSION_STORE).put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Could not save imported session."));
  });
  db.close();
}

export async function loadMotecSessions(): Promise<MotecSession[]> {
  const db = await openMotecDb();
  const sessions = await new Promise<MotecSession[]>((resolve, reject) => {
    const request = db.transaction(SESSION_STORE, "readonly").objectStore(SESSION_STORE).getAll();
    request.onsuccess = () => resolve(request.result as MotecSession[]);
    request.onerror = () => reject(request.error || new Error("Could not load imported sessions."));
  });
  db.close();
  return sessions.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export function samplesForLap(session: MotecSession | null, lapNumber: string) {
  if (!session) return [];
  if (!lapNumber) return session.samples;
  return session.samples.filter((sample) => String(sample["Lap Number"] ?? "") === lapNumber);
}

export function channelByName(session: MotecSession | null, name: string) {
  return session?.channels.find((channel) => channel.originalName === name);
}
