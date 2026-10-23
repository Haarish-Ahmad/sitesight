import { Fragment, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Guide } from "./Dashboard";
import { describeRooms } from "../src/structure";
import { summarise } from "../src/summary";
import { progressAlerts } from "../src/alerts";
import { api, flushOutbox, pendingUpdates, plural, type Bundle } from "./lib";
import { Chat } from "./tabs/Chat";
import { Ctx, type ProjectCtx } from "./tabs/common";
import { Documents } from "./tabs/Documents";
import { Issues } from "./tabs/Issues";
import { Overview } from "./tabs/Overview";
import { QrSheet } from "./tabs/QrSheet";
import { Reports } from "./tabs/Reports";
import { Review } from "./tabs/Review";
import { Settings } from "./tabs/Settings";
import { Timeline } from "./tabs/Timeline";
import { Upload } from "./tabs/Upload";
import { Empty, Icon, PhotoViewer, type IconName, type Scope, type ViewerPhoto } from "./ui";

// `phone`: shown in the bottom bar on phones; the rest go under "More"
const TABS: { id: string; label: string; icon: IconName; owner?: boolean; phone?: boolean }[] = [
  { id: "overview", label: "Overview", icon: "grid", phone: true },
  { id: "upload", label: "Upload", icon: "camera", owner: true, phone: true },
  { id: "timeline", label: "Timeline", icon: "clock" },
  { id: "review", label: "Review", icon: "flag", owner: true, phone: true },
  { id: "issues", label: "Issues", icon: "alert" },
  { id: "chat", label: "Ask AI", icon: "chat", owner: true, phone: true },
  { id: "reports", label: "Reports", icon: "file" },
  { id: "documents", label: "Documents", icon: "folder" },
  { id: "settings", label: "Settings", icon: "settings", owner: true },
];

// Ask AI lives in a glowing round button (like the AI buttons in Colab or Gmail) that opens a chat window from any section.
function AiOrb({ open, onClick, className = "" }: { open: boolean; onClick: () => void; className?: string }) {
  return (
    <button className={`ai-orb ${open ? "open" : ""} ${className}`} onClick={onClick} aria-expanded={open} aria-label={open ? "Close Ask AI" : "Ask AI about this site"} title="Ask AI">
      <span className="ai-orb-core"><span className="ai-orb-disc"><Icon name={open ? "x" : "sparkle"} size={22} /></span></span>
      <span className="ai-orb-label">Ask AI</span>
    </button>
  );
}

function AiPanel({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <section className="ai-panel" role="dialog" aria-label="Ask AI about this site">
      <header>
        <span className="ai-panel-title"><span className="ai-dot"><Icon name="sparkle" size={14} /></span> Ask AI</span>
        <span className="muted small">Answers from this site's records</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </header>
      <Chat />
    </section>
  );
}

