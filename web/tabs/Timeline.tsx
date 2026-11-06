import { useMemo, useState } from "react";
import { mediaLabel, statusOf, type UpdateStatus } from "../../src/summary";
import { dateKey, fmtDay, fromKey, plural } from "../lib";
import { Empty, Icon } from "../ui";
import { UpdateCard, useProject } from "./common";

const FILTERS: { id: "all" | UpdateStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_review", label: "Needs review" },
  { id: "checking", label: "Checking photos" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

export function Timeline() {
  const ctx = useProject();
  const [q, setQ] = useState("");
  const [day, setDay] = useState("");
  const [status, setStatus] = useState<(typeof FILTERS)[number]["id"]>("all");

  const all = useMemo(() => [...ctx.data.updates].sort((a, b) => b.at.localeCompare(a.at)), [ctx.data.updates]);
  const days = useMemo(() => [...new Set(all.map((u) => dateKey(u.at)))], [all]); // newest first
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter(
    (u) =>
      (!day || dateKey(u.at) === day) &&
      (status === "all" || statusOf(u) === status) &&
      words.every((w) => `${u.scopeLabel} ${u.stage} ${u.note} #${u.id}`.toLowerCase().includes(w)),
  );
  const groups = shown.reduce<Record<string, typeof shown>>((g, u) => ((g[dateKey(u.at)] ??= []).push(u), g), {});
  const idx = days.indexOf(day);

  if (!all.length) return <Empty icon="clock" title="Nothing on the timeline yet" action={!ctx.readOnly && <a className="btn primary" href={ctx.href("upload")}>Upload photos</a>}>Every upload appears here, newest first, grouped by day.</Empty>;

  return (
    <div className="timeline">
      <div className="toolbar card">
        <label className="search">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rooms, stages, notes…" aria-label="Search the timeline" />
          {q && <button className="icon-btn" onClick={() => setQ("")} aria-label="Clear search"><Icon name="x" size={14} /></button>}
        </label>
        <div className="day-pick">
          <button className="icon-btn" disabled={!day ? false : idx >= days.length - 1} onClick={() => setDay(days[day ? idx + 1 : 0])} aria-label="Earlier day with updates" title="Earlier day with updates"><Icon name="left" /></button>
          <input type="date" value={day} max={dateKey(new Date())} onChange={(e) => setDay(e.target.value)} aria-label="Jump to day" />
          <button className="icon-btn" disabled={!day || idx <= 0} onClick={() => setDay(days[idx - 1])} aria-label="Later day with updates" title="Later day with updates"><Icon name="right" /></button>
          {day && <button className="btn ghost small" onClick={() => setDay("")}>All days</button>}
        </div>
        <div className="filters scroll-row" role="radiogroup" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f.id} role="radio" aria-checked={status === f.id} className={`pill ${status === f.id ? "on" : ""}`} onClick={() => setStatus(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>
      <div className="day-strip" aria-label="Days with updates">
        {days.slice(0, 14).map((d) => (
          <button key={d} className={`day-chip ${d === day ? "on" : ""}`} onClick={() => setDay(d === day ? "" : d)}>
            <b>{fromKey(d).toLocaleDateString("en-GB", { day: "numeric" })}</b>
            <span>{fromKey(d).toLocaleDateString("en-GB", { month: "short" })}</span>
            <small>{all.filter((u) => dateKey(u.at) === d).length}</small>
          </button>
        ))}
      </div>
      {!shown.length ? (
        <Empty icon="search" title="No updates match">{day ? `Nothing on ${fmtDay(fromKey(day))} with these filters.` : "Try a different search or filter."}</Empty>
      ) : (
        Object.entries(groups).map(([d, list]) => (
          <section key={d} className="day-group">
            <h2 className="day-head">{fmtDay(fromKey(d))} <span className="muted small">· {plural(list.length, "update")} · {mediaLabel(list.flatMap((u) => u.photos))}</span></h2>
            <div className="stack">{list.map((u) => <UpdateCard key={u.id} u={u} />)}</div>
          </section>
        ))
      )}
    </div>
  );
}
