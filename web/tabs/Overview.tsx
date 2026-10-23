import { useEffect, useMemo, useState } from "react";
import { ago, plainSummary, weeksText } from "../../src/describe";
import type { Eta } from "../../src/types";
import { enoughHistory, MIN_HISTORY_DAYS, typicalCrew } from "../../src/finish";
import { groupOf, ORDER, stageLabel } from "../../src/stages";
import { floorLabel, roomLabel, scopeLabel, type Room } from "../../src/structure";
import { meanProgress, needsReview } from "../../src/summary";
import type { Alert } from "../../src/alerts";
import { aiInfo, api, fmtDay, go, plural, shareLink, whatsapp } from "../lib";
import type { Item } from "../../src/checklist";
import { ALL, BeforeAfter, CountUp, Empty, Icon, Legend, matchScope, Modal, Progress, Ring, scopeFor, ScopePicker, StageBadge, useFeedback, type Scope } from "../ui";
import { UpdateCard, updatePhotos, useProject } from "./common";

const fmtShort = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const KIND = { uneven: "Uneven", stalled: "Stalled", behind: "Behind", site_idle: "Site idle" } as const;

function alertSentence(alerts: Alert[], more: number) {
  const n = alerts.length + more;
  const urgent = alerts.filter((a) => a.severity === "high").length;
  const kinds = [...new Set(alerts.map((a) => ({ uneven: "uneven progress", stalled: "stalled work", behind: "falling behind", site_idle: "no updates" })[a.kind]))];
  return `${plural(n, "area")} ${n === 1 ? "needs" : "need"} attention${urgent ? ` (${urgent} urgent)` : ""}: ${kinds.join(", ")}.`;
}

export type Cell = { key: string; label: string; title: string; rooms: Room[]; scope: Scope };
type Row = { key: string; label: string; cells: Cell[] };
type Section = { key: string; title: string; rows: Row[] };

// Apartments: one section per block, rows = floors (top first), cells = flats + shared spaces.
// Houses: rows = floors, cells = rooms.
export function layout(rooms: Room[], apartment: boolean): Section[] {
  const floorsOf = (rs: Room[]) => [...new Set(rs.map((r) => r.floor))].sort((a, b) => (b ?? -999) - (a ?? -999));
  const scopeOf = (rs: Room[]): Scope => (rs.length === 1 ? scopeFor(rs[0], true) : { ...scopeFor(rs[0], true), name: rs.every((r) => r.name === rs[0].name) ? rs[0].name : "" });
  if (!apartment) {
    const rows = floorsOf(rooms).map((f) => ({
      key: String(f),
      label: floorLabel(f),
      cells: rooms.filter((r) => r.floor === f).map((r) => ({ key: r.id, label: r.name, title: roomLabel(r), rooms: [r], scope: scopeFor(r) })),
    }));
    return [{ key: "house", title: "", rows }];
  }
  return [...new Set(rooms.map((r) => r.block))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b))).map((b) => {
    const inBlock = rooms.filter((r) => r.block === b);
    // site-wide areas (pool, parking): one cell each
    if (b === null)
      return { key: "site", title: "Site-wide areas", rows: [{ key: "site", label: "Site", cells: inBlock.map((r) => ({ key: r.id, label: r.name, title: r.name, rooms: [r], scope: scopeFor(r, true) })) }] };
    const rows = floorsOf(inBlock).map((f) => {
      const onFloor = inBlock.filter((r) => r.floor === f);
      const units = [...new Set(onFloor.map((r) => r.unit))];
      const cells = units.map((u) => {
        const rs = onFloor.filter((r) => r.unit === u);
        const label = u ? u.split("-")[1] : f === null ? "Outside" : "Shared";
        const s = scopeOf(rs);
        return { key: `${b}-${f}-${u}`, label, title: u ? `Flat ${u}` : `Block ${b} · ${floorLabel(f)} · ${f === null ? "outside" : "shared spaces"}`, rooms: rs, scope: { ...s, name: "" } };
      });
      return { key: `${b}-${f}`, label: floorLabel(f), cells };
    });
    return { key: b, title: `Block ${b}`, rows };
  });
}

