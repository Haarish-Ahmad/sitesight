import { useMemo, useState } from "react";
import { buildReport, type Period } from "../../src/report";
import { stageLabel } from "../../src/stages";
import { statusOf } from "../../src/summary";
import { dateKey, fmtDateTime, fmtTime, fromKey, plural, shareLink, whatsapp } from "../lib";
import { Icon, Segmented } from "../ui";
import { updatePhotos, useProject } from "./common";

const STATUS_TEXT = { needs_review: "Needs review", checking: "Checking photo", looks_right: "Looks right", approved: "Approved", rejected: "Rejected", no_photo: "No photo" };

export function Reports() {
  const ctx = useProject();
  const { project, updates, issues } = ctx.data;
  const latest = updates.map((u) => u.at).sort().pop();
  const [period, setPeriod] = useState<Period>("day");
  const [day, setDay] = useState(dateKey(latest ?? new Date()));
  const r = useMemo(() => buildReport(project.rooms, updates, issues, period, fromKey(day)), [project.rooms, updates, issues, period, day]);
  const shift = (n: number) => {
    const d = fromKey(day);
    if (period === "month") d.setMonth(d.getMonth() + n, 1);
    else d.setDate(d.getDate() + n * (period === "week" ? 7 : 1));
    setDay(dateKey(d));
  };
  const byId = new Map(updates.map((u) => [u.id, u]));

  return (
    <div className="reports">
      <div className="toolbar card no-print">
        <Segmented label="Report type" value={period} onChange={setPeriod} options={[["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]]} />
        <div className="day-pick">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label={`Previous ${period}`}><Icon name="left" /></button>
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Report date" />
          <button className="icon-btn" onClick={() => shift(1)} aria-label={`Next ${period}`}><Icon name="right" /></button>
        </div>
        <span className="spacer" />
        <div className="report-actions">
        {!ctx.readOnly && (
          <a className="btn ghost" href={whatsapp(`*${project.name}* · ${r.title}\n\n${r.narrative.join(" ")}${shareLink(project.shareToken) ? `\n\nFull report with photos: ${shareLink(project.shareToken)}/reports` : ""}`)} target="_blank" rel="noreferrer">
            <Icon name="chat" size={16} /> WhatsApp
          </a>
        )}
        <button className="btn primary" onClick={() => print()}><Icon name="printer" size={16} /> Download PDF</button>
        </div>
      </div>
      <p className="muted small no-print">“Download PDF” opens the print window: choose <b>Save as PDF</b> as the printer.</p>

      <article className="paper">
        <header className="paper-head">
          <div>
            <p className="kicker">{project.name}{project.location ? ` · ${project.location}` : ""}</p>
            <h1>{r.title}</h1>
          </div>
          <p className="small">Generated {fmtDateTime(new Date())}</p>
        </header>

        <section>
          <h2>Summary</h2>
          {r.narrative.map((t) => <p key={t}>{t}</p>)}
        </section>

        <section className="paper-stats">
          <div><b>{r.progressEnd}%</b><span>overall progress{r.progressEnd !== r.progressStart ? ` (was ${r.progressStart}%)` : ""}</span></div>
          <div><b>{r.logged.length}</b><span>updates logged</span></div>
          <div><b>{r.advanced}</b><span>rooms moved forward</span></div>
          <div><b>{r.photos.length}</b><span>photos</span></div>
        </section>

        {r.logged.length > 0 && (
          <section>
            <h2>Work logged</h2>
            <table className="paper-table">
              <thead><tr><th>{period === "day" ? "Time" : "When"}</th><th>Where</th><th>Stage</th><th>Photos</th><th>Check</th></tr></thead>
              <tbody>
                {r.logged.map((u) => (
                  <tr key={u.id}>
                    <td data-label={period === "day" ? "Time" : "When"}>{period === "day" ? fmtTime(u.at) : fmtDateTime(u.at)}</td>
                    <td data-label="Where" className="where">{u.scopeLabel}{u.note && <div className="small">“{u.note}”</div>}</td>
                    <td data-label="Stage">{stageLabel(u.stage)}</td>
                    <td data-label="Photos">{u.photos.length}</td>
                    <td data-label="Check">{STATUS_TEXT[statusOf(u)]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {r.photos.length > 0 && (
          <section>
            <h2>Photos {r.photos.length > 24 && <span className="small">(first 24 of {r.photos.length})</span>}</h2>
            <div className="paper-photos">
              {r.photos.slice(0, 24).map((p) => (
                <figure key={p.file}>
                  <button className="plain-btn" onClick={() => { const u = byId.get(p.updateId)!; ctx.showPhotos(updatePhotos(ctx, u), u.photos.findIndex((x) => x.file === p.file)); }} aria-label={`Open photo: ${p.label}`}>
                    <img src={ctx.photo(p.file, 480)} alt="" loading="eager" />
                  </button>
                  <figcaption>{p.label} · {p.stage}{p.flagged && " · flagged"}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {(r.opened.length > 0 || r.resolved.length > 0) && (
          <section>
            <h2>Issues</h2>
            <ul>
              {r.opened.map((i) => <li key={`o${i.id}`}><b>New ({i.severity}):</b> {i.title}, {i.scopeLabel}</li>)}
              {r.resolved.map((i) => <li key={`r${i.id}`}><b>Resolved:</b> {i.title}, {i.scopeLabel}</li>)}
            </ul>
          </section>
        )}

        {r.review.length > 0 && (
          <section>
            <h2>Still to review</h2>
            <ul>{r.review.map((u) => <li key={u.id}>{u.scopeLabel}: {u.stage}{u.stage === "finishing" ? " (awaiting sign-off)" : ` (${u.photos.flatMap((p) => p.flags)[0] ?? "flagged"})`}</li>)}</ul>
          </section>
        )}
        <footer className="paper-foot small">SiteSight · {plural(project.rooms.length, "room")} tracked · AI checks are advisory and were not used to change any figures.</footer>
      </article>
    </div>
  );
}
