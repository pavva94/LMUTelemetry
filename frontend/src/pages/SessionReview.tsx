import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import type { SessionReview as Review } from "../types/session";

export function SessionReview() {
  const [review, setReview] = useState<Review | null>(null);
  useEffect(() => { const id = window.setInterval(() => void api.review().then(setReview).catch(() => {}), 2000); return () => window.clearInterval(id); }, []);
  const samples = review?.telemetry_samples || [];
  return (
    <div className="page grid">
      <section className="card span-6"><h2>Fuel Usage</h2><ResponsiveContainer width="100%" height={240}><LineChart data={samples}><CartesianGrid stroke="#27313a" /><XAxis dataKey="lap_number" stroke="#8896a3" /><YAxis stroke="#8896a3" /><Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} /><Line dataKey="fuel_liters" stroke="#e6b450" dot={false} /></LineChart></ResponsiveContainer></section>
      <section className="card span-6"><h2>Tyre Wear</h2><ResponsiveContainer width="100%" height={240}><LineChart data={samples}><CartesianGrid stroke="#27313a" /><XAxis dataKey="lap_number" stroke="#8896a3" /><YAxis stroke="#8896a3" /><Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} /><Line dataKey="tyre_wear_fl" stroke="#6dd6ff" dot={false} /><Line dataKey="tyre_wear_fr" stroke="#ff8c69" dot={false} /></LineChart></ResponsiveContainer></section>
      <section className="card span-12"><h2>Recommendation Timeline</h2><div className="table-wrap"><table><thead><tr><th>Lap</th><th>Type</th><th>Priority</th><th>Message</th></tr></thead><tbody>{(review?.recommendations || []).map((rec, i) => <tr key={i}><td>{String(rec.lap_number ?? "--")}</td><td>{String(rec.recommendation_type ?? "--")}</td><td>{String(rec.priority ?? "--")}</td><td>{String(rec.message ?? "--")}</td></tr>)}</tbody></table></div></section>
    </div>
  );
}
