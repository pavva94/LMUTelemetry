from __future__ import annotations

from typing import Any

from app.reports.models import ReportAnalysis


TEXT = {
    "en": {
        "practice": "Practice Performance Report", "qualifying": "Qualifying Performance Report", "race": "Race Performance Report",
        "unavailable": "Unavailable", "low": "Low", "medium": "Medium", "high": "High",
        "confidence": "confidence", "measured": "measured", "inferred": "inferred",
    },
    "it": {
        "practice": "Report Prestazione Prove", "qualifying": "Report Prestazione Qualifica", "race": "Report Prestazione Gara",
        "unavailable": "Non disponibile", "low": "Bassa", "medium": "Media", "high": "Alta",
        "confidence": "confidenza", "measured": "misurato", "inferred": "stimato",
    },
}


def format_seconds(value: Any) -> str:
    if not isinstance(value, (int, float)):
        return "-"
    minutes = int(value // 60)
    seconds = value - minutes * 60
    return f"{minutes}:{seconds:06.3f}" if minutes else f"{seconds:.3f} s"


class ReportNarrativeBuilder:
    def __init__(self, language: str) -> None:
        self.language = language if language in TEXT else "en"
        self.t = TEXT[self.language]

    def report_title(self, analysis: ReportAnalysis) -> str:
        return self.t[analysis.session_type]

    def finding(self, finding: dict[str, Any]) -> str:
        value = finding.get("value")
        key = finding.get("key")
        unit = finding.get("unit") or ""
        confidence = self.t.get(finding.get("confidence"), finding.get("confidence", ""))
        if value is None:
            if self.language == "it":
                return f"{key.replace('_', ' ').title()}: non disponibile. {finding.get('evidence', '')}"
            return f"{key.replace('_', ' ').title()}: unavailable. {finding.get('evidence', '')}"
        display = format_seconds(value) if key in {"representative_pace", "realistic_potential"} else f"{value:.3f} {unit}" if isinstance(value, float) else f"{value} {unit}"
        qualifier = self.t["inferred"] if finding.get("inference") else self.t["measured"]
        if self.language == "it":
            return f"{key.replace('_', ' ').title()}: {display} ({qualifier}, confidenza {confidence.lower()}). {finding.get('evidence', '')}"
        return f"{key.replace('_', ' ').title()}: {display} ({qualifier}, {confidence.lower()} confidence). {finding.get('evidence', '')}"

    def data_quality(self, analysis: ReportAnalysis) -> str:
        audit = analysis.audit
        included = len(audit.get("included_laps") or [])
        excluded = len(audit.get("excluded_laps") or [])
        missing = ", ".join(audit.get("missing_channels") or []) or ("nessuno" if self.language == "it" else "none")
        if self.language == "it":
            return f"{included} giri inclusi, {excluded} esclusi. Canali mancanti: {missing}. Confidenza complessiva: {self.t.get(audit.get('overall_confidence'), audit.get('overall_confidence'))}. I giri esclusi restano nell'audit."
        return f"{included} laps included and {excluded} excluded. Missing channels: {missing}. Overall confidence: {self.t.get(audit.get('overall_confidence'), audit.get('overall_confidence'))}. Excluded laps remain in the audit."

    def session_specific_summary(self, analysis: ReportAnalysis) -> str:
        if analysis.session_type == "practice":
            phases = len(analysis.practice.get("phases") or [])
            return (f"Sono stati rilevati {phases} pattern di run. L'intento di setup non viene dedotto dai soli dati." if self.language == "it" else f"{phases} run patterns were detected. Setup intent is not inferred from telemetry alone.")
        if analysis.session_type == "qualifying":
            return ("La valutazione privilegia preparazione, giri push validi e potenziale realistico; l'intento esatto del giro resta non misurato." if self.language == "it" else "The assessment prioritizes preparation, valid push laps and realistic potential; exact lap intent remains unmeasured.")
        return ("La progressione posizione è riportata solo se misurata; i cambi posizione non sono definiti sorpassi senza evidenza avversari e pit-cycle." if self.language == "it" else "Position progression is shown only when measured; position changes are not called overtakes without opponent and pit-cycle evidence.")

    def recommendation(self, row: dict[str, Any]) -> dict[str, str]:
        if self.language != "it":
            return {key: str(row.get(key) or "") for key in ("title", "evidence", "action", "expected_benefit", "confidence", "validation")}
        titles = {
            "Confirm long-run degradation": "Confermare il degrado sul long run", "Validate the observed stint trend": "Validare il trend osservato nello stint",
            "Improve the evidence baseline": "Migliorare la base dati", "Standardize push-lap preparation": "Standardizzare la preparazione del giro push",
            "Protect valid peak attempts": "Proteggere i tentativi push validi", "Review pit execution": "Rivedere l'esecuzione del pit stop",
            "Stabilize representative race pace": "Stabilizzare il passo gara rappresentativo",
        }
        actions = {
            "Run at least eight clean consecutive laps with unchanged tyres and record fuel.": "Eseguire almeno otto giri puliti consecutivi con le stesse gomme e carburante registrato.",
            "Repeat the same fuel and tyre-age window in a clean stint.": "Ripetere la stessa finestra di carburante ed eta gomme in uno stint pulito.",
            "Prioritize a controlled run with consistent preparation and minimal traffic.": "Dare priorita a un run controllato con preparazione coerente e traffico minimo.",
            "Repeat the preparation sequence and preserve a clear gap before the push lap.": "Ripetere la sequenza di preparazione e mantenere spazio libero prima del giro push.",
            "Favor a repeatable first push before increasing aggression on the later attempt.": "Privilegiare un primo push ripetibile prima di aumentare l'aggressivita nel tentativo successivo.",
            "Compare entry-to-exit phases and rehearse the slowest repeatable phase.": "Confrontare le fasi ingresso-uscita e provare la fase ripetibile piu lenta.",
            "Use clean-air laps as the pace baseline and flag traffic/pit laps separately.": "Usare i giri in aria pulita come riferimento e separare i giri con traffico o pit.",
        }
        return {
            "title": titles.get(str(row.get("title")), str(row.get("title") or "")),
            "evidence": str(row.get("evidence") or ""),
            "action": actions.get(str(row.get("action")), str(row.get("action") or "")),
            "expected_benefit": str(row.get("expected_benefit") or ""),
            "confidence": self.t.get(str(row.get("confidence")), str(row.get("confidence") or "")),
            "validation": str(row.get("validation") or ""),
        }
