import { useT } from "../i18n/I18nProvider";

export function StatusBadge({ value }: { value?: string | boolean }) {
  const t = useT();
  const text = typeof value === "boolean" ? (value ? t("common.connected") : t("telemetry.offline")) : value || t("common.unknown");
  const lower = text.toLowerCase();
  const color = lower.includes("high") || lower.includes("offline") || lower.includes("critical") ? "red" : lower.includes("medium") || lower.includes("fcy") ? "amber" : lower.includes("connected") || lower.includes("low") || lower.includes("green") ? "green" : "blue";
  return <span className={`badge ${color}`}>{text}</span>;
}
