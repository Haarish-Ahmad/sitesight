import { useEffect, useRef, useState, type ReactNode } from "react";
import { aiInfo, api, shrinkPhoto } from "../lib";
import { Icon, MicButton, Modal, useFeedback } from "../ui";
import { UpdateCard, useProject } from "./common";

type Msg = { role: "you" | "ai"; text: string; thumb?: string; refs?: string[]; read?: string[]; error?: boolean; offline?: boolean };

// Questions built from this site's own blocks, flats and stages, so the first tap gives a useful answer.
function suggestions(ctx: ReturnType<typeof useProject>) {
  const rooms = ctx.data.project.rooms;
  const block = rooms.find((r) => r.block)?.block;
  const unit = rooms.find((r) => r.unit)?.unit;
  const top = Object.entries(ctx.summary.stageCounts).filter(([k]) => k !== "not_started").sort((a, b) => b[1] - a[1])[0]?.[0];
  return [
    "What changed this week?",
    block ? `How far along is Block ${block}?` : "How much work is done on each floor?",
    unit ? `What is left in Flat ${unit}?` : `What is left in the kitchen?`,
    top ? `Which rooms are at ${top}?` : "Which rooms have not started yet?",
    "What needs my review?",
    "Are there any high priority issues?",
  ];
}
const key = (id: string) => `sitesight.chat.${id}`;
const load = (id: string): Msg[] => {
  try {
    return JSON.parse(localStorage.getItem(key(id)) ?? "[]");
  } catch {
    return [];
  }
};

