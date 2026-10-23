import { useEffect, useRef, useState } from "react";
import { defaultItems, roomType } from "../src/checklist";
import type { PlanDraft } from "../src/plan";
import { blockName, countBlock, countRooms, describeSpec, EXTRA_PRESETS, flatCount, floorLabel, MAX_ROOMS, numbered, type BlockSpec, type StructureSpec } from "../src/structure";
import { BlockEditor, DEFAULT_BLOCK } from "./BlockEditor";
import type { Project } from "../src/types";
import { api, go, plural, upload } from "./lib";
import { ChipEditor, Icon, NumberField, useFeedback } from "./ui";

const HOUSE_DEFAULTS = { basement: ["Utility room"], ground: ["Living room", "Kitchen", "Dining room", "Toilet"], upper: ["Bedroom", "Bedroom", "Toilet"] };
const STEPS = ["Start", "Building", "Checklists", "Review"];
const PLAN_TYPES = ["image/jpeg", "image/png", "image/webp"];
type PlanJob = { status: "queued" | "reading" | "done" | "failed"; done: number; total: number; ahead: number; draft: PlanDraft | null; error: string | null };

export function NewProject() {
  const { toast } = useFeedback();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [type, setType] = useState<"house" | "apartment">("house");
  // house
  const [floors, setFloors] = useState(2);
  const [basement, setBasement] = useState(false);
  const [levelRooms, setLevelRooms] = useState<Record<number, string[]>>({});
  const [outside, setOutside] = useState(["Exterior", "Terrace", "Compound wall"]);
  // apartment: every block has its own layout
  const [blocks, setBlocks] = useState<BlockSpec[]>([DEFAULT_BLOCK]);
  const [openBlock, setOpenBlock] = useState(0);
  const [site, setSite] = useState<string[]>([]);
  // required items per room type; types the manager has not touched use the defaults
  const [lists, setLists] = useState<Record<string, string[]>>({});
  // plan reading
  const [job, setJob] = useState<{ id: string; state: PlanJob | null } | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [notes, setNotes] = useState<string[] | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => void (document.title = "SiteSight · New project"), []);

  const levels = [...(basement ? [-1] : []), ...Array.from({ length: floors }, (_, i) => i)];
  const roomsFor = (f: number) => levelRooms[f] ?? (f < 0 ? HOUSE_DEFAULTS.basement : f === 0 ? HOUSE_DEFAULTS.ground : HOUSE_DEFAULTS.upper);
  const spec: StructureSpec =
    type === "house"
      ? { type, levels: levels.map((f) => ({ floor: f, rooms: roomsFor(f) })), outside }
      : { type, blocks, site };
  const total = countRooms(spec);
  const tooMany = total > MAX_ROOMS;
  const allNames = spec.type === "house" ? [...spec.levels.flatMap((l) => l.rooms), ...spec.outside] : [...spec.blocks.flatMap((b) => [...b.flatTypes.flatMap((t) => t.rooms), ...b.commonRooms, ...b.outside, ...(b.stilt ? ["Stilt parking"] : []), ...(b.basement ? ["Parking"] : [])]), ...spec.site];
  const types = [...new Map(allNames.map((n) => [roomType(n), n.replace(/\s+\d+$/, "")])).entries()];
  const listFor = (t: string, n: string) => lists[t] ?? defaultItems(n);
  const canNext =
    step === 0 ? name.trim().length > 0 && !job :
    step === 1 ? total > 0 && !tooMany && (type === "house" || (blocks.length > 0 && blocks.every((b) => b.flatTypes.length > 0 && b.flatTypes.every((t) => t.rooms.length > 0)))) :
    true;

  // poll the plan reading; it runs on the local model and can take a few minutes
  useEffect(() => {
    if (!job || job.state?.status === "done" || job.state?.status === "failed") return;
    const t = setInterval(async () => {
      try {
        const st = await api<PlanJob>(`/api/plans/${job.id}`);
        setJob((j) => (j && j.id === job.id ? { ...j, state: st } : j));
        if (st.status === "done" && st.draft) apply(st.draft);
        if (st.status === "failed") toast(st.error ?? "The plan could not be read", "error");
      } catch (e) {
        toast((e as Error).message, "error");
        setJob(null);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [job?.id, job?.state?.status]);

  function apply(d: PlanDraft) {
    if (d.name && !name.trim()) setName(titleCase(d.name));
    if (d.location && !location.trim()) setLocation(titleCase(d.location));
    setType(d.spec.type);
    if (d.spec.type === "house") {
      const fl = d.spec.levels.map((l) => l.floor);
      const top = Math.max(0, ...fl);
      setFloors(top + 1);
      setBasement(fl.includes(-1));
      setLevelRooms(Object.fromEntries([...(fl.includes(-1) ? [-1] : []), ...Array.from({ length: top + 1 }, (_, i) => i)].map((f) => [f, d.spec.type === "house" ? d.spec.levels.find((l) => l.floor === f)?.rooms ?? [] : []])));
      setOutside(d.spec.outside);
    } else if (d.spec.blocks.length) {
      setBlocks(d.spec.blocks);
      setSite(d.spec.site);
      setOpenBlock(0);
    }
    setNotes(d.notes);
    setJob(null);
    setStep(1);
    toast("Plan read. Check the building below before you continue.");
  }

  async function sendPlans(list: FileList | null) {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    const bad = picked.find((f) => !PLAN_TYPES.includes(f.type));
    if (bad) return toast(`${bad.name}: use a JPEG, PNG or WebP image. For a PDF, take a screenshot of each sheet.`, "error");
    if (picked.length > 4) return toast("At most 4 sheets at once: one per floor, or one per block", "error");
    const fd = new FormData();
    for (const f of picked) fd.append("plans", f);
    setUploadPct(0);
    try {
      const { jobId } = await upload<{ jobId: string }>("/api/plans", fd, setUploadPct);
      setJob({ id: jobId, state: null });
    } catch (e) {
      toast((e as Error).message, "error");
    }
    setUploadPct(null);
  }

  async function create() {
    setBusy(true);
    try {
      const checklists = Object.fromEntries(types.map(([t, n]) => [t, listFor(t, n)]));
      const p = await api<Project>("/api/projects", { method: "POST", json: { name: name.trim(), location: location.trim(), spec, checklists } });
      toast(`${p.name} is ready with ${plural(p.rooms.length, "room")}`);
      go(`/p/${p.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  }

  const next = () => (step < STEPS.length - 1 ? canNext && setStep(step + 1) : create());
  const st = job?.state;

  return (
    <div className="page narrow">
      <a className="back" href="#/"><Icon name="back" size={16} /> Projects</a>
      <h1>New project</h1>
      <ol className="stepper-head" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "now" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>
            <span>{i + 1}</span> {s}
          </li>
        ))}
      </ol>

      <form className="card wizard" onSubmit={(e) => (e.preventDefault(), next())}>
        {step === 0 && (
          <>
            <h2>Start from your plan</h2>
            <p className="muted">Upload the floor plan (one image per floor, or one per block). The AI reads the room labels and fills in floors, flats and rooms. You check everything before the project is created.</p>
            {job ? (
              <div className="plan-status" role="status">
                <Icon name={st?.status === "failed" ? "alert" : "scan"} size={24} />
                <div style={{ flex: 1 }}>
                  <b>{st?.status === "failed" ? "Could not read the plan" : st?.status === "reading" ? `Reading sheet ${Math.min(st.done + 1, st.total)} of ${st.total}…` : "Waiting for the AI…"}</b>
                  {st?.status !== "failed" && <div className="busy-bar" aria-hidden="true"><i /></div>}
                  <p className="muted small" style={{ margin: 0 }}>
                    {st?.status === "failed" ? st.error : st?.ahead ? `${plural(st.ahead, "photo check")} ahead in the queue. ` : ""}
                    {st?.status !== "failed" && "On this computer it can take a few minutes per sheet. You can fill in the name meanwhile."}
                  </p>
                </div>
                <button type="button" className="btn ghost small" onClick={() => setJob(null)}>{st?.status === "failed" ? "OK" : "Cancel"}</button>
              </div>
            ) : (
              <div
                className={`drop ${drag ? "over" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => input.current?.click()}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
                onDragOver={(e) => (e.preventDefault(), setDrag(true))}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => (e.preventDefault(), setDrag(false), sendPlans(e.dataTransfer.files))}
              >
                <Icon name="file" size={28} />
                <b>{uploadPct !== null ? `Uploading… ${Math.round(uploadPct * 100)}%` : "Upload floor plan"}</b>
                <span className="small">House plan or apartment block plan · JPEG, PNG or WebP · up to 4 sheets</span>
                <input ref={input} type="file" accept={PLAN_TYPES.join(",")} multiple hidden onChange={(e) => (sendPlans(e.target.files), (e.target.value = ""))} />
              </div>
            )}
            <div className="or">or set it up by hand</div>
            <label className="field">
              <span>Project name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sri Vinayaga Apartments" maxLength={80} required />
            </label>
            <label className="field">
              <span>Location <em className="muted">(optional)</em></span>
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Street, town" maxLength={120} />
            </label>
            <div className="field">
              <span>Type of building</span>
              <div className="type-cards" role="radiogroup" aria-label="Type of building" style={{ gridTemplateColumns: "1fr 1fr" }}>
                {(["house", "apartment"] as const).map((t) => (
                  <button type="button" key={t} role="radio" aria-checked={type === t} className={`type-card ${type === t ? "on" : ""}`} onClick={() => setType(t)}>
                    <Icon name={t === "house" ? "home" : "building"} size={26} />
                    <b>{t === "house" ? "House" : "Apartment building"}</b>
                    <span className="muted small">{t === "house" ? "One home, room by room on each floor" : "Blocks, floors and flats, with shared spaces"}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 1 && notes !== null && (
          <p className="callout"><Icon name="scan" size={15} /> <span>Filled in from your plan. AI reading is not perfect: compare with the drawing and fix anything that is off.{notes.map((n) => <span key={n}><br />· {n}</span>)}</span></p>
        )}

        {step === 1 && type === "house" && (
          <>
            <h2>Floors and rooms</h2>
            <p className="muted">These are the rooms you will track. Edit the suggestions; you can type any name.</p>
            <div className="two">
              <NumberField label="Floors above ground (incl. ground)" value={floors} min={1} max={10} onChange={setFloors} />
              <label className="toggle">
                <input type="checkbox" checked={basement} onChange={(e) => setBasement(e.target.checked)} /> Has a basement
              </label>
            </div>
            {levels.map((f) => (
              <div className="level" key={f}>
                <ChipEditor label={floorLabel(f)} values={roomsFor(f)} onChange={(v) => setLevelRooms({ ...levelRooms, [f]: v })} max={30} />
              </div>
            ))}
            <div className="level">
              <ChipEditor label="Outside and extra areas (terrace, sump, compound wall…)" values={outside} onChange={setOutside} max={20} suggestions={EXTRA_PRESETS} />
            </div>
          </>
        )}

        {step === 1 && type === "apartment" && (
          <>
            <h2>Blocks, floors and flats</h2>
            <p className="muted">Each block can have its own layout and mix of flat types. Add a block to copy the one before it, then change what differs.</p>
            <div className="block-list">
              {blocks.map((b, i) => (
                <section key={i} className={`level block-card ${openBlock === i ? "open" : ""}`}>
                  <header>
                    <button type="button" className="plain-link" onClick={() => setOpenBlock(openBlock === i ? -1 : i)} aria-expanded={openBlock === i}>
                      <b>Block {blockName(i)}</b>
                      <span className="muted small"> · {b.floors} floors · {flatCount(b)} flats ({b.flatTypes.map((t) => `${t.perFloor}×${t.name || "flat"}`).join(" + ")} per floor) · {countBlock(b)} rooms</span>
                    </button>
                    {blocks.length > 1 && (
                      <button type="button" className="icon-btn" aria-label={`Remove block ${blockName(i)}`} onClick={() => (setBlocks(blocks.filter((_, j) => j !== i)), setOpenBlock(-1))}>
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </header>
                  {openBlock === i && <BlockEditor value={b} onChange={(nb) => setBlocks(blocks.map((x, j) => (j === i ? nb : x)))} />}
                </section>
              ))}
            </div>
            {blocks.length < 20 && (
              <button type="button" className="btn ghost" style={{ justifySelf: "start" }} onClick={() => (setBlocks([...blocks, structuredClone(blocks[blocks.length - 1] ?? DEFAULT_BLOCK)]), setOpenBlock(blocks.length))}>
                <Icon name="plus" size={16} /> Add block {blockName(blocks.length)}{blocks.length ? ` (copy of ${blockName(blocks.length - 1)})` : ""}
              </button>
            )}
            <div className="level"><ChipEditor label="Site-wide areas, not in any block (sump, generator room, gate…)" values={site} onChange={setSite} max={20} suggestions={EXTRA_PRESETS} /></div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>What each room needs</h2>
            <p className="muted">Every room gets a checklist of required work and fittings, ticked off as they go in. Start from the suggestions and change them for this project.</p>
            <div className="checklists">
              {types.map(([t, n]) => (
                <details key={t}>
                  <summary><span>{n}</span><span className="muted small">{plural(listFor(t, n).length, "item")}</span></summary>
                  <ChipEditor label={`Required in every ${n.toLowerCase()}`} values={listFor(t, n)} onChange={(v) => setLists({ ...lists, [t]: v })} max={20} suggestions={[]} />
                </details>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Check and create</h2>
            <div className="review-box">
              <p className="lead">
                <b>{name}</b>
                {location && <> in {location}</>}
              </p>
              <p>{describeSpec(spec)}</p>
              {spec.type === "apartment" ? (
                <ul className="plain-list">
                  {spec.blocks.map((b, i) => (
                    <li key={i}>
                      Block {blockName(i)}: {b.floors} floors{b.stilt ? " (stilt parking on ground)" : ""}{b.basement ? " + basement" : ""}; per floor {b.flatTypes.map((t) => `${plural(t.perFloor, t.name || "flat")} (${numbered(t.rooms).join(", ")})`).join(" and ")}
                      {b.commonRooms.length ? `; shared: ${b.commonRooms.join(", ").toLowerCase()}` : ""}
                    </li>
                  ))}
                  {spec.site.length > 0 && <li>Site-wide: {spec.site.join(", ")}</li>}
                </ul>
              ) : (
                <ul className="plain-list">
                  {spec.levels.map((l) => <li key={l.floor}>{floorLabel(l.floor)}: {numbered(l.rooms).join(", ") || "no rooms"}</li>)}
                  {spec.outside.length > 0 && <li>Outside: {spec.outside.join(", ")}</li>}
                </ul>
              )}
              <p className="muted small" style={{ marginTop: 8 }}>{plural(types.reduce((n, [t, nm]) => n + listFor(t, nm).length, 0), "checklist item")} across {plural(types.length, "room type")}.</p>
            </div>
            <p className="muted small">You can track progress for one room, a whole flat, a floor, or a block at once, and add or remove rooms later in Settings.</p>
          </>
        )}

        <footer className="wizard-foot">
          <span className={`count ${tooMany ? "bad" : ""}`}>
            {tooMany ? `${total} rooms is over the ${MAX_ROOMS} limit` : step > 0 ? `${plural(total, "room")} will be tracked` : ""}
          </span>
          <div className="row-actions">
            {step > 0 && <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
            <button className={`btn ${step === STEPS.length - 1 ? "primary" : "dark"}`} disabled={!canNext || busy}>
              {step < STEPS.length - 1 ? (step === 0 ? "Set up by hand" : "Next") : busy ? "Creating…" : "Create project"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

// plans are lettered in capitals: "SRI VINAYAGA APARTMENTS" -> "Sri Vinayaga Apartments"
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);
