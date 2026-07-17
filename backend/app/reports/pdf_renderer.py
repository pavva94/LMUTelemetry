from __future__ import annotations

import textwrap
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.ticker import MaxNLocator

from app.reports.models import ReportAnalysis, ReportConfiguration
from app.reports.narrative import ReportNarrativeBuilder, format_seconds


NAVY = "#111827"
RED = "#d9272e"
BLUE = "#2b6cb0"
GREY = "#64748b"
LIGHT = "#e2e8f0"


def _wrap(value: Any, width: int = 94) -> str:
    return "\n".join(textwrap.wrap(str(value or "-"), width=width, break_long_words=False))


class ReportChartBuilder:
    def lap_time(self, ax, analysis: ReportAnalysis) -> None:
        timeline = analysis.lap.get("timeline") or []
        included = [row for row in timeline if row.get("valid") and row.get("lap_time") is not None and isinstance(row.get("lap_number"), (int, float))]
        excluded = [row for row in timeline if not row.get("valid") and row.get("lap_time") is not None and isinstance(row.get("lap_number"), (int, float))]
        ax.set_title("Lap-time development / Sviluppo tempi")
        if included:
            ax.plot([row["lap_number"] for row in included], [row["lap_time"] for row in included], color=BLUE, marker="o", linewidth=1, label="valid clean lap")
        if included and analysis.lap.get("median_pace") is not None:
            ax.axhline(analysis.lap["median_pace"], color=GREY, linestyle="--", linewidth=1)
        if excluded:
            ax.scatter([row["lap_number"] for row in excluded], [row["lap_time"] for row in excluded], marker="x", color=RED, label="excluded")
        ax.set_xlabel("Lap")
        ax.set_ylabel("Seconds")
        ax.xaxis.set_major_locator(MaxNLocator(nbins=12, integer=True))
        if included or excluded:
            ax.legend(fontsize=8)
        else:
            ax.text(.5, .5, "Unavailable: no timed laps", ha="center", va="center", transform=ax.transAxes)

    def stints(self, ax, analysis: ReportAnalysis) -> None:
        rows = [row for row in analysis.stints if row.get("median_pace") is not None]
        ax.set_title("Representative pace by stint")
        if rows:
            ax.bar([str(row["stint"]) for row in rows], [row["median_pace"] for row in rows], color=BLUE)
            ax.set_xlabel("Stint")
            ax.set_ylabel("Median clean lap (s)")
        else:
            ax.text(.5, .5, "Unavailable: no comparable stints", ha="center", va="center", transform=ax.transAxes)

    def fuel(self, ax, analysis: ReportAnalysis) -> None:
        rows = [row for row in analysis.fuel.get("by_stint") or [] if row.get("fuel_per_lap") is not None]
        ax.set_title("Fuel consumption by stint")
        if rows:
            ax.bar([str(row["stint"]) for row in rows], [row["fuel_per_lap"] for row in rows], color="#d69e2e")
            ax.set_xlabel("Stint")
            ax.set_ylabel("L/lap")
        else:
            ax.text(.5, .5, "Unavailable: fuel channel or valid consumption missing", ha="center", va="center", transform=ax.transAxes)

    def position(self, ax, analysis: ReportAnalysis) -> None:
        rows = analysis.race_progress.get("positions") or []
        ax.set_title("Race position by lap")
        if rows:
            ax.step([row["lap"] for row in rows], [row["position"] for row in rows], where="post", color=RED)
            ax.invert_yaxis()
            ax.set_xlabel("Lap")
            ax.set_ylabel("Position")
        else:
            ax.text(.5, .5, "Unavailable: reliable position channel missing", ha="center", va="center", transform=ax.transAxes)