// The three first steps as a button that opens a small panel, so it takes no room on the page.
function GetStarted() {
  const { data, href } = useContext(Ctx);
  const [open, setOpen] = useState(false);
  const done = [true, data.updates.length > 0, data.updates.some((u) => u.review) || !!data.project.shareToken];
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open]);
  if (done.every(Boolean)) return null;
  const n = done.filter(Boolean).length;
  return (
    <div className="get-started">
      <button className="guide-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog">
        Get started <b>{n}/3</b>
      </button>
      {open && (
        <>
          <div className="pop-backdrop" onClick={() => setOpen(false)} />
          <div className="guide-pop" role="dialog" aria-label="Get started in three steps">
            <header className="card-head">
              <h2>Get started</h2>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><Icon name="x" /></button>
            </header>
            <Guide done={done} />
            <div className="row-actions" onClick={() => setOpen(false)}>
              {!done[1] && <a className="btn primary" href={href("upload")}><Icon name="camera" size={16} /> Upload first photos</a>}
              {done[1] && !done[2] && <a className="btn primary" href={href("review")}><Icon name="flag" size={16} /> Review updates</a>}
              {done[1] && !done[2] && <a className="btn ghost" href={href("settings")}><Icon name="link" size={16} /> Share a link</a>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ProjectPage({ id, token, tab = "overview" }: { id?: string; token?: string; tab?: string }) {
  const readOnly = !id;
  const base = id ? `/api/projects/${id}` : `/api/share/${token}`;
  const hrefBase = id ? `#/p/${id}` : `#/share/${token}`;
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState("");
  const [viewer, setViewer] = useState<{ photos: ViewerPhoto[]; start: number } | null>(null);
  const [uploadPreset, setUploadPreset] = useState<Scope | null>(null);
  const [more, setMore] = useState(false);
  const [ai, setAi] = useState(false);
  const closeAi = useCallback(() => setAi(false), []);
  useEffect(() => setMore(false), [tab]);

  const reload = useCallback(async () => {
    try {
      setData(await api<Bundle>(base));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [base]);
  useEffect(() => void reload(), [reload]);

  // updates saved on this phone without signal: count them, send them when the signal is back
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (!id) return;
    let last = -1;
    const count = () =>
      pendingUpdates().then((l) => {
        const n = l.filter((p) => p.project === id).length;
        if (n < last) void reload(); // one went through
        setWaiting((last = n));
      }, () => {});
    const send = () => void flushOutbox();
    void count();
    send();
    addEventListener("sitesight:outbox", count);
    addEventListener("online", send);
    const t = setInterval(send, 30_000); // "online" fires late or never on some phones
    return () => (removeEventListener("sitesight:outbox", count), removeEventListener("online", send), clearInterval(t));
  }, [id, reload]);

  const summary = useMemo(() => (data ? summarise(data.project.rooms, data.updates, data.issues) : null), [data]);
  const alerts = useMemo(() => (data && summary ? progressAlerts(data.project.rooms, summary, data.updates) : null), [data, summary]);

  // while the AI is still looking at photos, refresh quietly so results appear on their own
  useEffect(() => {
    if (!summary?.checking) return;
    const t = setInterval(reload, 6000);
    return () => clearInterval(t);
  }, [summary?.checking, reload]);

  useEffect(() => {
    if (data) document.title = `${data.project.name} · SiteSight`;
  }, [data?.project.name]);

  if (error && !data) return <div className="page"><Empty icon="alert" title={readOnly ? "This link does not work" : "Cannot open this project"}>{error}</Empty></div>;
  if (!data || !summary || !alerts) return <div className="page"><div className="skeleton" /><div className="skeleton tall" /></div>;

  const tabs = TABS.filter((t) => !(readOnly && t.owner));
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const qr = tab === "qr" && !readOnly; // sticker sheet: a page of its own, not a tab
  const ctx: ProjectCtx = {
    data,
    summary,
    alerts,
    base,
    readOnly,
    apartment: data.project.spec.type === "apartment",
    rooms: new Map(data.project.rooms.map((r) => [r.id, r])),
    href: (t) => `${hrefBase}${t ? `/${t}` : ""}`,
    reload,
    photo: (file, w = 1600) => `${base}/photos/${file}?w=${w}`,
    showPhotos: (photos, start = 0) => photos.length && setViewer({ photos, start }),
    uploadPreset,
    setUploadPreset,
  };
  const badge: Record<string, number> = { review: summary.needsReview, issues: summary.openIssues + (readOnly ? 0 : summary.suggestedIssues) };
  // read-only viewers have five tabs: all fit in the bottom bar
  // Ask AI is the round button, not a section in the lists (#/p/<id>/chat still opens it as a page)
  const navTabs = tabs.filter((t) => t.id !== "chat" || current.id === "chat");
  const phoneTabs = readOnly ? tabs : navTabs.filter((t) => t.phone && t.id !== "chat");
  const moreTabs = readOnly ? [] : navTabs.filter((t) => !t.phone);
  const showOrb = !readOnly && current.id !== "chat";

  return (
    <Ctx.Provider value={ctx}>
      <div className="page wide">
        {!readOnly && <a className="back" href="#/"><Icon name="back" size={16} /> Projects</a>}
        <div className="project-head mesh">
          <div>
            <h1>{data.project.name}</h1>
            <p>
              {data.project.location && <><Icon name="pin" size={14} /> {data.project.location} · </>}
              {describeRooms(data.project.spec.type, data.project.rooms)}
            </p>
          </div>
          {!readOnly && (
            <div className="row-actions">
              <a className="btn ghost" href={ctx.href("settings")}><Icon name="link" size={16} /> Share</a>
              <a className="btn primary" href={ctx.href("upload")}><Icon name="camera" size={16} /> Add update</a>
            </div>
          )}
        </div>
        {waiting > 0 && (
          <p className="banner sync" role="status">
            <span className="dots"><i /><i /><i /></span>
            <span><b>{plural(waiting, "update")} waiting to send.</b> Saved on this phone; sending when there is signal.</span>
            <button className="btn ghost small" onClick={() => void flushOutbox()}>Send now</button>
          </p>
        )}
        {readOnly && <p className="banner"><Icon name="eye" size={16} /> You are viewing a read-only copy shared by the site team. Nothing here can be changed.</p>}
        <div className="project-body">
        <aside className="tabs-row">
          <nav className="tabs" aria-label="Project sections">
            {navTabs.map((t) => (
              <a key={t.id} href={ctx.href(t.id)} className={t.id === current.id ? "on" : ""} aria-current={t.id === current.id ? "page" : undefined}>
                <Icon name={t.icon} size={22} /> {t.label}
                {badge[t.id] > 0 && <span className="count-badge" aria-label={`${badge[t.id]} waiting`}>{badge[t.id]}</span>}
              </a>
            ))}
          </nav>
          {!readOnly && <GetStarted />}
        </aside>
        <section className="tab-body">
          {qr && <QrSheet />}
          {!qr && current.id === "overview" && <Overview />}
          {current.id === "upload" && <Upload />}
          {current.id === "timeline" && <Timeline />}
          {current.id === "review" && <Review />}
          {current.id === "issues" && <Issues />}
          {current.id === "chat" && <Chat />}
          {current.id === "reports" && <Reports />}
          {current.id === "documents" && <Documents />}
          {current.id === "settings" && <Settings />}
        </section>
        </div>
      </div>
      <nav className="bottom-nav" aria-label="Project sections">
        {phoneTabs.map((t, i) => (
          <Fragment key={t.id}>
            {showOrb && i === 2 && <AiOrb className="in-nav" open={ai} onClick={() => setAi(!ai)} />}
            <a href={ctx.href(t.id)} className={t.id === current.id ? "on" : ""} aria-current={t.id === current.id ? "page" : undefined}>
              <Icon name={t.icon} /> {t.label}
              {badge[t.id] > 0 && <span className="count-badge">{badge[t.id]}</span>}
            </a>
          </Fragment>
        ))}
        {moreTabs.length > 0 && (
          <button className={moreTabs.some((t) => t.id === current.id) ? "on" : ""} onClick={() => setMore(!more)} aria-expanded={more}>
            <Icon name="list" /> More
            {badge.issues > 0 && <span className="count-badge">{badge.issues}</span>}
          </button>
        )}
      </nav>
      {more && (
        <>
          <div className="sheet-backdrop" onClick={() => setMore(false)} />
          <nav className="sheet" aria-label="More sections">
            {moreTabs.map((t) => (
              <a key={t.id} href={ctx.href(t.id)} onClick={() => setMore(false)}>
                <Icon name={t.icon} /> {t.label} {badge[t.id] > 0 && <span className="count-badge">{badge[t.id]}</span>}
              </a>
            ))}
            <a href="#/" onClick={() => setMore(false)}><Icon name="home" /> All projects</a>
          </nav>
        </>
      )}
      {showOrb && <AiOrb className="floating" open={ai} onClick={() => setAi(!ai)} />}
      {showOrb && ai && <AiPanel onClose={closeAi} />}
      {viewer && <PhotoViewer photos={viewer.photos} start={viewer.start} onClose={() => setViewer(null)} />}
    </Ctx.Provider>
  );
}
