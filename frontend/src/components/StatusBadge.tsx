export function StatusBadge({ value }: { value?: string | boolean }) {
  const text = typeof value === "boolean" ? (value ? "Connected" : "Offline") : value || "Unknown";
  const lower = text.toLowerCase();
  const color = lower.includes("high") || lower.includes("offline") || lower.includes("critical") ? "red" : lower.includes("medium") || lower.includes("fcy") ? "amber" : lower.includes("connected") || lower.includes("low") || lower.includes("green") ? "green" : "blue";
  return <span className={`badge ${color}`}>{text}</span>;
}