class PdfReportRenderer:
    def __init__(self) -> None:
        self.charts = ReportChartBuilder()

    def render(self, output: Path, analysis: ReportAnalysis, config: ReportConfiguration) -> None:
        output.parent.mkdir(parents=True, exist_ok=True)
        narrative = ReportNarrativeBuilder(config.language)
        pages: list[Callable[[Any, int, int], None]] = [
            lambda pdf, page, total: self._cover(pdf, page, total, analysis, config, narrative),
            lambda pdf, page, total: self._executive(pdf, page, total, analysis, narrative),
            lambda pdf, page, total: self._quality(pdf, page, total, analysis, narrative),
            lambda pdf, page, total: self._timeline(pdf, page, total, analysis, config),
            lambda pdf, page, total: self._session_specific(pdf, page, total, analysis, narrative),
            lambda pdf, page, total: self._recommendations(pdf, page, total, analysis, config, narrative),
        ]
        lap_chunk_size = 23 if config.detail_level == "detailed" else 34
        lap_pages = [
            (lambda rows: (lambda pdf, page, total: self._lap_table(pdf, page, total, analysis, rows, config)))(analysis.lap_table[index:index + lap_chunk_size])
            for index in range(0, len(analysis.lap_table), lap_chunk_size)
        ]
        pages[-1:-1] = lap_pages
        if config.detail_level == "detailed":
            pages[4:4] = [
                lambda pdf, page, total: self._laps_and_stints(pdf, page, total, analysis, config),
                lambda pdf, page, total: self._fuel_tyres(pdf, page, total, analysis, config),
                lambda pdf, page, total: self._systems(pdf, page, total, analysis, config),
                lambda pdf, page, total: self._best_and_compare(pdf, page, total, analysis),
                lambda pdf, page, total: self._pits_traffic_corners(pdf, page, total, analysis),
            ]
            channel_rows = analysis.channels or [{"channel": "No channel manifest available", "usage": "unavailable"}]
            appendix_pages = [
                (lambda rows: (lambda pdf, page, total: self._channel_appendix(pdf, page, total, rows)))(channel_rows[index:index + 51])
                for index in range(0, len(channel_rows), 51)
            ]
            event_rows = analysis.events or []
            if event_rows:
                for index in range(0, len(event_rows), 10):
                    chunk = event_rows[index:index + 10]
                    last = index + 10 >= len(event_rows)
                    appendix_pages.append((lambda rows, include_definitions: (lambda pdf, page, total: self._event_appendix(pdf, page, total, analysis, rows, include_definitions)))(chunk, last))
            else:
                appendix_pages.append(lambda pdf, page, total: self._event_appendix(pdf, page, total, analysis, [], True))
            pages[-1:-1] = appendix_pages
        with PdfPages(output, metadata={"Title": config.title or narrative.report_title(analysis), "Author": "LMU Telemetry", "Subject": f"{analysis.session_type.title()} telemetry performance analysis", "Keywords": "LMU telemetry motorsport performance"}) as pdf:
            for index, page_builder in enumerate(pages, 1):
                page_builder(pdf, index, len(pages))

    @staticmethod
    def _figure(pdf, page: int, total: int, title: str, landscape: bool = False):
        fig = plt.figure(figsize=(11.69, 8.27) if landscape else (8.27, 11.69), facecolor="white")
        fig.text(.06, .965, "LMU TELEMETRY", color=RED, weight="bold", fontsize=9)
        fig.text(.94, .965, title, color=GREY, fontsize=8, ha="right")
        fig.text(.06, .025, "Le Mans Ultimate telemetry - Evidence-based offline report", color=GREY, fontsize=7)
        fig.text(.94, .025, f"{page} / {total}", color=GREY, fontsize=7, ha="right")
        return fig

    def _cover(self, pdf, page, total, a, c, n):
        fig = self._figure(pdf, page, total, "Performance report")
        fig.patches.extend([plt.Rectangle((.06, .72), .02, .16, transform=fig.transFigure, color=RED, clip_on=False)])
        fig.text(.12, .84, _wrap(c.title or n.report_title(a), 42), fontsize=26, weight="bold", color=NAVY, va="top")
        session = a.session
        driver = "Anonymous driver" if c.anonymize_driver else (c.driver_name or "Driver unavailable")
        rows = [
            ("Session", a.session_type.title()), ("Circuit", session.get("track_name")), ("Layout", session.get("track_layout")),
            ("Car", session.get("vehicle_model") or session.get("vehicle_name")), ("Car class", session.get("vehicle_class")), ("Driver", driver), ("Team", c.team_name),
            ("Session date", session.get("created_at")), ("Duration", format_seconds(a.overview.get("duration_seconds"))),
            ("Laps valid / total", f"{a.overview.get('valid_laps', 0)} / {a.overview.get('completed_laps', 0)}"),
            ("Distance", f"{a.overview.get('total_distance_km'):.1f} km" if a.overview.get("total_distance_km") is not None else None),
            ("Pit entries / exits", f"{a.overview.get('pit_entries', 0)} / {a.overview.get('pit_exits', 0)}"),
            ("Compounds", ", ".join(a.overview.get("compounds_used") or []) or None),
            ("Fuel start / end", f"{self._table_value(a.overview.get('starting_fuel'),1)} / {self._table_value(a.overview.get('ending_fuel'),1)} L"),
            ("SoC start / end", f"{self._table_value(a.overview.get('starting_soc'),1)} / {self._table_value(a.overview.get('ending_soc'),1)}"),
            ("Finish / classification", f"{a.overview.get('finish_status') or '-'} / {a.overview.get('final_position') or '-'}"),
            ("Generated", datetime.now().astimezone().isoformat(timespec="minutes")),
        ]
        for index, (label, value) in enumerate(rows):
            column, row = index % 2, index // 2
            x = .12 + column * .43; y = .62 - row * .052
            fig.text(x, y, label.upper(), color=GREY, fontsize=7, weight="bold")
            fig.text(x, y - .022, _wrap(value, 35), color=NAVY, fontsize=9, va="top")
        if c.notes:
            fig.text(.12, .10, "NOTES", color=GREY, fontsize=8, weight="bold")
            fig.text(.12, .08, _wrap(c.notes, 85), color=NAVY, fontsize=8, va="top")
        pdf.savefig(fig); plt.close(fig)

    def _executive(self, pdf, page, total, a, n):
        fig = self._figure(pdf, page, total, "Executive summary")
        fig.text(.06, .91, "Executive Summary / Sintesi", fontsize=20, weight="bold", color=NAVY)
        metrics = [
            ("Recorded / valid laps", f"{len(a.audit.get('included_laps', [])) + len(a.audit.get('excluded_laps', []))} / {a.lap.get('valid_count', 0)}"),
            ("Best valid lap", format_seconds(a.lap.get("best_lap"))), ("Representative pace", format_seconds(a.lap.get("median_pace"))),
            ("Consistency MAD", f"{a.lap.get('mad'):.3f} s" if a.lap.get("mad") is not None else "-"),
            ("Best sustained pace", format_seconds(a.overview.get("fastest_sustained_pace"))),
            ("Best 3 / 5 lap avg", f"{format_seconds(a.lap.get('best_three_lap_average'))} / {format_seconds(a.lap.get('best_five_lap_average'))}"),
            ("Fuel / lap", f"{a.fuel.get('median_per_lap'):.3f} L" if a.fuel.get("median_per_lap") is not None else "-"),
            ("Stints / pit stops", f"{len(a.stints)} / {a.pits.get('count', 0)}"), ("Confidence", str(a.audit.get("overall_confidence", "-")).title()),
        ]
        for index, (label, value) in enumerate(metrics):
            x = .06 + (index % 2) * .45; y = .82 - (index // 2) * .068
            fig.text(x, y, label.upper(), fontsize=7, color=GREY, weight="bold")
            fig.text(x, y - .035, value, fontsize=14, color=NAVY, weight="bold")
        fig.text(.06, .46, "Key findings", fontsize=13, color=NAVY, weight="bold")
        y = .42
        for finding in a.public()["findings"][:4]:
            fig.text(.075, y, "- " + _wrap(n.finding(finding), 92), fontsize=9, color=NAVY, va="top", linespacing=1.35)
            y -= .075
        fig.text(.06, .095, _wrap(n.session_specific_summary(a), 96), fontsize=8.5, color=GREY, va="top")
        pdf.savefig(fig); plt.close(fig)

    def _quality(self, pdf, page, total, a, n):
        fig = self._figure(pdf, page, total, "Data quality and methodology")
        fig.text(.06, .91, "Data Quality & Methodology", fontsize=20, weight="bold", color=NAVY)
        fig.text(.06, .85, _wrap(n.data_quality(a), 100), fontsize=10, color=NAVY, va="top", linespacing=1.4)
        audit = a.audit
        rows = [
            ("Duplicate samples", audit.get("duplicate_samples")), ("Timestamp discontinuities", audit.get("timestamp_discontinuities")),
            ("Impossible samples", audit.get("impossible_samples")), ("Samples analyzed", audit.get("sample_count_analyzed")),
            ("Missing channels", ", ".join(audit.get("missing_channels") or []) or "None"), ("Source warnings", " | ".join(audit.get("warnings") or []) or "None"),
        ]
        y = .68
        for label, value in rows:
            fig.text(.06, y, label, fontsize=8, color=GREY, weight="bold")
            fig.text(.34, y, _wrap(value, 67), fontsize=9, color=NAVY, va="top")
            y -= .075
        fig.text(.06, .22, "Filters", fontsize=11, weight="bold", color=NAVY)
        fig.text(.06, .19, _wrap(" - ".join(audit.get("filters") or []), 105), fontsize=8, color=NAVY, va="top")
        fig.text(.06, .11, _wrap("Methods: " + ", ".join(a.methodology.get("statistics") or []) + ". " + a.methodology.get("principle", ""), 105), fontsize=8, color=GREY)
        pdf.savefig(fig); plt.close(fig)

    def _timeline(self, pdf, page, total, a, c):
        fig = self._figure(pdf, page, total, "Session timeline", landscape=True)
        fig.text(.06, .88, "Session Timeline", fontsize=20, weight="bold", color=NAVY)
        ax = fig.add_axes([.08, .18, .84, .58])
        if c.include_charts:
            self.charts.lap_time(ax, a)
        else:
            ax.axis("off"); ax.text(.5, .5, "Charts excluded by report configuration", ha="center", va="center")
        pdf.savefig(fig); plt.close(fig)

    def _laps_and_stints(self, pdf, page, total, a, c):
        fig = self._figure(pdf, page, total, "Lap and stint analysis", landscape=True)
        fig.text(.06, .88, "Lap & Stint Analysis", fontsize=20, weight="bold", color=NAVY)
        ax = fig.add_axes([.07, .16, .42, .60]); ax2 = fig.add_axes([.55, .16, .38, .60])
        if c.include_charts:
            self.charts.lap_time(ax, a); self.charts.stints(ax2, a)
        else:
            ax.axis("off"); ax2.axis("off")
        pdf.savefig(fig); plt.close(fig)

    def _fuel_tyres(self, pdf, page, total, a, c):
        fig = self._figure(pdf, page, total, "Fuel and tyre analysis", landscape=True)
        fig.text(.06, .88, "Fuel & Tyre Analysis", fontsize=20, weight="bold", color=NAVY)
        ax = fig.add_axes([.07, .17, .42, .57])
        if c.include_charts: self.charts.fuel(ax, a)
        else: ax.axis("off")
        fuel = a.fuel; tyre = a.tyre
        text = f"Fuel median: {self._table_value(fuel.get('median_per_lap'),3)} L/lap\nFuel effect: {self._table_value(fuel.get('lap_time_effect_seconds_per_liter'),4)} s/L ({fuel.get('confidence')})\n{fuel.get('effect_note')}\n\nTyre degradation: {self._table_value(tyre.get('degradation_seconds_per_lap'),3)} s/lap ({tyre.get('confidence')})\n{tyre.get('degradation_note')}"
        fig.text(.55, .70, _wrap(text, 55), fontsize=10, color=NAVY, va="top", linespacing=1.5)
        pdf.savefig(fig); plt.close(fig)

    def _best_and_compare(self, pdf, page, total, a):
        fig = self._figure(pdf, page, total, "Best lap and comparison", landscape=True)
        fig.text(.05, .89, "Best Lap, Potential & Comparison", fontsize=18, weight="bold", color=NAVY)
        rows = [("Best actual", format_seconds(a.lap.get("best_lap"))), ("Theoretical best", format_seconds(a.lap.get("theoretical_best"))), ("Realistic potential", format_seconds(a.lap.get("realistic_potential"))), ("Gap", f"{a.lap.get('theoretical_gap'):.3f} s" if a.lap.get("theoretical_gap") is not None else "-")]
        for index,(label,value) in enumerate(rows):
            x=.05+index*.19; fig.text(x,.80,label.upper(),fontsize=7,color=GREY,weight="bold"); fig.text(x,.755,value,fontsize=12,color=NAVY)
        traces=a.comparison.get("traces") or []
        ax=fig.add_axes([.06,.39,.42,.28]); ax2=fig.add_axes([.55,.39,.39,.28])
        for trace in traces:
            points=[point for point in trace.get("points") or [] if point.get("lap_distance") is not None]
            if points:
                ax.plot([p["lap_distance"] for p in points],[p.get("speed_kph") for p in points],label=f"Lap {trace.get('lap')}",linewidth=1)
                ax2.plot([p["lap_distance"] for p in points],[p.get("throttle") for p in points],label=f"Throttle L{trace.get('lap')}",linewidth=.9)
                ax2.plot([p["lap_distance"] for p in points],[p.get("brake") for p in points],linestyle="--",label=f"Brake L{trace.get('lap')}",linewidth=.9)
        if traces:
            ax.set_title("Speed over lap distance",fontsize=9); ax.set_xlabel("Distance"); ax.set_ylabel("km/h"); ax.legend(fontsize=6)
            ax2.set_title("Throttle / brake over lap distance",fontsize=9); ax2.set_xlabel("Distance"); ax2.legend(fontsize=5,ncol=2)
        else:
            ax.axis("off"); ax2.axis("off"); ax.text(.5,.5,a.comparison.get("note"),ha="center",va="center")
        fig.text(.06,.25,"Corner analysis",fontsize=10,weight="bold",color=NAVY); fig.text(.06,.215,_wrap(a.corners.get("note"),145),fontsize=7.5,color=NAVY)
        fig.text(.06,.12,_wrap("The theoretical best is not presented as automatically achievable. A realistic composite is only produced when compatible sector evidence exists.",145),fontsize=7,color=GREY)
        pdf.savefig(fig); plt.close(fig)

    def _pits_traffic_corners(self, pdf, page, total, a):
        fig=self._figure(pdf,page,total,"Pit, traffic and event evidence")
        fig.text(.06,.91,"Pits, Traffic & Event Evidence",fontsize=20,weight="bold",color=NAVY)
        blocks=[("Pit stops",f"Detected: {a.pits.get('count',0)}. {a.pits.get('position_effect_note','')}"),("Traffic",a.traffic.get("note")),("Position",a.race_progress.get("note")),("Corners",a.corners.get("note"))]
        y=.80
        for title,body in blocks:
            fig.text(.08,y,title,fontsize=12,weight="bold",color=NAVY); fig.text(.08,y-.04,_wrap(body,92),fontsize=9,color=NAVY,va="top"); y-=.16
        pdf.savefig(fig); plt.close(fig)

    @staticmethod
    def _table_value(value: Any, digits: int = 2) -> str:
        if value is None or value == "": return "-"
        if isinstance(value, float): return f"{value:.{digits}f}"
        return str(value)

    def _lap_table(self, pdf, page, total, a, rows, c):
        fig = self._figure(pdf, page, total, "Complete lap table", landscape=True)
        first = rows[0].get("lap") if rows else "-"; last = rows[-1].get("lap") if rows else "-"
        fig.text(.04, .89, f"Complete Lap Table - laps {first} to {last}", fontsize=18, weight="bold", color=NAVY)
        fig.text(.04, .845, "Every recorded lap is retained. A dash means the source channel or reliable derivation is unavailable.", fontsize=7.5, color=GREY)
        columns = ["Lap","Time","dBest","dMed","Classification","St","Comp","Fuel S","Fuel E","Used","SoC S","SoC E","Energy","Vmax","Tyre C","Brake C","Traffic","Off/Imp"]
        data = []
        for row in rows:
            data.append([
                self._table_value(row.get("lap"),0), format_seconds(row.get("lap_time")), self._table_value(row.get("gap_best")), self._table_value(row.get("gap_median")),
                str(row.get("classification") or "-")[:28], self._table_value(row.get("stint"),0), self._table_value(row.get("compound"),0),
                self._table_value(row.get("fuel_start"),1), self._table_value(row.get("fuel_end"),1), self._table_value(row.get("fuel_used"),2),
                self._table_value(row.get("soc_start"),2), self._table_value(row.get("soc_end"),2), self._table_value(row.get("energy_used"),2),
                self._table_value(row.get("top_speed"),0), self._table_value(row.get("max_tyre_temp"),0), self._table_value(row.get("max_brake_temp"),0),
                self._table_value(row.get("traffic"),0), f"{row.get('offtrack') or 0}/{self._table_value(row.get('impact'),1)}",
            ])
        ax = fig.add_axes([.03,.08,.94,.73]); ax.axis("off")
        widths = [.035,.065,.045,.045,.15,.03,.04,.045,.045,.04,.042,.042,.045,.04,.042,.045,.055,.05]
        table = ax.table(cellText=data, colLabels=columns, colWidths=widths, loc="upper center", cellLoc="center")
        table.auto_set_font_size(False); table.set_fontsize(5.4 if c.detail_level == "detailed" else 4.8); table.scale(1, 1.35 if c.detail_level == "detailed" else .82)
        for (row_index, _column), cell in table.get_celld().items():
            cell.set_edgecolor(LIGHT); cell.set_linewidth(.35)
            if row_index == 0: cell.set_facecolor(NAVY); cell.get_text().set_color("white"); cell.get_text().set_weight("bold")
            elif row_index % 2 == 0: cell.set_facecolor("#f8fafc")
        pdf.savefig(fig); plt.close(fig)

    def _systems(self, pdf, page, total, a, c):
        fig = self._figure(pdf, page, total, "Subsystem and distribution evidence", landscape=True)
        fig.text(.05,.89,"Distribution, Energy, Thermal & Environment",fontsize=18,weight="bold",color=NAVY)
        ax = fig.add_axes([.06,.48,.39,.30])
        valid = [row.get("lap_time") for row in a.lap_table if row.get("lap_time") is not None and "valid representative" in str(row.get("classification"))]
        all_times = [row.get("lap_time") for row in a.lap_table if row.get("lap_time") is not None]
        if c.include_charts and all_times:
            ax.hist(all_times, bins=min(12,max(4,len(all_times)//4)), alpha=.35, color=GREY, label="all timed")
            if valid: ax.hist(valid, bins=min(12,max(4,len(valid)//4)), alpha=.65, color=BLUE, label="representative")
            ax.axvline(a.lap.get("median_pace"),color=RED,linestyle="--",label="median"); ax.set_xlabel("Lap time (s)"); ax.set_ylabel("Laps"); ax.legend(fontsize=7)
        else: ax.axis("off"); ax.text(.5,.5,"Lap-time distribution unavailable",ha="center",va="center")
        energy=a.systems.get("energy",{}); thermal=a.systems.get("thermal",{}); env=a.systems.get("environment",{}); platform=a.systems.get("platform",{})
        summaries=[
            ("Energy",f"SoC: {self._table_value(energy.get('soc',{}).get('start'),2)} -> {self._table_value(energy.get('soc',{}).get('end'),2)}\nVirtual energy: {self._table_value(energy.get('virtual_energy',{}).get('start'),2)} -> {self._table_value(energy.get('virtual_energy',{}).get('end'),2)}\n{energy.get('note','')}"),
            ("Thermal",f"Peak tyre: {self._table_value(thermal.get('tyre_peak'),1)} C\nPeak brake: {self._table_value(thermal.get('brake_peak'),1)} C\nOil max: {self._table_value(thermal.get('oil',{}).get('maximum'),1)} C; water max: {self._table_value(thermal.get('water',{}).get('maximum'),1)} C\n{thermal.get('note','')}"),
            ("Environment",f"Track temp change: {self._table_value(env.get('track_temp',{}).get('change'),1)} C\nAmbient change: {self._table_value(env.get('ambient_temp',{}).get('change'),1)} C\nWetness change: {self._table_value(env.get('minimum_path_wetness',{}).get('change'),2)}"),
            ("Platform",f"Front ride height min: {self._table_value(platform.get('front_ride_height',{}).get('minimum'),3)}\nRear ride height min: {self._table_value(platform.get('rear_ride_height',{}).get('minimum'),3)}\n{platform.get('note','')}"),
        ]
        for index,(title,body) in enumerate(summaries):
            x=.51+(index%2)*.235; y=.76-(index//2)*.30
            fig.text(x,y,title,fontsize=10,weight="bold",color=RED); fig.text(x,y-.035,_wrap(body,37),fontsize=7.5,color=NAVY,va="top",linespacing=1.35)
        fig.text(.06,.35,"Robust distribution metrics",fontsize=10,weight="bold",color=NAVY)
        metrics=f"Mean (trimmed): {format_seconds(a.lap.get('trimmed_mean_pace'))}   Median: {format_seconds(a.lap.get('median_pace'))}   Std dev: {self._table_value(a.lap.get('standard_deviation'),3)} s   IQR: {self._table_value(a.lap.get('interquartile_range'),3)} s   MAD: {self._table_value(a.lap.get('mad'),3)} s"
        fig.text(.06,.31,metrics,fontsize=8,color=NAVY)
        fig.text(.06,.25,f"Best consecutive 3-lap average: {format_seconds(a.lap.get('best_three_lap_average'))}   Best consecutive 5-lap average: {format_seconds(a.lap.get('best_five_lap_average'))}",fontsize=8,color=NAVY)
        pdf.savefig(fig); plt.close(fig)

    def _channel_appendix(self, pdf, page, total, rows):
        fig=self._figure(pdf,page,total,"Appendix - channel availability",landscape=True)
        fig.text(.04,.89,"Appendix A - Channel Availability",fontsize=18,weight="bold",color=NAVY)
        fig.text(.04,.845,"Coverage reflects the indexed source manifest. Metrics use full-resolution source calculations where available; report traces may be downsampled.",fontsize=7.5,color=GREY)
        columns=["Channel","Hz","Rows","Unit","Mapped fields","Usage","Coverage"]
        data=[[self._table_value(row.get("channel")),self._table_value(row.get("frequency"),1),self._table_value(row.get("row_count"),0),self._table_value(row.get("unit")),str(row.get("mapped_fields") or "-")[:45],self._table_value(row.get("usage")),self._table_value(row.get("coverage"))] for row in rows]
        ax=fig.add_axes([.04,.07,.92,.74]); ax.axis("off")
        table=ax.table(cellText=data,colLabels=columns,colWidths=[.20,.06,.09,.08,.29,.13,.10],loc="upper center",cellLoc="left")
        table.auto_set_font_size(False); table.set_fontsize(5.1); table.scale(1,.68 if len(rows)>45 else .78 if len(rows)>35 else 1.05)
        for (ri,_ci),cell in table.get_celld().items():
            cell.set_edgecolor(LIGHT); cell.set_linewidth(.3)
            if ri==0: cell.set_facecolor(NAVY); cell.get_text().set_color("white"); cell.get_text().set_weight("bold")
            elif ri%2==0: cell.set_facecolor("#f8fafc")
        pdf.savefig(fig); plt.close(fig)

    def _event_appendix(self, pdf, page, total, a, events, include_definitions):
        fig=self._figure(pdf,page,total,"Appendix - events, definitions and limits")
        fig.text(.06,.91,"Appendix B-F - Events, Definitions & Limits",fontsize=18,weight="bold",color=NAVY)
        fig.text(.06,.855,"Event log",fontsize=11,weight="bold",color=RED)
        y=.82
        for event in events:
            text=f"Lap {event.get('lap') or '-'} - {event.get('type')} [{event.get('severity')}]: {event.get('evidence')} ({event.get('confidence')} confidence)"
            fig.text(.07,y,_wrap(text,104),fontsize=7.5,color=NAVY,va="top"); y-=.035
        if not events: fig.text(.07,y,"No supported abnormal or operational events were detected.",fontsize=8,color=NAVY); y-=.04
        if not include_definitions:
            fig.text(.06,.12,"Event log continues on the next appendix page.",fontsize=8,color=GREY)
            pdf.savefig(fig); plt.close(fig); return
        y=.40
        fig.text(.06,y,"Derived metric definitions",fontsize=11,weight="bold",color=RED); y-=.035
        definitions=["Representative pace: median of valid laps after pit, incomplete, flag, anomaly and shared quality exclusions.","Fuel effect: Theil-Sen pairwise slope using at least six laps with fuel and pace; empirical, not a physical mass model.","Tyre degradation: within-stint clean-pace slope where at least five comparable laps exist; correlated effects are disclosed.","Theoretical best: sum of best valid sectors only when compatible sector splits exist; realistic potential remains separate.","Traffic severity: derived from Time Behind Next when present; never treated as proof of an overtake."]
        for item in definitions: fig.text(.07,y,"- "+_wrap(item,102),fontsize=7.2,color=NAVY,va="top"); y-=.043
        fig.text(.06,.14,"Confidence and limitations",fontsize=11,weight="bold",color=RED)
        limits="High: directly measured or strongly supported. Medium: consistent multi-channel inference. Low: plausible with missing context. Unavailable: insufficient source evidence. Exact overtakes, setup changes, opponent strategy, tyre/brake target windows, aerodynamic coefficients, reaction time, damage and race-control state are not fabricated."
        fig.text(.07,.105,_wrap(limits,104),fontsize=7.5,color=NAVY,va="top")
        pdf.savefig(fig); plt.close(fig)

    def _session_specific(self, pdf, page, total, a, n):
        title = {"practice":"Practice Development Assessment","qualifying":"Qualifying Execution Assessment","race":"Race Performance Assessment"}[a.session_type]
        fig=self._figure(pdf,page,total,title)
        fig.text(.06,.91,title,fontsize=20,weight="bold",color=NAVY)
        fig.text(.06,.85,_wrap(n.session_specific_summary(a),100),fontsize=10,color=NAVY,va="top")
        if a.session_type == "race":
            data = {"race time": format_seconds(a.overview.get("duration_seconds")), "completed / valid laps": f"{a.overview.get('completed_laps')} / {a.overview.get('valid_laps')}", "distance": f"{self._table_value(a.overview.get('total_distance_km'),1)} km", "best race lap": format_seconds(a.lap.get("best_lap")), "median clean pace": format_seconds(a.lap.get("median_pace")), "best stint": a.overview.get("fastest_sustained_stint"), "pit stops": a.pits.get("count"), "fuel used": f"{self._table_value(a.fuel.get('total_used'),1)} L", "tyre pace trend": f"{self._table_value(a.tyre.get('degradation_seconds_per_lap'),3)} s/lap ({a.tyre.get('confidence')})", "supported events": len(a.events)}
        elif a.session_type == "qualifying":
            data = {"best valid lap": format_seconds(a.lap.get("best_lap")), "theoretical best": format_seconds(a.lap.get("theoretical_best")), "realistic potential": format_seconds(a.lap.get("realistic_potential")), "valid push candidates": a.lap.get("valid_count"), "tyre readiness": a.qualifying.get("tyre_readiness_available"), "preparation confidence": a.qualifying.get("preparation_confidence"), "execution note": a.qualifying.get("note")}
        else:
            data = {"run patterns": len(a.practice.get("phases") or []), "valid representative laps": a.lap.get("valid_count"), "best lap": format_seconds(a.lap.get("best_lap")), "median clean pace": format_seconds(a.lap.get("median_pace")), "best 3-lap average": format_seconds(a.lap.get("best_three_lap_average")), "pace development": self._table_value(a.practice.get("pace_development"),3), "fuel effect": self._table_value(a.fuel.get("lap_time_effect_seconds_per_liter"),4), "practice note": a.practice.get("note")}
        y=.70
        for key,value in list(data.items())[:8]:
            fig.text(.07,y,key.replace("_"," ").title(),fontsize=8,color=GREY,weight="bold")
            fig.text(.34,y,_wrap(value,64),fontsize=9,color=NAVY,va="top"); y-=.075
        pdf.savefig(fig); plt.close(fig)

    def _recommendations(self, pdf, page, total, a, c, n):
        fig=self._figure(pdf,page,total,"Prioritized recommendations")
        fig.text(.06,.91,"Prioritized Actions",fontsize=20,weight="bold",color=NAVY)
        y=.84
        for row in a.public()["recommendations"]:
            localized = n.recommendation(row)
            priority = "PRIORITA" if c.language == "it" else "PRIORITY"
            labels = ("Evidenza", "Azione", "Beneficio atteso", "Confidenza", "Validazione") if c.language == "it" else ("Evidence", "Action", "Expected benefit", "Confidence", "Validation")
            fig.text(.06,y,f"{priority} {row['priority']} - {localized['title']}",fontsize=11,weight="bold",color=RED)
            body=f"{labels[0]}: {localized['evidence']}\n{labels[1]}: {localized['action']}\n{labels[2]}: {localized['expected_benefit']}\n{labels[3]}: {localized['confidence']}\n{labels[4]}: {localized['validation']}"
            fig.text(.08,y-.035,_wrap(body,96),fontsize=8.5,color=NAVY,va="top",linespacing=1.4)
            y-=.25
        pdf.savefig(fig); plt.close(fig)
