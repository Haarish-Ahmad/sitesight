import { useEffect, useRef, useState } from "react";
import { GROUPS, ORDER, stageLabel, stageNo, type Stage } from "../../src/stages";
import { scopeLabel } from "../../src/structure";
import type { Update } from "../../src/types";
import { aiInfo, api, buzz, fmtSize, plural, queueUpdate, shrinkPhoto, upload, useOnline } from "../lib";
import { ALL, Empty, Icon, matchScope, MicButton, Progress, ScopePicker, StageBadge, useFeedback, type Scope } from "../ui";
import { useProject } from "./common";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
// A QR sticker opens "#/p/<id>/upload?b=A&f=1&u=A-101&n=": start with that place picked.
function fromLink(): Scope | null {
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
  return q.has("f") || q.has("b") ? { block: q.get("b") ?? "", floor: q.get("f") ?? "", unit: q.get("u") ?? "", name: q.get("n") ?? "" } : null;
}
const MAX = 30;
type Picked = { file: File; url: string };
type Recent = { scope: Scope; label: string };
type Hint = { state: "asking" } | { state: "done"; stage: Stage | null; area: string } | { state: "failed" };

// The last few places this phone uploaded to: one tap instead of four dropdowns.
const recentKey = (pid: string) => `sitesight.recent.${pid}`;
function loadRecent(pid: string): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(recentKey(pid)) ?? "[]");
  } catch {
    return [];
  }
}
function saveRecent(pid: string, r: Recent) {
  try {
    const list = [r, ...loadRecent(pid).filter((x) => x.label !== r.label)].slice(0, 4);
    localStorage.setItem(recentKey(pid), JSON.stringify(list));
  } catch {}
}

// The note survives a closed tab or a dead battery until the update is saved.
const draftKey = (pid: string) => `sitesight.draft.${pid}`;
const loadDraft = (pid: string) => {
  try {
    return localStorage.getItem(draftKey(pid)) ?? "";
  } catch {
    return "";
  }
};

type Done = { label: string; stage: string; photos: number; queued: boolean };

