import { createContext, useContext, useState } from "react";
import { roomLabel, scopeLabel, type Room } from "../../src/structure";
import { flagsOf, needsReview, statusOf, type Summary } from "../../src/summary";
import { FEATURES, type Feature } from "../../src/ai/schema";
import type { Alerts } from "../../src/alerts";
import type { Issue, Update } from "../../src/types";
import { api, buzz, fmtDateTime, fmtTime, plural, type Bundle } from "../lib";
import { ALL, Icon, matchScope, MicButton, Modal, ScopePicker, Segmented, StageBadge, StatusChip, useFeedback, type Scope, type ViewerPhoto } from "../ui";

export type ProjectCtx = {
  data: Bundle;
  summary: Summary;
  alerts: Alerts; // progress alerts, computed once after the AI checks
  base: string; // API prefix: /api/projects/<id> or /api/share/<token>
  href: (tab?: string) => string;
  readOnly: boolean;
  apartment: boolean;
  rooms: Map<string, Room>;
  reload: () => Promise<void>;
  photo: (file: string, w?: number) => string;
  showPhotos: (photos: ViewerPhoto[], start?: number) => void;
  uploadPreset: Scope | null;
  setUploadPreset: (s: Scope | null) => void;
};
export const Ctx = createContext<ProjectCtx>(null as never);
export const useProject = () => useContext(Ctx);

const FEATURE_LABEL: Record<Feature, string> = {
  soil: "bare ground", open_frame: "open framing", bare_masonry: "bare brick/block", plastered: "plastered walls", exposed_pipes: "exposed pipes",
  loose_wires: "loose wires", finished_floor: "finished floor", wall_tiles: "wall tiles", painted: "painted walls", fixtures: "fixtures fitted",
};

export function updatePhotos(ctx: ProjectCtx, u: Update): ViewerPhoto[] {
  return u.photos.map((p) => ({
    src: ctx.photo(p.file, 1600),
    full: ctx.photo(p.file, 0),
    title: u.scopeLabel,
    sub: `Reported: ${u.stage} · uploaded ${fmtDateTime(u.at)}${p.takenAt ? ` · taken ${fmtDateTime(p.takenAt)}` : ""}`,
    notes: (
      <>
        {p.checking && <p className="muted"><Icon name="scan" size={14} /> AI is still checking this photo…</p>}
        {p.ai && <p><Icon name="scan" size={14} /> AI sees <b>{p.ai.stage}</b> ({p.ai.confidence.replace(/_/g, " ")}){p.ai.materials.length ? ` · ${p.ai.materials.slice(0, 5).join(", ")}` : ""}</p>}
        {p.ai?.features && Object.values(p.ai.features).some(Boolean) && (
          <p className="muted small">Visible: {(Object.keys(FEATURES) as Feature[]).filter((k) => p.ai!.features![k]).map((k) => FEATURE_LABEL[k]).join(", ")}</p>
        )}
        {p.compare && (p.compare.verdict === "progress" || p.compare.verdict === "same_work") && (
          <p className={p.compare.verdict === "progress" ? "progress-seen" : "muted"}><Icon name={p.compare.verdict === "progress" ? "check" : "compare"} size={14} /> {p.compare.verdict === "progress" ? "More work than in update" : "No new work since update"} #{p.compare.since}{p.compare.note ? `: ${p.compare.note}` : ""}</p>
        )}
        {p.aiError && <p className="muted">The AI check could not run on this photo.</p>}
        {p.flags.map((f) => <p key={f} className={`flag ${u.review ? "resolved" : ""}`}><Icon name="flag" size={14} /> {f}</p>)}
      </>
    ),
  }));
}