export function Chat() {
  const ctx = useProject();
  const pid = ctx.data.project.id;
  const [log, setLog] = useState<Msg[]>(() => load(pid));
  useEffect(() => {
    try {
      localStorage.setItem(key(pid), JSON.stringify(log.slice(-40)));
    } catch {}
  }, [log, pid]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [fast, setFast] = useState(true);
  const pick = useRef<HTMLInputElement>(null);
  const { toast } = useFeedback();
  useEffect(() => void aiInfo().then((a) => setFast(a.fast)), []);
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => void ((log.length || busy) && end.current?.scrollIntoView({ behavior: "smooth", block: "end" })), [log, busy]); // void: newer browsers return a Promise here

  async function ask(typed: string) {
    if ((!typed.trim() && !photo) || busy) return;
    const question = typed.trim() || "What stage of work is this, and does anything look wrong?";
    const attached = photo;
    setQ("");
    setPhoto(null);
    setBusy(true);
    try {
      // a small copy for the conversation, a bigger one for the AI
      const [thumb, image] = attached ? await Promise.all([shrinkPhoto(attached.file, 240), shrinkPhoto(attached.file)]) : [];
      setLog((l) => [...l, { role: "you", text: question, ...(thumb && { thumb: `data:image/jpeg;base64,${thumb}` }) }]);
      // the last few exchanges, so "and Block B?" makes sense
      const history: { q: string; a: string }[] = [];
      for (let i = 0; i < log.length - 1; i++) if (log[i].role === "you" && log[i + 1].role === "ai" && !log[i + 1].error) history.push({ q: log[i].text.slice(0, 500), a: log[i + 1].text.slice(0, 1500) });
      const r = await api<{ answer: string; refs: string[]; read: string[]; offline: boolean }>(`${ctx.base}/chat`, { method: "POST", json: { question, history: history.slice(-3), image } });
      setLog((l) => [...l, { role: "ai", text: r.answer || "I could not find an answer in the site records.", refs: r.refs, read: r.read, offline: r.offline }]);
    } catch (e) {
      setLog((l) => [...l, { role: "ai", text: (e as Error).message, error: true }]);
    }
    setBusy(false);
  }

  const cite = (id: string, key: string | number) => (
    <button key={key} className="cite" onClick={() => setRef(id)} aria-label={`Open ${id.startsWith("U") ? "update" : "issue"} ${id.slice(1)}`}>
      {id.startsWith("U") ? <Icon name="camera" size={12} /> : <Icon name="alert" size={12} />} {id.startsWith("U") ? "Update" : "Issue"} {id.slice(1)}
    </button>
  );
  // turn "[U12]" into a button that opens the cited record
  const render = (m: Msg): ReactNode[] => m.text.split(/(\[[UI]\d+\])/g).map((part, i) => (/^\[[UI]\d+\]$/.test(part) ? cite(part.slice(1, -1), i) : part));

  const cited = ref?.startsWith("U") ? ctx.data.updates.find((u) => `U${u.id}` === ref) : null;
  const citedIssue = ref?.startsWith("I") ? ctx.data.issues.find((i) => `I${i.id}` === ref) : null;

  return (
    <div className="chat card">
      <div className="chat-log" aria-live="polite">
        {!log.length && (
          <div className="chat-intro">
            <h2><Icon name="chat" /> Ask about this site</h2>
            <p className="muted">Ask about any block, floor, flat or room: progress, what is left, photos, issues. Answers come only from your site records, and facts link to the update or issue they came from. Tap <Icon name="image" size={14} /> to ask about a photo, or <Icon name="mic" size={14} /> to speak.</p>
            <div className="quick">{suggestions(ctx).map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}</div>
          </div>
        )}
        {log.map((m, i) => (
          <div key={i} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
            {m.thumb && <img className="msg-photo" src={m.thumb} alt="Photo sent with the question" />}
            <p>{render(m)}</p>
            {m.offline && <small className="offline">AI offline: figures computed directly from the records.</small>}
            {m.role === "ai" && !m.error && !m.offline && !m.refs?.length && (
              <small className="muted read">
                No records cited, so check this answer.{m.read?.length ? <> Records the AI read: {m.read.map((id) => cite(id, id))}</> : null}
              </small>
            )}
          </div>
        ))}
        {busy && <div className="msg ai typing"><p className="muted"><span className="dots"><i /><i /><i /></span> Reading the site records{fast ? "…" : "… (the local AI can take a few minutes)"}</p></div>}
        <div ref={end} />
      </div>
      {photo && (
        <div className="chat-attach">
          <img src={photo.url} alt="" />
          <span className="small">Photo attached. Ask about it, or just tap Ask.</span>
          <button type="button" className="icon-btn" onClick={() => setPhoto(null)} aria-label="Remove the photo"><Icon name="x" size={16} /></button>
        </div>
      )}
      <form className="chat-input" onSubmit={(e) => (e.preventDefault(), ask(q))}>
        {log.length > 0 && <button type="button" className="icon-btn" onClick={() => setLog([])} aria-label="Start a new conversation" title="New conversation"><Icon name="plus" /></button>}
        <button type="button" className="icon-btn" onClick={() => pick.current?.click()} aria-label="Attach a photo" title="Ask about a photo"><Icon name="image" /></button>
        <input
          ref={pick}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast("Use a JPEG, PNG or WebP photo", "error");
            setPhoto({ file: f, url: URL.createObjectURL(f) });
          }}
        />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={photo ? "Ask about this photo…" : "Ask about a block, floor, flat or room…"} maxLength={500} aria-label="Your question" />
        <MicButton onText={(t) => setQ((x) => (x ? `${x} ${t}` : t).slice(0, 500))} />
        <button className="btn primary send" disabled={busy || (!q.trim() && !photo)} aria-label="Ask"><Icon name="send" size={16} /> <span>Ask</span></button>
      </form>
      {ref && (
        <Modal title={cited ? `Update #${cited.id}` : citedIssue ? `Issue #${citedIssue.id}` : "Record"} onClose={() => setRef(null)}>
          {cited ? <UpdateCard u={cited} /> : citedIssue ? (
            <div className="stack">
              <h3>{citedIssue.title}</h3>
              <p className="muted">{citedIssue.scopeLabel} · {citedIssue.severity} · {citedIssue.status}</p>
              {citedIssue.note && <p>{citedIssue.note}</p>}
              <a className="btn ghost" href={ctx.href("issues")} onClick={() => setRef(null)}>Open issues</a>
            </div>
          ) : <p>This record no longer exists.</p>}
        </Modal>
      )}
    </div>
  );
}