export function Upload() {
  const ctx = useProject();
  const { toast, confirm } = useFeedback();
  const rooms = ctx.data.project.rooms;
  const pid = ctx.data.project.id;
  const recent = loadRecent(pid).filter((x) => matchScope(rooms, x.scope).length);
  // the last place this phone uploaded to is the most likely next one
  const [scope, setScope] = useState<Scope>(() => ctx.uploadPreset ?? fromLink() ?? recent[0]?.scope ?? ALL);
  const [stage, setStage] = useState<Stage | null>(null);
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [note, setNote] = useState(() => loadDraft(pid));
  useEffect(() => {
    try {
      note ? localStorage.setItem(draftKey(pid), note) : localStorage.removeItem(draftKey(pid));
    } catch {}
  }, [note, pid]);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const [fast, setFast] = useState(false);
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => void aiInfo().then((a) => setFast(a.fast)), []);
  const camera = useRef<HTMLInputElement>(null);

  useEffect(() => () => ctx.setUploadPreset(null), []);
  const live = useRef(photos);
  live.current = photos;
  useEffect(() => () => live.current.forEach((p) => URL.revokeObjectURL(p.url)), []); // previews die with the page

  const target = matchScope(rooms, scope);
  const current = [...new Set(target.map((r) => ctx.summary.states[r.id].stage))].sort((a, b) => stageNo(a) - stageNo(b));
  const lowest = Math.min(...target.map((r) => ctx.summary.states[r.id].stageNo));
  const goesBack = stage && target.length > 0 && stageNo(stage) < lowest;
  // most updates move a room one stage on
  const next = target.length && lowest < ORDER.length ? ORDER[lowest] : null;

  // What stage the first photo looks like: a hint next to the stage buttons, never chosen for the user
  // (the AI's job is to check the person's claim, so it must not make it).
  async function askHint(file: File) {
    setHint({ state: "asking" });
    try {
      const a = await api<{ stage: string; area: string; confidence: string }>(`${ctx.base}/suggest`, { method: "POST", json: { image: await shrinkPhoto(file) } });
      setHint({ state: "done", stage: a.confidence !== "not_enough_evidence" && (ORDER as readonly string[]).includes(a.stage) ? (a.stage as Stage) : null, area: a.area });
    } catch {
      setHint({ state: "failed" });
    }
  }

  function add(list: FileList | null) {
    if (!list) return;
    const ok: Picked[] = [];
    const bad: string[] = [];
    for (const f of [...list]) {
      if (!TYPES.includes(f.type)) bad.push(`${f.name} (not JPEG/PNG/WebP)`);
      else if (f.size > 20e6) bad.push(`${f.name} (over 20 MB)`);
      else ok.push({ file: f, url: URL.createObjectURL(f) });
    }
    const room = MAX - photos.length;
    if (ok.length > room) bad.push(`${ok.length - room} photo(s) over the ${MAX}-photo limit`);
    setPhotos([...photos, ...ok.slice(0, room)]);
    if (fast && !photos.length && ok.length) void askHint(ok[0].file); // Gemini answers in seconds; the local model is asked only on request
    if (bad.length) toast(`Skipped: ${bad.join(", ")}`, "error");
  }

  async function save() {
    if (!stage || !target.length) return;
    if (target.length > 30 && !(await confirm({ title: `Update ${target.length} rooms at once?`, body: <>Every room in <b>{scopeLabel(target)}</b> will be marked as <b>{stage}</b>.</>, confirm: `Update ${target.length} rooms` }))) return;
    const fields = { roomIds: JSON.stringify(target.map((r) => r.id)), stage, note };
    const label = scopeLabel(target);
    const finish = (queued: boolean) => {
      buzz(queued ? [20, 60, 20] : 30);
      setDone({ label, stage, photos: photos.length, queued });
      saveRecent(pid, { scope, label });
      setHint(null);
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]);
      setNote("");
      setStage(null);
    };
    const keep = async () => {
      await queueUpdate({ project: pid, path: `${ctx.base}/updates`, fields, files: photos.map((p) => p.file), label: `${label} → ${stage}`, at: new Date().toISOString() });
      finish(true);
    };
    try {
      if (!navigator.onLine) await keep();
      else {
        const fd = new FormData();
        for (const [k, v] of Object.entries(fields)) fd.set(k, v);
        for (const p of photos) fd.append("photos", p.file);
        setProgress(0);
        try {
          await upload<Update>(`${ctx.base}/updates`, fd, setProgress);
          finish(false);
          await ctx.reload();
        } catch (e) {
          if ((e as Error).name !== "Offline") throw e;
          await keep();
        }
      }
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setProgress(null);
  }

  if (done)
    return (
      <div className="card narrow-card">
        <Empty icon={done.queued ? "wifiOff" : "check"} title={done.queued ? "Saved on this phone" : "Update saved"}>
          {done.queued ? (
            <>No signal right now. <b>{done.label} → {done.stage}</b> is kept on this phone and sent by itself when the signal is back. Keep this page open, or open the project again later.</>
          ) : (
            <>
              {done.label} is now marked <b>{done.stage}</b>
              {done.photos ? <>. The AI is checking {plural(done.photos, "photo")} in the background; results show up in Review.</> : "."}
              {done.stage === "finishing" && " It counts as finished once you approve it."}
            </>
          )}
        </Empty>
        <div className="row-actions center">
          <button className="btn primary big" onClick={() => setDone(null)}><Icon name="camera" size={16} /> Upload another</button>
          {!done.queued && <a className="btn ghost" href={ctx.href(done.photos ? "review" : "timeline")}>{done.photos ? "Go to Review" : "See timeline"}</a>}
        </div>
      </div>
    );

  const total = photos.reduce((n, p) => n + p.file.size, 0);
  return (
    <form className="upload" onSubmit={(e) => (e.preventDefault(), save())}>
      <section className="card">
        <h2><span className="step-no">1</span> Where?</h2>
        <p className="muted small">Pick one room, or a whole flat, floor or block to update many rooms at once.</p>
        {recent.length > 0 && (
          <div className="recent">
            <small>Recent</small>
            <div className="quick">{recent.map((x) => <button type="button" key={x.label} className={scopeLabel(matchScope(rooms, x.scope)) === scopeLabel(target) ? "on" : ""} onClick={() => setScope(x.scope)}><Icon name="pin" size={12} /> {x.label}</button>)}</div>
          </div>
        )}
        <ScopePicker rooms={rooms} value={scope} onChange={setScope} apartment={ctx.apartment} />
        {target.length > 0 && (
          <p className="muted small">
            Currently: {current.length === 1 ? <StageBadge stage={current[0]} /> : `mixed, from ${stageLabel(current[0]).toLowerCase()} to ${stageLabel(current[current.length - 1]).toLowerCase()}`}
          </p>
        )}
      </section>

      <section className="card">
        <h2><span className="step-no">2</span> Photos</h2>
        <div className="capture-row">
          <button type="button" className="btn dark" onClick={() => camera.current?.click()}><Icon name="camera" /> Take photo</button>
          <button type="button" className="btn ghost" onClick={() => input.current?.click()}><Icon name="upload" /> From gallery</button>
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
        </div>
        <div
          className={`drop ${drag ? "over" : ""}`}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => (e.preventDefault(), setDrag(false), add(e.dataTransfer.files))}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
        >
          <Icon name="camera" size={28} />
          <b>Add photos</b>
          <span className="muted small">Tap to take or choose photos, or drop them here. Up to {MAX}, JPEG/PNG/WebP.</span>
          <input ref={input} type="file" accept={TYPES.join(",")} multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
        </div>
        {photos.length > 0 && (
          <>
            <div className="thumbs picked">
              {photos.map((p, i) => (
                <div className="thumb" key={p.url}>
                  <img src={p.url} alt={p.file.name} />
                  <button type="button" className="remove" onClick={() => (URL.revokeObjectURL(p.url), setPhotos(photos.filter((_, j) => j !== i)))} aria-label={`Remove ${p.file.name}`}><Icon name="x" size={14} /></button>
                </div>
              ))}
            </div>
            <p className="muted small">{plural(photos.length, "photo")} · {fmtSize(total)}</p>
            {!fast && !hint && <button type="button" className="btn ghost small" onClick={() => askHint(photos[0].file)}><Icon name="sparkle" size={14} /> Ask the AI which stage this looks like (can take a few minutes)</button>}
          </>
        )}
      </section>

      <section className="card">
        <h2><span className="step-no">3</span> What stage is it at now?</h2>
        {hint && (
          <p className={`callout ${hint.state === "done" && hint.stage ? "ai" : ""}`} aria-live="polite">
            <Icon name="sparkle" size={15} />
            <span>{hint.state === "asking" ? "The AI is looking at your photo…" : hint.state === "failed" ? "The AI could not look at the photo right now. Pick the stage yourself." : hint.stage ? <>The photo looks like <b>{stageLabel(hint.stage).toLowerCase()}</b>{hint.area !== "unknown" && hint.area !== "other" ? ` in a ${hint.area.replace("_", " ")}` : ""}. You decide: tap the stage that is true.</> : "The AI could not tell the stage from this photo."}</span>
          </p>
        )}
        <div className="stage-pick">
          {GROUPS.map((g, gi) => (
            <div key={g.name} className="stage-group">
              <small>{g.name}</small>
              <div>
                {g.stages.map((st) => (
                  <button type="button" key={st} className={`stage-btn g${gi + 1} ${stage === st ? "on" : ""}`} aria-pressed={stage === st} onClick={() => (buzz(), setStage(st))}>
                    {stageLabel(st)}
                    {hint?.state === "done" && hint.stage === st && <em className="tag ai"><Icon name="sparkle" size={11} /> AI</em>}
                    {next === st && <em className="tag">next</em>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {goesBack && <p className="callout warn"><Icon name="alert" size={15} /> This is earlier than where these rooms are now. Saving moves them back to {stage}.</p>}
        {stage === "finishing" && <p className="callout"><Icon name="eye" size={15} /> Finishing needs at least one photo, and counts once someone approves it in Review.</p>}
        <label className="field">
          <span className="label-row">Note <em className="muted">(optional)</em> <MicButton onText={(t) => setNote((n) => (n ? `${n} ${t}` : t).slice(0, 1000))} /></span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="Anything the office should know, e.g. waiting for tiles to arrive" />
          {note && <small className="hint"><Icon name="check" size={12} /> Draft saved on this phone</small>}
        </label>
      </section>

      <div className="submit-bar">
        {progress !== null ? (
          <div className="uploading">
            <span>{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Saving…"}</span>
            <Progress value={progress * 100} label="Upload progress" />
          </div>
        ) : (
          <span className="muted small">{!target.length ? "Pick where" : !stage ? "Pick a stage" : `${scopeLabel(target)} → ${stage}${photos.length ? `, ${plural(photos.length, "photo")}` : ", no photos"}`}</span>
        )}
        <button className="btn primary big" disabled={!stage || !target.length || progress !== null || (stage === "finishing" && !photos.length)}>
          <Icon name={online ? "upload" : "wifiOff"} size={16} /> {online ? "Save update" : "Save on this phone"}
        </button>
      </div>
    </form>
  );
}
