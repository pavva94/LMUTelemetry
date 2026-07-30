import { useEffect, useId, useMemo, useRef, useState } from "react";
import { duckdbSessionLabel, filterDuckdbSessions } from "../lib/lmuDuckdbSession";
import type { LmuDuckdbSession } from "../types/lmuDuckdb";

type Props = {
  sessions: LmuDuckdbSession[];
  selectedId: string;
  liveValue: string;
  onSelect: (value: string) => void;
  liveLabel?: string;
  liveDescription?: string;
  status?: string;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  listAriaLabel?: string;
};

export function SearchableSessionPicker({
  sessions,
  selectedId,
  liveValue,
  onSelect,
  liveLabel = "Live/current session",
  liveDescription = "Use the active telemetry session",
  status,
  searchPlaceholder = "Search track, car, session type, date, or laps",
  searchAriaLabel = "Search sessions",
  listAriaLabel = "Sessions",
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const selectedSession = sessions.find((session) => session.id === selectedId);
  const selectedLabel = selectedId === liveValue || !selectedSession ? liveLabel : duckdbSessionLabel(selectedSession);
  const visibleSessions = useMemo(
    () => filterDuckdbSessions(sessions, search, selectedId === liveValue ? undefined : selectedId),
    [search, selectedId, sessions, liveValue],
  );

  const close = () => {
    setOpen(false);
    setSearch("");
  };

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  const select = (value: string) => {
    onSelect(value);
    close();
  };

  return (
    <div className="searchable-session-picker" ref={pickerRef}>
      <button
        type="button"
        className="searchable-session-trigger"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        onClick={() => open ? close() : setOpen(true)}
      >
        <span>{selectedLabel}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="searchable-session-popover">
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
            }}
            placeholder={searchPlaceholder}
            aria-label={searchAriaLabel}
          />
          <div className="searchable-session-options" id={listboxId} role="listbox" aria-label={listAriaLabel}>
            <button type="button" className="searchable-session-option" role="option" aria-selected={selectedId === liveValue} onClick={() => select(liveValue)}>
              <strong>{liveLabel}</strong>
              <small>{liveDescription}</small>
            </button>
            {visibleSessions.map((session) => (
              <button type="button" className="searchable-session-option" role="option" aria-selected={session.id === selectedId} onClick={() => select(session.id)} key={session.id}>
                <span>{duckdbSessionLabel(session)}</span>
              </button>
            ))}
            {!visibleSessions.length && search.trim() && <span className="searchable-session-empty">No matching saved sessions</span>}
          </div>
          <span className="searchable-session-result-count">{status ? `${status} · ` : ""}{visibleSessions.length}/{sessions.length} saved sessions</span>
        </div>
      )}
    </div>
  );
}
