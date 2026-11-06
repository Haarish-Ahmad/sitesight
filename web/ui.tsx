import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GROUPS, groupOf, stageLabel, stageNo } from "../src/stages";
import { floorLabel, ROOM_PRESETS, scopeLabel, type Room } from "../src/structure";
import { buzz, useDictation } from "./lib";
import type { UpdateStatus } from "../src/summary";

// ---------- icons (Feather-style strokes; constant markup, never user content)

const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  video: '<rect x="1" y="5" width="15" height="14" rx="2"/><path d="M23 7l-7 5 7 5z"/>',
  play: '<path d="M6 4l14 8-14 8z" fill="currentColor"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21h.01M17.5 21H21v-3.5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16v5M16.5 18.5h5"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
  compare: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 2v20"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  wifiOff: '<path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
} as const;
export type IconName = keyof typeof ICONS;

export const Icon = ({ name, size = 18 }: { name: IconName; size?: number }) => (
  <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
);

// ---------- toasts and confirm dialogs, available everywhere

// `undo`: the toast gets an Undo button and stays a little longer.
type Toast = { id: number; text: string; kind: "ok" | "error"; undo?: () => void };
type ConfirmOpts = { title: string; body: ReactNode; confirm: string; danger?: boolean; typeToConfirm?: string };
const Feedback = createContext<{ toast: (text: string, kind?: Toast["kind"], undo?: () => void) => void; confirm: (o: ConfirmOpts) => Promise<boolean> }>(null as never);
export const useFeedback = () => useContext(Feedback);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ask, setAsk] = useState<(ConfirmOpts & { resolve: (ok: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState("");
  const drop = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const toast = useCallback((text: string, kind: Toast["kind"] = "ok", undo?: () => void) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind, undo }]);
    setTimeout(() => drop(id), kind === "error" || undo ? 7000 : 4000);
  }, []);
  useEffect(() => {
    const on = (e: Event) => toast((e as CustomEvent<string>).detail, "error");
    addEventListener("sitesight:outbox-error", on);
    return () => removeEventListener("sitesight:outbox-error", on);
  }, [toast]);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => (setTyped(""), setAsk({ ...o, resolve }))), []);
  const close = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
  };
  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);
  return (
    <Feedback.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            <Icon name={t.kind === "error" ? "alert" : "check"} /> <span>{t.text}</span>
            {t.undo && <button className="toast-undo" onClick={() => (drop(t.id), t.undo!())}>Undo</button>}
          </div>
        ))}
      </div>
      {ask && (
        <Modal title={ask.title} onClose={() => close(false)} small>
          <div className="confirm-body">{ask.body}</div>
          {ask.typeToConfirm && (
            <label className="field">
              <span>Type <b>{ask.typeToConfirm}</b> to confirm</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
            </label>
          )}
          <div className="row-actions">
            <button className="btn ghost" onClick={() => close(false)}>Cancel</button>
            <button className={`btn ${ask.danger ? "danger" : "primary"}`} disabled={!!ask.typeToConfirm && typed.trim() !== ask.typeToConfirm} onClick={() => close(true)}>
              {ask.confirm}
            </button>
          </div>
        </Modal>
      )}
    </Feedback.Provider>
  );
}

// ---------- modal

export function Modal({ title, onClose, children, small, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; small?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", key);
    document.body.classList.add("locked");
    (ref.current?.querySelector("[autofocus], input, textarea, select, button.primary, button") as HTMLElement | null)?.focus();
    return () => {
      removeEventListener("keydown", key);
      document.body.classList.remove("locked");
      prev?.focus();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${small ? "small" : ""} ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

// ---------- small display pieces

// Full-width on phones: one tap target per option, no wrapping pills.
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, ReactNode])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented full" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button type="button" key={id} role="radio" aria-checked={value === id} className={value === id ? "on" : ""} onClick={() => (buzz(), onChange(id))}>{text}</button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={26} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export const StageBadge = ({ stage, pending }: { stage: string | null; pending?: boolean }) => (
  <span className={`stage g${groupOf(stageNo(stage))}`}>
    <i />
    {stageLabel(stage)}
    {pending && <em> · finishing awaits approval</em>}
  </span>
);

const STATUS: Record<UpdateStatus, { label: string; icon: IconName; cls: string }> = {
  needs_review: { label: "Needs review", icon: "flag", cls: "warn" },
  checking: { label: "Checking photo", icon: "scan", cls: "info" },
  looks_right: { label: "Looks right", icon: "check", cls: "good" },
  approved: { label: "Approved", icon: "check", cls: "good" },
  rejected: { label: "Rejected", icon: "x", cls: "bad" },
  no_photo: { label: "No photo", icon: "camera", cls: "muted" },
};
export const StatusChip = ({ status }: { status: UpdateStatus }) => (
  <span className={`chip ${STATUS[status].cls}`}>
    <Icon name={STATUS[status].icon} size={14} /> {STATUS[status].label}
  </span>
);

