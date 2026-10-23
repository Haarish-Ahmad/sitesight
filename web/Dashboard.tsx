import { useEffect, useState } from "react";
import { ago } from "../src/describe";
import { enoughHistory } from "../src/finish";
import type { Summary } from "../src/summary";
import { api, plural } from "./lib";
import { CountUp, Empty, Icon, Progress } from "./ui";

type Row = { alerts: number; id: string; name: string; location: string; createdAt: string; type: "house" | "apartment"; description: string; summary: Omit<Summary, "states">; cover: string | null };

export function Guide({ done = [false, false, false] }: { done?: boolean[] }) {
  const steps = [
    { icon: "building" as const, title: "Set up the project", text: "Upload the plan, or enter floors, blocks, flats and rooms. Each room gets a checklist of what it needs." },
    { icon: "camera" as const, title: "Upload site photos", text: "Pick where and what stage. The AI checks each photo against the claim." },
    { icon: "file" as const, title: "Review and report", text: "Approve work, track issues, share a read-only link or a PDF report." },
  ];
  return (
    <ol className="guide">
      {steps.map((s, i) => (
        <li key={s.title} className={done[i] ? "done" : ""}>
          <span className="guide-no">{done[i] ? <Icon name="check" size={16} /> : i + 1}</span>
          <div>
            <b>{s.title}</b>
            <p>{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const hello = (h = new Date().getHours()) => (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening");

export function Dashboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    document.title = "SiteSight · Projects";
    api<Row[]>("/api/projects").then(setRows).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="page"><Empty icon="alert" title="Cannot load projects">{error}</Empty></div>;
  if (!rows)
    return (
      <div className="page" aria-busy="true" aria-label="Loading projects">
        <div className="skeleton line" />
        <div className="project-grid">{[0, 1, 2].map((i) => <div key={i} className="skeleton card-sk" />)}</div>
      </div>
    );

  if (!rows.length)
    return (
      <div className="page">
        <section className="hero">
          <p className="kicker">Site progress, from photos</p>
          <h1>Every room, every stage, <span>in one view.</span></h1>
          <p className="lead">Upload your building plan and SiteSight sets up every floor, flat and room. Photos from site then show what is done, what is behind, and what needs your attention.</p>
          <div className="row-actions">
            <a className="btn primary big" href="#/new"><Icon name="upload" /> Start from a plan</a>
            <a className="btn ghost big" href="#/new?manual"><Icon name="plus" /> Set up by hand</a>
          </div>
          <Guide />
        </section>
      </div>
    );

  const attention = rows.reduce((n, r) => n + r.summary.needsReview + r.summary.highIssues + r.alerts, 0);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter((r) => words.every((w) => `${r.name} ${r.location} ${r.description}`.toLowerCase().includes(w)));
  return (
    <div className="page">
      <header className="mesh dash-banner">
        <div>
          <p className="kicker">{hello()} · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1>Your sites</h1>
          <p>{plural(rows.length, "project")}{attention ? ` · ${plural(attention, "item")} need${attention === 1 ? "s" : ""} attention` : " · nothing waiting on you"}</p>
        </div>
        <dl className="glass-stats">
          <div><dt>Projects</dt><dd><CountUp value={rows.length} /></dd></div>
          <div><dt>Rooms tracked</dt><dd><CountUp value={rows.reduce((n, r) => n + r.summary.roomsTotal, 0)} /></dd></div>
          <div><dt>Average done</dt><dd><CountUp value={Math.round(rows.reduce((n, r) => n + r.summary.progressPct, 0) / rows.length)} />%</dd></div>
          <div className={attention ? "hot" : ""}><dt>Needs you</dt><dd><CountUp value={attention} /></dd></div>
        </dl>
        <BuildingArt />
      </header>
      {rows.length > 3 && (
        <label className="dash-search">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, place or building type" aria-label="Search projects" />
          <span className="round"><Icon name="search" size={16} /></span>
        </label>
      )}
      <div className="project-grid">
        {shown.map((r) => {
          const lines = [
            r.summary.needsReview > 0 && <span key="r" className="chip warn"><Icon name="flag" size={13} /> {r.summary.needsReview} to review</span>,
            r.summary.openIssues > 0 && <span key="i" className={`chip ${r.summary.highIssues ? "bad" : "muted"}`}><Icon name="alert" size={13} /> {plural(r.summary.openIssues, "issue")}</span>,
            r.alerts > 0 && <span key="a" className="chip warn"><Icon name="clock" size={13} /> {r.alerts} behind</span>,
          ].filter(Boolean);
          return (
            <a key={r.id} className="project-card" href={`#/p/${r.id}`}>
              <div className="cover">
                {r.cover ? <img src={`/api/projects/${r.id}/photos/${r.cover}?w=640`} alt="" loading="lazy" /> : <Icon name={r.type === "house" ? "home" : "building"} size={48} />}
                {r.summary.checking > 0 && <span className="badge">Checking {plural(r.summary.checking, "photo")}</span>}
                <span className="pct-badge">{r.summary.progressPct}%</span>
              </div>
              <div className="pc-top">
                <h2>{r.name}</h2>
              </div>
              <ul className="pc-facts">
                <li>{r.location || r.description}</li>
                {r.location && <li>{r.description}</li>}
                <li>{r.summary.lastActivityAt ? `Updated ${ago(r.summary.lastActivityAt)}` : "No updates yet"}{r.summary.etaDays === 0 ? " · all work finished" : !enoughHistory(r.summary) ? " · finish date needs a week of updates" : ""}</li>
              </ul>
              <div className="pc-progress"><Progress value={r.summary.progressPct} label={`${r.name} progress`} /></div>
              <div className="pc-badges">{lines.length ? lines : <span className="chip good"><Icon name="check" size={13} /> All clear</span>}</div>
            </a>
          );
        })}
        {!words.length && (
          <a className="project-card new-card" href="#/new">
            <div className="cover">
              <Icon name="plus" size={32} />
              <b>New project</b>
              <span className="muted small">Upload a plan, or set it up by hand</span>
            </div>
          </a>
        )}
      </div>
      {!shown.length && <Empty icon="search" title="No projects match">Try a different search.</Empty>}
      <a className="fab" href="#/new"><Icon name="plus" size={20} /> New project</a>
    </div>
  );
}

// Line drawing of a block going up: floors stack, windows light, the crane swings. Decoration only.
function BuildingArt() {
  const floors = [0, 1, 2, 3, 4, 5];
  return (
    <svg className="build-art" viewBox="0 0 300 220" aria-hidden="true">
      <line className="ba-ground" x1="10" y1="200" x2="290" y2="200" />
      {floors.map((f) => (
        <g key={f} className="ba-floor" style={{ animationDelay: `${0.3 + f * 0.22}s` }}>
          <rect x="70" y={176 - f * 24} width="130" height="24" rx="2" />
          {[0, 1, 2, 3, 4].map((w) => (
            <rect key={w} className="ba-win" x={80 + w * 23} y={183 - f * 24} width="12" height="10" rx="1.5" style={{ animationDelay: `${1.8 + ((f * 5 + w * 3) % 11) * 0.35}s` }} />
          ))}
        </g>
      ))}
      <g className="ba-crane">
        <path d="M240 200V30M232 200V30M232 30h8M232 60l8-12M232 90l8-12M232 120l8-12M232 150l8-12M232 180l8-12" />
        <path d="M130 30h150M236 14v16M236 14l-100 16M236 14l44 16" />
        <rect x="262" y="30" width="14" height="10" rx="1" />
        <g className="ba-hook">
          <line x1="160" y1="30" x2="160" y2="70" />
          <rect x="150" y="70" width="20" height="8" rx="1" />
        </g>
      </g>
    </svg>
  );
}