export function Overview() {
  const ctx = useProject();
  const { data, summary: s, readOnly } = ctx;
  const { toast } = useFeedback();
  const rooms = data.project.rooms;
  const sections = useMemo(() => layout(rooms, ctx.apartment), [rooms, ctx.apartment]);
  const [open, setOpen] = useState<Cell | null>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [compare, setCompare] = useState<string | null>(null);

  const review = data.updates.filter(needsReview).sort((a, b) => b.at.localeCompare(a.at));
  const { alerts, more, notStarted } = ctx.alerts;
  const alertFor = useMemo(() => new Map(alerts.flatMap((a) => a.roomIds.map((id) => [id, a] as const))), [alerts]);
  const [showUntouched, setShowUntouched] = useState(false);
  const issues = data.issues.filter((i) => i.status === "open").sort((a, b) => (a.severity === "high" ? -1 : 0) - (b.severity === "high" ? -1 : 0));
  const newest = [...data.updates].sort((a, b) => b.at.localeCompare(a.at));
  const recent = newest.slice(0, 3);
  const cover = newest.find((u) => u.review !== "rejected" && u.photos.length);
  const highAlert = alerts.some((a) => a.severity === "high") || s.highIssues > 0;
  const status = !s.roomsStarted ? ["", "Not started yet"] : s.etaDays === 0 ? ["good", "All work finished"] : highAlert ? ["bad", "Needs attention"] : alerts.length || s.needsReview ? ["warn", "A few things to check"] : ["good", "On track"];
  const headline = !s.updatesCount ? "No site updates yet" : s.etaDays === 0 ? "Everything is finished" : `${s.roomsStarted} of ${plural(s.roomsTotal, "room")} under way`;
  const subline = `${s.roomsDone} finished`;
  // the ring and headline already say the first (progress) sentence and the finish-date one
  const heroLines = plainSummary(data.project.name, rooms, s, new Date(), readOnly).filter((t, i) => !(s.updatesCount && i === 0) && !t.startsWith("Finish date"));
  const shareText = `*${data.project.name}* · site update\n\n${plainSummary(data.project.name, rooms, s, new Date(), true).join(" ")}${shareLink(data.project.shareToken) ? `\n\nSee photos and progress: ${shareLink(data.project.shareToken)}` : ""}`;

  const cellInfo = (c: Cell) => {
    const ids = c.rooms.map((r) => r.id);
    const st = ids.map((id) => s.states[id]);
    const avg = st.reduce((n, x) => n + x.stageNo, 0) / st.length;
    const started = st.filter((x) => x.stageNo > 0).length;
    const top = ORDER.map((o) => ({ o, n: st.filter((x) => x.stage === o).length })).sort((a, b) => b.n - a.n)[0];
    const pending = st.some((x) => x.pendingFinish);
    return { pct: meanProgress(ids, s.states), group: groupOf(avg), started, top: top.n ? top.o : null, pending, done: st.every((x) => x.stage === "finishing") };
  };

  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null); // a fixed tooltip would otherwise float away from its cell on scroll
    addEventListener("scroll", hide, true);
    return () => removeEventListener("scroll", hide, true);
  }, [tip]);

  // fixed-position tooltip: drawn outside the map's scroll box so it is never clipped
  const showTip = (el: HTMLElement, text: string) => {
    const r = el.getBoundingClientRect();
    const below = r.top < 90;
    setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
  };

  const uploadFor = (scope: Scope) => {
    ctx.setUploadPreset(scope);
    setOpen(null);
    go(ctx.href("upload").slice(1));
  };

  return (
    <div className="overview">
      <section className="stats" aria-label="Key numbers">
        <div className="stat card"><small><i className="stat-ico"><Icon name="check" size={16} /></i>Done</small><b><CountUp value={s.progressPct} />%</b><span className="muted small">{headline}</span></div>
        <a className={`stat card link ${s.needsReview ? "warn" : ""}`} href={ctx.href(readOnly ? "timeline" : "review")}><small><i className="stat-ico"><Icon name="flag" size={16} /></i>Needs review</small><b><CountUp value={s.needsReview} /></b><span className="muted small">{s.checking ? `${plural(s.checking, "photo")} with the AI` : "updates waiting"}</span></a>
        <a className={`stat card link ${s.highIssues ? "bad" : ""}`} href={ctx.href("issues")}><small><i className="stat-ico"><Icon name="alert" size={16} /></i>Open issues</small><b><CountUp value={s.openIssues} /></b><span className="muted small">{s.highIssues ? `${s.highIssues} high priority` : s.suggestedIssues && !readOnly ? `${s.suggestedIssues} AI suggestions` : "none urgent"}</span></a>
        <EtaCard />
      </section>

      <div className="focus-row">
        <section className="hero-card">
          <div className="hero-photo">
            {cover ? <img src={ctx.photo(cover.photos[0].file, 960)} alt={`Latest photo: ${cover.scopeLabel}`} /> : <div className="hero-placeholder"><Icon name={ctx.apartment ? "building" : "home"} size={56} /></div>}
            {cover && <span className="hero-caption"><Icon name="camera" size={13} /> {cover.scopeLabel} · {ago(cover.at)}</span>}
          </div>
          <div className="hero-body">
            <div className="hero-top">
              <Ring value={s.progressPct} />
              <div>
                <p className={`status-line ${status[0]}`}><i /> {status[1]}</p>
                <h2>{headline}</h2>
                <p className="muted small">{subline}</p>
              </div>
            </div>
            <div className="plain">
              {heroLines.map((t) => <p key={t}>{t}</p>)}
              {alerts.length > 0 && <p>{alerts[0].kind === "site_idle" ? `${alerts[0].detail}.` : alertSentence(alerts, more)}</p>}
              {notStarted.count > 0 && notStarted.count < notStarted.total && <p>{notStarted.count} of {plural(notStarted.total, notStarted.noun)} have not started yet.</p>}
            </div>
            {!readOnly && (
              <div className="hero-actions">
                <a className="btn primary big" href={ctx.href("upload")}><Icon name="camera" /> Add update</a>
                <a className="btn ghost big" href={ctx.href("chat")}><Icon name="sparkle" /> Ask AI</a>
                <a className="btn ghost big wa" href={whatsapp(shareText)} target="_blank" rel="noreferrer" aria-label="Send this update on WhatsApp" title="Send on WhatsApp"><Icon name="chat" /> <span>WhatsApp</span></a>
              </div>
            )}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Progress map</h2>
            <div className="row-actions">
            {!readOnly && <a className="btn ghost small" href={ctx.href("qr")}><Icon name="qr" size={14} /> QR stickers</a>}
            <div className="segmented small" role="radiogroup" aria-label="View">
              <button role="radio" aria-checked={view === "map"} className={view === "map" ? "on" : ""} onClick={() => setView("map")}><Icon name="grid" size={14} /> Map</button>
              <button role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}><Icon name="list" size={14} /> List</button>
            </div>
            </div>
          </div>
          <Legend />
          {view === "map" ? (
            <div className="map">
              {sections.map((sec) => (
                <div className="map-block" key={sec.key} style={{ ["--cols" as string]: Math.max(...sec.rows.map((r) => r.cells.length)) }}>
                  {sec.title && (
                    <h3>
                      {sec.title} <span className="muted small">{meanProgress(sec.rows.flatMap((r) => r.cells.flatMap((c) => c.rooms.map((x) => x.id))), s.states)}%</span>
                    </h3>
                  )}
                  <div className="map-rows">
                    {sec.rows.map((row) => (
                      <div className="map-row" key={row.key}>
                        <span className="map-label">{row.label}</span>
                        <div className="map-cells">
                          {row.cells.map((c) => {
                            const info = cellInfo(c);
                            const lag = c.rooms.map((r) => alertFor.get(r.id)).find(Boolean);
                            const tip = `${c.title} · ${info.pct}% · ${info.started} of ${plural(c.rooms.length, "room")} started${info.top ? ` · mostly ${info.top}` : ""}${info.pending ? " · finishing awaits approval" : ""}${lag ? ` · ${lag.detail}` : ""}`;
                            return (
                              <button key={c.key} className={`cell g${info.group} ${info.done ? "done" : ""} ${!ctx.apartment || sec.key === "site" ? "wide" : ""} ${lag ? `lag ${lag.severity}` : ""}`} onClick={() => setOpen(c)} aria-label={tip} onMouseEnter={(e) => showTip(e.currentTarget, tip)} onFocus={(e) => showTip(e.currentTarget, tip)} onMouseLeave={() => setTip(null)} onBlur={() => setTip(null)}>
                                <span>{c.label}</span>
                                <small>{info.done ? <Icon name="check" size={12} /> : `${info.pct}%`}</small>
                                {info.pending && <i className="dot" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Where</th><th>Progress</th><th>Current stage</th></tr>
              </thead>
              <tbody>
                {sections.flatMap((sec) =>
                  sec.rows.flatMap((row) =>
                    row.cells.map((c) => {
                      const info = cellInfo(c);
                      return (
                        <tr key={c.key} onClick={() => setOpen(c)} className="clickable">
                          <td>{ctx.apartment ? `${sec.title} · ${row.label} · ${c.title.startsWith("Flat") ? c.title : c.label}` : `${row.label} · ${c.label}`}</td>
                          <td><span className="pct">{info.pct}%</span></td>
                          <td>{info.top ? stageLabel(info.top) : "Not started"}{info.started < c.rooms.length && info.started > 0 ? ` (${info.started}/${c.rooms.length} rooms)` : ""}</td>
                        </tr>
                      );
                    }),
                  ),
                )}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="two-col">
      <section className="card">
        <div className="card-head"><h2>To do today</h2></div>
        {!review.length && !issues.length && !alerts.length && !notStarted.count ? (
          <Empty icon="check" title="All clear">Nothing is waiting for a review and there are no open issues.</Empty>
        ) : (
          <ul className="attention">
            {alerts.slice(0, 5).map((a) => (
              <li key={`a${a.key}`} className={`lagging ${a.severity}`}>
                <Icon name={a.kind === "uneven" ? "alert" : "clock"} size={16} />
                <div>
                  <b>{a.label}</b>
                  <p className="muted small">
                    <span className={`sev sev-${a.severity}`}>{a.severity === "high" ? "High" : "Check"}</span> · {KIND[a.kind]} · {a.detail}
                  </p>
                </div>
              </li>
            ))}
            {alerts.length + more > 5 && <li className="muted small">+{alerts.length + more - 5} more, outlined on the map</li>}
            {review.slice(0, 4).map((u) => (
              <li key={u.id}>
                <Icon name="flag" size={16} />
                <div>
                  <a href={ctx.href(readOnly ? "timeline" : "review")}><b>{u.scopeLabel}</b></a>
                  <p className="muted small">{u.stage === "finishing" ? "Marked finished, waiting for approval" : u.photos.flatMap((p) => p.flags)[0]}{ctx.alerts.reviewNotes[u.id] ? " · also far ahead of the rest of the area" : ""} · {ago(u.at)}</p>
                </div>
              </li>
            ))}
            {notStarted.count > 0 && (
              <li className="untouched">
                <Icon name="grid" size={16} />
                <div>
                  <button className="plain-link" onClick={() => setShowUntouched(!showUntouched)} aria-expanded={showUntouched}>
                    <b>{notStarted.count} of {plural(notStarted.total, notStarted.noun)} not started</b>
                  </button>
                  {showUntouched ? (
                    <p className="muted small">{notStarted.labels.slice(0, 30).join(" · ")}{notStarted.labels.length > 30 ? ` · and ${notStarted.labels.length - 30} more` : ""}</p>
                  ) : (
                    <p className="muted small">Not an alarm: shown so nothing is forgotten. Tap to list them.</p>
                  )}
                </div>
              </li>
            )}
            {issues.slice(0, 4).map((i) => (
              <li key={`i${i.id}`}>
                <Icon name="alert" size={16} />
                <div>
                  <a href={ctx.href("issues")}><b>{i.title}</b></a>
                  <p className="muted small"><span className={`sev sev-${i.severity}`}>{i.severity}</span> · {i.scopeLabel} · {ago(i.at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Latest updates</h2>
          {recent.length > 0 && <a className="small" href={ctx.href("timeline")}>See all</a>}
        </div>
        {recent.length ? (
          <div className="stack">{recent.map((u) => <UpdateCard key={u.id} u={u} compact />)}</div>
        ) : (
          <Empty icon="camera" title="No updates yet" action={!readOnly && <a className="btn primary" href={ctx.href("upload")}>Upload photos</a>}>Updates appear here as soon as the site team uploads photos.</Empty>
        )}
      </section>
      </div>

      <ChecklistCard />

      {tip && <div className={`tip ${tip.below ? "below" : ""}`} style={{ left: tip.x, top: tip.y }} role="tooltip">{tip.text}</div>}
      {open && (
        <Modal title={open.title} onClose={() => (setOpen(null), setCompare(null))}>
          <p className="muted">{scopeLabel(open.rooms)} · {cellInfo(open).pct}% complete</p>
          <ul className="room-list">
            {open.rooms.map((r) => {
              const st = s.states[r.id];
              const items = r.items ?? [];
              const done = items.filter((i) => i.doneAt).length;
              // every photo of this room, oldest first: how it got to where it is
              const history = data.updates.filter((u) => u.roomIds.includes(r.id) && u.photos.length && u.review !== "rejected").sort((a, b) => a.at.localeCompare(b.at));
              return (
                <li key={r.id}>
                  <div>
                    <b>{r.name}</b>
                    <p className="muted small">{st.lastAt ? `Updated ${ago(st.lastAt)}` : "No updates yet"}{items.length ? ` · ${done} of ${items.length} items done` : ""}</p>
                  </div>
                  <StageBadge stage={st.stage} pending={!!st.pendingFinish} />
                  {compare === r.id && history.length > 1 && (
                    <div className="ba-wrap">
                      <BeforeAfter before={ctx.photo(history[0].photos[0].file, 960)} after={ctx.photo(history[history.length - 1].photos[0].file, 960)} beforeLabel={`${fmtShort(history[0].at)} · ${history[0].stage}`} afterLabel={`${fmtShort(history[history.length - 1].at)} · ${history[history.length - 1].stage}`} />
                    </div>
                  )}
                  {history.length > 0 && (
                    <div className="history" aria-label={`Photo history of ${r.name}`}>
                      {history.map((u) => (
                        <figure key={u.id}>
                          <button className="thumb" onClick={() => ctx.showPhotos(updatePhotos(ctx, u))} aria-label={`Photos from ${fmtDay(u.at)}: ${u.stage}`}>
                            <img src={ctx.photo(u.photos[0].file, 240)} alt="" loading="lazy" />
                          </button>
                          <figcaption>{fmtShort(u.at)} · {u.stage}</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                  {history.length > 1 && (
                    <div className="row-actions">
                      <button className="btn ghost small" onClick={() => setCompare(compare === r.id ? null : r.id)} aria-expanded={compare === r.id}><Icon name="compare" size={14} /> {compare === r.id ? "Hide comparison" : "Compare before / now"}</button>
                    </div>
                  )}
                  {items.length > 0 && <Checklist roomId={r.id} items={items} />}
                  {!readOnly && (
                    <div className="row-actions">
                      <button className="btn ghost small" onClick={() => uploadFor(scopeFor(r, ctx.apartment))}><Icon name="camera" size={14} /> Add update</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {!readOnly && open.rooms.length > 1 && (
            <div className="row-actions">
              <button className="btn primary" onClick={() => uploadFor(open.scope)}><Icon name="upload" size={16} /> Update all {open.rooms.length} rooms</button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// Required items for one room: tick as they go in. Read-only viewers see the list without checkboxes working.
function Checklist({ roomId, items }: { roomId: string; items: Item[] }) {
  const ctx = useProject();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState("");
  async function toggle(name: string, done: boolean) {
    setBusy(name);
    try {
      await api(`${ctx.base}/items`, { method: "POST", json: { roomIds: [roomId], name, done } });
      await ctx.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setBusy("");
  }
  return (
    <ul className="checklist" aria-label="Required items">
      {items.map((i) => (
        <li key={i.name} className={i.doneAt ? "done" : ""}>
          <label title={i.doneAt ? `Done ${fmtDay(i.doneAt)}` : undefined}>
            <input type="checkbox" checked={!!i.doneAt} disabled={ctx.readOnly || busy === i.name} onChange={(e) => toggle(i.name, e.target.checked)} />
            <span>{i.name}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

// Required items across the site, and ticking one item in many rooms at once.
function ChecklistCard() {
  const ctx = useProject();
  const { toast } = useFeedback();
  const rooms = ctx.data.project.rooms;
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>(ALL);
  const [busy, setBusy] = useState("");
  const all = rooms.flatMap((r) => r.items ?? []);
  if (!all.length) return null;
  const done = all.filter((i) => i.doneAt).length;
  const picked = matchScope(rooms, scope);
  const names = [...new Set(picked.flatMap((r) => (r.items ?? []).map((i) => i.name)))];
  const stat = (name: string) => {
    const has = picked.filter((r) => r.items?.some((i) => i.name === name));
    return { has, done: has.filter((r) => r.items!.find((i) => i.name === name)!.doneAt).length };
  };
  async function set(name: string, value: boolean) {
    setBusy(name);
    try {
      const { changed } = await api<{ changed: number }>(`${ctx.base}/items`, { method: "POST", json: { roomIds: stat(name).has.map((r) => r.id), name, done: value } });
      toast(`${name}: ${value ? "done" : "not done"} in ${plural(changed, "more room")}`);
      await ctx.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setBusy("");
  }
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Required items</h2>
          <p className="muted small" style={{ margin: 0 }}>{done} of {plural(all.length, "item")} done across {plural(rooms.filter((r) => r.items?.length).length, "room")}. Open a room on the map to tick items one by one.</p>
        </div>
        {!ctx.readOnly && <button className="btn ghost small" onClick={() => setOpen(true)}><Icon name="check" size={14} /> Tick for many rooms</button>}
      </div>
      <Progress value={(done / all.length) * 100} label="Required items done" />
      {open && (
        <Modal title="Tick items for many rooms" onClose={() => setOpen(false)}>
          <div className="stack">
            <ScopePicker rooms={rooms} value={scope} onChange={setScope} apartment={ctx.apartment} />
            {!names.length ? <p className="muted">These rooms have no required items.</p> : (
              <ul className="room-list">
                {names.map((n) => {
                  const st = stat(n);
                  return (
                    <li key={n}>
                      <div><b>{n}</b><p className="muted small">done in {st.done} of {plural(st.has.length, "room")}</p></div>
                      <div className="row-actions">
                        {st.done < st.has.length && <button className="btn dark small" disabled={!!busy} onClick={() => set(n, true)}>Mark done</button>}
                        {st.done > 0 && <button className="btn ghost small" disabled={!!busy} onClick={() => set(n, false)}>Undo</button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

// "~8 months" reads better than "243d"; the exact days go underneath
const span = (d: number) => (d === 0 ? "Done" : d < 60 ? plural(d, "day") : `~${Math.round(d / 30.4)} months`);
// Estimated finish. Until there is about a week of real progress it says "need more" instead of guessing;
// after that the AI's estimate, built on the pace so far, the building's size and a typical crew for that size.
function EtaCard() {
  const ctx = useProject();
  const { toast } = useFeedback();
  const s = ctx.summary;
  const [eta, setEta] = useState<Eta | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = enoughHistory(s) || (s.roomsTotal > 0 && s.roomsDone === s.roomsTotal);
  const crew = typicalCrew(ctx.data.project.rooms);

  async function ask() {
    setBusy(true);
    try {
      const r = await api<Eta | { need: "history" }>(`${ctx.base}/eta`, { method: "POST", json: {} });
      if (!("need" in r)) setEta(r);
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setBusy(false);
  }
  useEffect(() => {
    setEta(null);
    if (!ctx.readOnly && ready) void aiInfo().then((a) => void (a.fast && ask()));
  }, [ctx.data.updates.length, ready]);

  if (!ready)
    return (
      <div className="stat card eta-stat need">
        <small><i className="stat-ico"><Icon name="clock" size={16} /></i>Estimated finish</small>
        <b>Need more</b>
        <span className="muted small">
          {!s.updatesCount ? "No site updates yet." : `${plural(s.historyDays, "day")} of updates so far.`} A finish date needs about {MIN_HISTORY_DAYS} days of updates showing rooms moving forward.
        </span>
      </div>
    );

  const days = eta?.etaDays ?? (ctx.readOnly ? s.etaDays : null);
  return (
    <div className="stat card eta-stat">
      <small><i className="stat-ico"><Icon name="clock" size={16} /></i>Estimated finish</small>
      <b>{days === null ? (busy ? "…" : "—") : span(days)}</b>
      <span className="muted small">
        {days === null ? (busy ? "The AI is working it out…" : "Tap to ask the AI") : `${plural(days, "day")}${eta ? ` · ${eta.ai ? "AI" : "worked out"}, ${eta.confidence} confidence` : " · from the pace so far"}`}
      </span>
      {eta?.reason && <details className="eta-reason"><summary className="small">{eta.reason}</summary></details>}
      {!ctx.readOnly && (
        <>
          <span className="hint">Assumes about {crew.workers} workers, usual for a site this size</span>
          {!eta && !busy && <div className="row-actions"><button className="btn ghost small" onClick={ask}><Icon name="scan" size={14} /> Ask the AI</button></div>}
        </>
      )}
    </div>
  );
}
