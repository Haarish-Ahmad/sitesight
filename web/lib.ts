import { useEffect, useRef, useState } from "react";
import type { Doc, Issue, Project, Update } from "../src/types";

export type Bundle = { project: Project; updates: Update[]; issues: Issue[]; documents: Doc[]; readOnly: boolean };

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, json === undefined ? rest : { ...rest, headers: { "content-type": "application/json" }, body: JSON.stringify(json) }).catch(() => {
    throw new Error("No connection to SiteSight. Check your signal and try again.");
  });
  const body = await res.json().catch(() => null);
  if (res.status === 401 && !/^\/api\/(login|signup|admin)/.test(path)) dispatchEvent(new Event("sitesight:login"));
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

// fetch() cannot report upload progress; big photo batches on a phone need a progress bar.
// A lost connection rejects with name "Offline" (status 0), so callers can keep the upload for later.
const fail = (message: string, status: number) => Object.assign(new Error(message), { name: status ? "Error" : "Offline", status });
export function upload<T>(path: string, data: FormData, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", path);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      let body: { error?: string } | null = null;
      try {
        body = JSON.parse(x.responseText);
      } catch {}
      x.status < 300 ? resolve(body as T) : reject(fail(body?.error ?? `Upload failed (${x.status})`, x.status));
    };
    x.onerror = () => reject(fail("No signal: the upload did not go through", 0));
    x.send(data);
  });
}

// ---------- offline outbox: updates saved on the phone (IndexedDB keeps the photo files) and sent when there is signal

export type Pending = { id?: number; project: string; path: string; fields: Record<string, string>; files: File[]; label: string; at: string };
const openDb = () =>
  new Promise<IDBDatabase>((ok, bad) => {
    const r = indexedDB.open("sitesight", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
async function outbox<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest) {
  const db = await openDb();
  return new Promise<T>((ok, bad) => {
    const r = fn(db.transaction("outbox", mode).objectStore("outbox"));
    r.onsuccess = () => ok(r.result as T);
    r.onerror = () => bad(r.error);
  });
}
const changed = () => dispatchEvent(new Event("sitesight:outbox"));
export const pendingUpdates = () => outbox<Pending[]>("readonly", (s) => s.getAll());
export async function queueUpdate(p: Pending) {
  await outbox("readwrite", (s) => s.add(p));
  changed();
}
let flushing = false;
// ponytail: an upload whose answer was lost is sent again; the server's duplicate-photo check flags the copy.
export async function flushOutbox() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const p of await pendingUpdates()) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(p.fields)) fd.set(k, v);
      for (const f of p.files) fd.append("photos", f);
      try {
        await upload(p.path, fd, () => {});
      } catch (e) {
        const err = e as Error & { status: number };
        if (err.name === "Offline" || err.status === 401) break; // keep it: no signal, or logged out
        dispatchEvent(new CustomEvent("sitesight:outbox-error", { detail: `${p.label} could not be saved: ${err.message}` }));
      }
      await outbox("readwrite", (s) => s.delete(p.id!));
      changed();
    }
  } finally {
    flushing = false;
  }
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOn(navigator.onLine);
    addEventListener("online", up);
    addEventListener("offline", up);
    return () => (removeEventListener("online", up), removeEventListener("offline", up));
  }, []);
  return on;
}

// A short buzz under gloves confirms the tap went through (Android; iPhones ignore it).
export const buzz = (pattern: number | number[] = 12) => void navigator.vibrate?.(pattern);

// "#/p/abc123/timeline" -> ["p", "abc123", "timeline"]
export function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => {
      setParts(read());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return parts;
}
export const go = (path: string) => (location.hash = path);

export const dateKey = (d: Date | string) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
export const fromKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const fmtDay = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
export const fmtTime = (d: Date | string) => new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const fmtDateTime = (d: Date | string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
export const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

// Opens WhatsApp (app on phones, web on desktop) with the text ready to send to a chosen contact or group.
export const whatsapp = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const shareLink = (token: string | null) => (token ? `${location.origin}${location.pathname.replace(/\/$/, "")}/#/share/${token}` : null);

// Phone photos are 3-10 MB: shrink in the browser before sending one to the AI. Base64 JPEG, no "data:" prefix.
export async function shrinkPhoto(file: Blob, max = 1024): Promise<string> {
  const img = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  img.close();
  return c.toDataURL("image/jpeg", 0.82).split(",")[1];
}

// Which AI the server uses. "fast" (Gemini) answers in seconds, so the app can ask it without being asked.
// "video": the server can take site videos (it has ffmpeg).
type AiInfo = { provider: string; fast: boolean; video: boolean };
let ai: Promise<AiInfo> | undefined;
export const aiInfo = () => (ai ??= api<AiInfo>("/api/ai").catch(() => ({ provider: "", fast: false, video: false })));

// A video's length, read in the browser so a long one is refused before minutes of uploading. null = cannot tell.
export const videoSeconds = (file: Blob) =>
  new Promise<number | null>((ok) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (s: number | null) => (URL.revokeObjectURL(url), ok(s));
    v.preload = "metadata";
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    v.src = url;
  });

// Speech to text with the browser's own recogniser (Chrome, Edge, Safari): for dusty hands on site.
// null where the browser has none, so callers just hide the mic.
type Rec = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: (e: { error: string }) => void; start(): void; stop(): void };
const w = globalThis as unknown as Record<string, (new () => Rec) | undefined>;
const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
export function useDictation(onText: (text: string) => void, onError: (code: string) => void) {
  const [on, setOn] = useState(false);
  const rec = useRef<Rec | null>(null);
  useEffect(() => () => rec.current?.stop(), []);
  if (!Recognition) return null;
  const toggle = () => {
    if (on) return rec.current?.stop();
    const r = new Recognition();
    r.lang = "en-IN"; // Indian English: site words and place names come out better
    r.interimResults = false;
    r.onresult = (e) => onText(Array.from(e.results, (x) => x[0].transcript).join(" ").trim());
    r.onerror = (e) => e.error !== "aborted" && e.error !== "no-speech" && onError(e.error);
    r.onend = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  };
  return { on, toggle };
}