export function Legend() {
  return (
    <div className="legend" aria-label="Colour key">
      <span><i className="sw g0" />Not started</span>
      {GROUPS.map((g, i) => (
        <span key={g.name}><i className={`sw g${i + 1}`} />{g.name}</span>
      ))}
    </div>
  );
}

export const Progress = ({ value, label }: { value: number; label?: string }) => (
  <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "Progress"}>
    <i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>
);

// A number that counts up from 0 on first show (and eases to new values); still under reduced motion.
export function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setN(value);
    const start = performance.now(), a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 900);
      setN(Math.round(a + (value - a) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    from.current = value;
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n}</>;
}

// Progress as a ring: the one number that matters, big.
export function Ring({ value, size = 120, label = "done" }: { value: number; size?: number; label?: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const v = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${v}% ${label}`}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff385c" />
            <stop offset="1" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} className="ring-track" />
        <circle cx="50" cy="50" r={r} className="ring-fill" strokeDasharray={c} style={{ strokeDashoffset: c * (1 - v / 100), ["--c" as string]: c }} transform="rotate(-90 50 50)" />
      </svg>
      <span><b><CountUp value={v} />%</b><small>{label}</small></span>
    </div>
  );
}

// Drag across to compare a room's first and latest photo.
export function BeforeAfter({ before, after, beforeLabel, afterLabel }: { before: string; after: string; beforeLabel: string; afterLabel: string }) {
  const [x, setX] = useState(50);
  return (
    <div className="ba" style={{ ["--x" as string]: `${x}%` }}>
      <img src={after} alt={`Now: ${afterLabel}`} />
      <img src={before} alt={`Before: ${beforeLabel}`} className="ba-before" />
      <span className="ba-tag left">{beforeLabel}</span>
      <span className="ba-tag right">{afterLabel}</span>
      <input type="range" min={0} max={100} value={x} onChange={(e) => setX(Number(e.target.value))} aria-label="Drag to compare before and now" />
      <i className="ba-handle" aria-hidden="true" />
    </div>
  );
}

// Tap to talk instead of type. Hidden in browsers without speech recognition.
export function MicButton({ onText }: { onText: (text: string) => void }) {
  const { toast } = useFeedback();
  const d = useDictation(onText, (code) => toast(code === "not-allowed" || code === "service-not-allowed" ? "Allow the microphone for this site to use voice." : "Could not hear that. Try again.", "error"));
  if (!d) return null;
  return (
    <button type="button" className={`icon-btn mic ${d.on ? "on" : ""}`} onClick={d.toggle} aria-pressed={d.on} aria-label={d.on ? "Stop listening" : "Speak instead of typing"} title={d.on ? "Listening… tap to stop" : "Speak"}>
      <Icon name="mic" />
    </button>
  );
}

// ---------- photo viewer

// video: the clip to play; src is then a frame from it, shown until it plays
export type ViewerPhoto = { src: string; full: string; title: string; sub?: string; notes?: ReactNode; video?: string };

export function PhotoViewer({ photos, start, onClose }: { photos: ViewerPhoto[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const p = photos[i];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setI((x) => Math.min(photos.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [photos.length]);
  return (
    <Modal title={p.title} onClose={onClose} wide>
      <div className="viewer">
        {photos.length > 1 && (
          <button className="icon-btn nav prev" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Previous photo"><Icon name="left" size={22} /></button>
        )}
        {p.video ? <video key={p.video} src={p.video} poster={p.src} controls playsInline preload="metadata" aria-label={`Video: ${p.title}`} /> : <img src={p.src} alt={p.title} />}
        {photos.length > 1 && (
          <button className="icon-btn nav next" disabled={i === photos.length - 1} onClick={() => setI(i + 1)} aria-label="Next photo"><Icon name="right" size={22} /></button>
        )}
      </div>
      <div className="viewer-meta">
        <div>
          {p.sub && <p className="muted">{p.sub}</p>}
          {p.notes}
        </div>
        <div className="viewer-side">
          {photos.length > 1 && <span className="muted">{i + 1} of {photos.length}</span>}
          <a className="btn ghost small" href={p.full} target="_blank" rel="noreferrer"><Icon name="download" size={14} /> {p.video ? "Download video" : "Original"}</a>
        </div>
      </div>
    </Modal>
  );
}

// ---------- scope picker: block -> floor -> flat -> room, where every level can be "all"

export type Scope = { block: string; floor: string; unit: string; name: string };
export const ALL: Scope = { block: "", floor: "", unit: "", name: "" };
const floorKey = (f: number | null) => (f === null ? "out" : String(f));
const blockKey = (b: string | null) => b ?? "site";
const unitKey = (u: string | null) => u ?? "shared";

export function matchScope(rooms: Room[], s: Scope) {
  return rooms.filter((r) => (!s.block || blockKey(r.block) === s.block) && (!s.floor || floorKey(r.floor) === s.floor) && (!s.unit || unitKey(r.unit) === s.unit) && (!s.name || r.name === s.name));
}
export const scopeFor = (r: Room, apartment = !!r.block): Scope => ({ block: apartment ? blockKey(r.block) : "", floor: floorKey(r.floor), unit: r.unit ? r.unit : r.block ? "shared" : "", name: r.name });

export function ScopePicker({ rooms, value, onChange, apartment }: { rooms: Room[]; value: Scope; onChange: (s: Scope) => void; apartment: boolean }) {
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const inBlock = matchScope(rooms, { ...ALL, block: value.block });
  const inFloor = matchScope(rooms, { ...ALL, block: value.block, floor: value.floor });
  const inUnit = matchScope(rooms, { ...value, name: "" });
  const floors = uniq(inBlock.map((r) => r.floor)).sort((a, b) => (a ?? 999) - (b ?? 999));
  const units = uniq(inFloor.map((r) => r.unit));
  const names = uniq(inUnit.map((r) => r.name));
  const set = (patch: Partial<Scope>) => onChange({ ...value, ...patch });
  const matched = matchScope(rooms, value);
  return (
    <div className="scope">
      <div className="scope-grid">
        {apartment && (
          <label className="field">
            <span>Block</span>
            <select value={value.block} onChange={(e) => set({ block: e.target.value, floor: "", unit: "", name: "" })}>
              <option value="">All blocks</option>
              {uniq(rooms.map((r) => blockKey(r.block))).map((b) => <option key={b} value={b}>{b === "site" ? "Site-wide areas" : `Block ${b}`}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span>Floor</span>
          <select value={value.floor} onChange={(e) => set({ floor: e.target.value, unit: "", name: "" })}>
            <option value="">All floors</option>
            {floors.map((f) => <option key={floorKey(f)} value={floorKey(f)}>{floorLabel(f)}</option>)}
          </select>
        </label>
        {apartment && (
          <label className="field">
            <span>Flat</span>
            <select value={value.unit} disabled={!value.floor} onChange={(e) => set({ unit: e.target.value, name: "" })}>
              <option value="">{value.floor ? "All flats and shared spaces" : "Pick a floor first"}</option>
              {units.map((u) => <option key={unitKey(u)} value={unitKey(u)}>{u ? `Flat ${u}` : "Shared spaces"}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span>Room</span>
          <select value={value.name} onChange={(e) => set({ name: e.target.value })}>
            <option value="">All rooms here</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <p className={`scope-result ${matched.length ? "" : "warn"}`}>
        <Icon name="pin" size={15} />
        <span>{matched.length ? <>Applies to <b>{scopeLabel(matched)}</b></> : "No rooms match this choice."}</span>
      </p>
    </div>
  );
}

// ---------- form helpers

export function NumberField({ label, value, min, max, onChange, hint }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; hint?: string }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n) || min));
  return (
    <div className="field">
      <span>{label}</span>
      <div className="stepper">
        <button type="button" className="icon-btn" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}><Icon name="minus" /></button>
        <input type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(e) => onChange(clamp(Number(e.target.value)))} aria-label={label} />
        <button type="button" className="icon-btn" onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}><Icon name="plus" /></button>
      </div>
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}

export function ChipEditor({ label, values, onChange, max = 15, suggestions = ROOM_PRESETS }: { label: string; values: string[]; onChange: (v: string[]) => void; max?: number; suggestions?: string[] }) {
  const [text, setText] = useState("");
  const add = (v: string) => {
    const name = v.trim().slice(0, 40);
    if (name && values.length < max) onChange([...values, name]);
    setText("");
  };
  const quick = suggestions.filter((s) => !values.includes(s)).slice(0, 6);
  return (
    <div className="field chips-field">
      <span>{label}</span>
      <div className="chips">
        {values.map((v, i) => (
          <span className="chip-edit" key={`${v}-${i}`}>
            {v}
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} aria-label={`Remove ${v}`}><Icon name="x" size={13} /></button>
          </span>
        ))}
        {values.length < max && (
          <input
            value={text}
            list="room-presets"
            placeholder={values.length ? "Add another…" : "Type a room name…"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(text);
              }
              if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
            }}
            onBlur={() => text && add(text)}
            aria-label={`Add to ${label}`}
          />
        )}
      </div>
      {quick.length > 0 && values.length < max && (
        <div className="quick">
          {quick.map((s) => (
            <button type="button" key={s} onClick={() => add(s)}>+ {s}</button>
          ))}
        </div>
      )}
      <datalist id="room-presets">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}