export function UpdateCard({ u, compact }: { u: Update; compact?: boolean }) {
  const ctx = useProject();
  const { toast, confirm } = useFeedback();
  const [issueFor, setIssueFor] = useState(false);
  // optimistic: the card shows the decision at once; the server catches up behind it
  const [pending, setPending] = useState<Update["review"] | undefined>(undefined);
  const view = pending === undefined ? u : { ...u, review: pending };
  const status = statusOf(view);
  const flags = flagsOf(u);
  const ai = u.photos.filter((p) => p.ai);

  async function review(decision: "approved" | "rejected" | null) {
    buzz();
    setPending(decision);
    try {
      await api(`${ctx.base}/updates/${u.id}/review`, { method: "POST", json: { decision } });
      const text = decision === "approved" ? (u.stage === "finishing" ? "Approved as finished" : "Marked as checked") : decision === "rejected" ? "Claim rejected: it no longer counts toward progress" : "Review undone";
      toast(text, "ok", decision ? () => void review(null) : undefined);
      await ctx.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setPending(undefined);
  }
  async function remove() {
    const ok = await confirm({ title: "Delete this update?", body: <>This removes the claim <b>{u.stage}</b> for {u.scopeLabel} and its {plural(u.photos.length, "photo")}. Progress is recalculated. This cannot be undone.</>, confirm: "Delete update", danger: true });
    if (!ok) return;
    try {
      await api(`${ctx.base}/updates/${u.id}`, { method: "DELETE" });
      toast("Update deleted");
      await ctx.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <article className={`card update ${status}`} id={`U${u.id}`}>
      <header className="update-head">
        <div>
          <h3>{u.scopeLabel}</h3>
          <p className="muted small">#{u.id} · {compact ? fmtDateTime(u.at) : fmtTime(u.at)} · {plural(u.photos.length, "photo")}</p>
        </div>
        <div className="update-tags">
          <StageBadge stage={u.stage} />
          <StatusChip status={status} />
        </div>
      </header>
      {u.note && <p className="note">“{u.note}”</p>}
      {u.photos.length > 0 && (
        <div className="thumbs">
          {u.photos.slice(0, compact ? 4 : 12).map((p, i) => (
            <button key={p.file} className={`thumb ${p.flags.length && !u.review ? "flagged" : ""}`} onClick={() => ctx.showPhotos(updatePhotos(ctx, u), i)} aria-label={`Open photo ${i + 1} of ${u.photos.length}`}>
              <img src={ctx.photo(p.file, 360)} alt="" loading="lazy" />
              {p.checking && <span className="thumb-tag"><Icon name="scan" size={12} /></span>}
              {p.flags.length > 0 && !u.review && <span className="thumb-tag warn"><Icon name="flag" size={12} /></span>}
            </button>
          ))}
          {compact && u.photos.length > 4 && <span className="more">+{u.photos.length - 4}</span>}
        </div>
      )}
      {!compact && ai.length > 0 && (
        <p className="ai-line"><Icon name="scan" size={14} /> AI sees {[...new Set(ai.map((p) => `${p.ai!.stage} (${p.ai!.confidence.replace(/_/g, " ")})`))].join(", ")}</p>
      )}
      {flags.length > 0 && (
        <ul className="flags">
          {[...new Set(flags)].map((f) => <li key={f} className={u.review ? "resolved" : ""}><Icon name="flag" size={14} /> {f}</li>)}
        </ul>
      )}
      {!u.review && ctx.alerts.reviewNotes[u.id] && <p className="callout warn"><Icon name="clock" size={15} /> {ctx.alerts.reviewNotes[u.id]}</p>}
      {u.stage === "finishing" && !u.review && <p className="callout"><Icon name="eye" size={15} /> Marked finished. It only counts once someone approves the photos.</p>}
      {!ctx.readOnly && !compact && (
        <footer className="update-actions">
          {!view.review ? (
            <>
              <button className={`btn small ${needsReview(u) ? "primary" : "ghost"}`} onClick={() => review("approved")}><Icon name="check" size={15} /> {u.stage === "finishing" ? "Approve as finished" : "Looks right"}</button>
              <button className="btn ghost small" onClick={() => review("rejected")}><Icon name="x" size={15} /> Reject claim</button>
            </>
          ) : (
            <button className="btn ghost small" onClick={() => review(null)}>Undo {view.review === "approved" ? "approval" : "rejection"}</button>
          )}
          <button className="btn ghost small issue-btn" onClick={() => setIssueFor(true)}><Icon name="alert" size={15} /> Report issue</button>
          <button className="icon-btn" onClick={remove} aria-label="Delete update" title="Delete update"><Icon name="trash" size={16} /></button>
        </footer>
      )}
      {issueFor && <IssueForm onClose={() => setIssueFor(false)} preset={u.roomIds} updateId={u.id} />}
    </article>
  );
}

export function IssueForm({ onClose, preset, updateId = null }: { onClose: () => void; preset?: string[]; updateId?: number | null }) {
  const ctx = useProject();
  const { toast } = useFeedback();
  const rooms = [...ctx.rooms.values()];
  const [scope, setScope] = useState<Scope>(ALL);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<Issue["severity"]>("medium");
  const [busy, setBusy] = useState(false);
  const target = preset ? preset.map((id) => ctx.rooms.get(id)!).filter(Boolean) : matchScope(rooms, scope);

  async function save() {
    setBusy(true);
    try {
      await api(`${ctx.base}/issues`, { method: "POST", json: { roomIds: target.map((r) => r.id), title, note, severity, updateId } });
      toast("Issue added");
      await ctx.reload();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  }
  return (
    <Modal title="Report an issue" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), save())}>
        {preset ? (
          <p className="scope-result"><Icon name="pin" size={15} /> {target.length === 1 ? roomLabel(target[0]) : scopeLabel(target)}</p>
        ) : (
          <ScopePicker rooms={rooms} value={scope} onChange={setScope} apartment={ctx.apartment} />
        )}
        <label className="field">
          <span>What is wrong?</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="e.g. Crack in the bathroom wall" required autoFocus />
        </label>
        <div className={`field sev-pick-${severity}`}>
          <span>Priority</span>
          <Segmented label="Priority" value={severity} onChange={setSeverity} options={[["low", "Low"], ["medium", "Medium"], ["high", "High"]]} />
        </div>
        <label className="field">
          <span className="label-row">Details <em className="muted">(optional)</em> <MicButton onText={(t) => setNote((n) => (n ? `${n} ${t}` : t).slice(0, 1000))} /></span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} />
        </label>
        <div className="row-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !title.trim() || !target.length}>{busy ? "Saving…" : "Add issue"}</button>
        </div>
      </form>
    </Modal>
  );
}
