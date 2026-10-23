import "./env.js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import sharp from "sharp";
import { z } from "zod";
import { analysePhoto } from "./ai/analysePhoto.js";
import { answerQuestion } from "./chat.js";
import { DEFAULT_MODEL } from "./ai/ollama.js";
import { GEMINI_MODEL } from "./ai/gemini.js";
import { photoFlags, readMeta } from "./check.js";
import { canCompare, comparePhotos, progressFlag, type Compare } from "./compare.js";
import { claimFlags } from "./rules.js";
import { askEta, etaInput, type Eta } from "./eta.js";
import { enoughHistory, typicalCrew } from "./finish.js";
import * as db from "./projects.js";
import { ORDER } from "./stages.js";
import { buildRooms, countRooms, describeRooms, MAX_ROOMS, placeRooms, scopeLabel, withIds } from "./structure.js";
import { withItems } from "./checklist.js";
import { ADMIN_COOKIE, clearCookie, cookie, endAllSessions, endSession, newSession, readCookie, sessionAccount, tooMany, USER_COOKIE, type Account } from "./auth.js";
import { AccountError, adminOverview, changePassword, createAccount, login } from "./accounts.js";
import { migrate } from "./db.js";
import { draftFromReadings, readPlan, type PlanDraft } from "./plan.js";
import { summarise } from "./summary.js";
import { progressAlerts } from "./alerts.js";
import { handleIncoming, lastPeriod, parseWebhook, phoneDigits, sendReport, tick, validSignature, waReady } from "./whatsapp.js";
import type { Doc, Issue, Photo, Project, Update } from "./types.js";

class HttpError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}
const fail = (code: number, msg: string): never => {
  throw new HttpError(code, msg);
};

// ---------- request helpers

const MB = 1024 * 1024;
async function body(req: IncomingMessage, limit: number) {
  if (Number(req.headers["content-length"] ?? 0) > limit) fail(413, `Upload too large (max ${Math.round(limit / MB)} MB)`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) fail(413, `Upload too large (max ${Math.round(limit / MB)} MB)`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function json<T>(req: IncomingMessage, schema: z.ZodType<T>, limit = MB): Promise<T> {
  let raw: unknown;
  const text = (await body(req, limit)).toString("utf8"); // outside the try: "too large" must not read as "not JSON"
  try {
    raw = JSON.parse(text || "{}");
  } catch {
    fail(400, "Request body is not valid JSON");
  }
  const r = schema.safeParse(raw);
  if (!r.success) fail(400, r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return (r as { data: T }).data;
}
async function form(req: IncomingMessage, limit: number) {
  const buf = await body(req, limit);
  try {
    return await new Request("http://x", { method: "POST", headers: { "content-type": req.headers["content-type"] ?? "" }, body: buf }).formData();
  } catch {
    return fail(400, "Upload was not a valid form");
  }
}
const files = (fd: FormData, name: string) => fd.getAll(name).filter((f): f is File => f instanceof File && f.size > 0);

function send(res: ServerResponse, code: number, value: unknown, headers: Record<string, string> = {}) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(value));
}

// ---------- validation

const Name = z.string().trim().min(1).max(40);
const Names = (max: number) => z.array(Name).max(max);
const Block = z.object({
  floors: z.number().int().min(1).max(80),
  basement: z.boolean(),
  stilt: z.boolean().default(false),
  flatTypes: z.array(z.object({ name: z.string().trim().max(30), perFloor: z.number().int().min(1).max(30), rooms: Names(15).min(1) })).min(1).max(6),
  commonRooms: Names(10),
  outside: Names(10),
});
const Spec = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("house"),
    levels: z.array(z.object({ floor: z.number().int().min(-1).max(100), rooms: Names(30) })).min(1).max(30),
    outside: Names(20),
  }),
  z.object({
    type: z.literal("apartment"),
    blocks: z.array(Block).min(1).max(20),
    site: Names(20),
  }),
]);
// checklists: required items per room type ("bedroom" -> ["Flooring", ...]); missing types get the defaults
const Checklists = z.record(z.string().max(40), z.array(z.string().trim().min(1).max(60)).max(20)).refine((r) => Object.keys(r).length <= 100, "Too many room types");
const NewProject = z.object({ name: z.string().trim().min(1).max(80), location: z.string().trim().max(120), spec: Spec, checklists: Checklists.optional() });
const ItemToggle = z.object({ roomIds: z.array(z.string()).min(1).max(MAX_ROOMS), name: z.string().trim().min(1).max(60), done: z.boolean() });
const ItemList = z.object({ names: z.array(z.string().trim().min(1).max(60)).max(30) });
const EditProject = z.object({ name: z.string().trim().min(1).max(80).optional(), location: z.string().trim().max(120).optional() });
const Review = z.object({ decision: z.enum(["approved", "rejected"]).nullable() });
const NewIssue = z.object({
  roomIds: z.array(z.string()).min(1).max(MAX_ROOMS),
  title: z.string().trim().min(1).max(140),
  note: z.string().trim().max(1000).default(""),
  severity: z.enum(["low", "medium", "high"]),
  updateId: z.number().int().nullable().default(null),
});
const IssueStatus = z.object({ status: z.enum(["open", "resolved", "dismissed"]) });
const Place = z.object({ block: z.string().max(4).nullable(), floor: z.number().int().min(-1).max(100).nullable(), unit: z.string().max(20).nullable() });
const AddRooms = z.object({ groups: z.array(z.object({ place: Place, names: Names(400).min(1) })).min(1).max(200) });
const RemoveRooms = z.object({ roomIds: z.array(z.string()).min(1).max(MAX_ROOMS) });
const Question = z.object({
  question: z.string().trim().min(1).max(500),
  history: z.array(z.object({ q: z.string().max(500), a: z.string().max(1500) })).max(3).default([]),
  image: z.string().max(3_000_000).optional(), // base64 photo attached to the question
});
const PhotoOnly = z.object({ image: z.string().min(1).max(3_000_000) });
const Email = z.string().trim().max(200).email("Enter a valid email");
const Signup = z.object({
  company: z.string().trim().min(2, "Enter the company name").max(80),
  name: z.string().trim().min(1, "Enter your name").max(60),
  email: Email,
  password: z.string().max(200),
  code: z.string().max(100).optional(),
});
const Login = z.object({ email: z.string().trim().max(200), password: z.string().max(200) });
const NewPassword = z.object({ current: z.string().max(200), next: z.string().max(200) });
const WhatsAppSettings = z.object({
  managers: z.array(z.object({
    name: z.string().trim().max(60),
    phone: z.string().transform(phoneDigits).pipe(z.string().regex(/^\d{11,15}$/, "Phone numbers need the country code, e.g. 91 98765 43210")),
  })).max(10),
  frequency: z.enum(["off", "weekly", "monthly"]),
  alerts: z.boolean(),
});

// A photo sent as base64 from the browser: must really be an image; re-encoded small for the model.
async function smallPhoto(b64: string): Promise<string> {
  try {
    return (await sharp(Buffer.from(b64, "base64")).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()).toString("base64");
  } catch {
    throw new HttpError(400, "That file is not a photo we can read (use JPEG, PNG or WebP)");
  }
}

const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const PHOTO_FILE = /^\d+-\d+\.(jpg|png|webp)$/;
const MAX_PHOTOS = 30;

function roomsOf(p: Project, ids: string[]) {
  const byId = new Map(p.rooms.map((r) => [r.id, r]));
  const rooms = [...new Set(ids)].map((id) => byId.get(id) ?? fail(400, `Unknown room ${id}`));
  return rooms;
}

// ---------- AI photo checks: one at a time, in the background (the local model takes 15-60 s a photo)

// One model at a time: the GPU is small. Plan readings jump the queue because someone is waiting for them.
type Job = { projectId: string; updateId: number; file: string };
const jobs: (() => Promise<void>)[] = [];
let draining = false;

function enqueue(job: Job) {
  jobs.push(() => runJob(job));
  void drain();
}
async function drain() {
  if (draining) return;
  draining = true;
  while (jobs.length) await jobs.shift()!().catch((e) => console.error("Background job failed:", e));
  draining = false;
}

// ---------- floor plan reading: images in, a draft project out (the manager edits it before anything is created)

type PlanJob = { owner: string; status: "queued" | "reading" | "done" | "failed"; done: number; total: number; draft?: PlanDraft; error?: string; at: number };
const planJobs = new Map<string, PlanJob>();
function startPlanJob(owner: string, images: Buffer[]) {
  const id = randomBytes(8).toString("hex");
  const job: PlanJob = { owner, status: "queued", done: 0, total: images.length, at: Date.now() };
  planJobs.set(id, job);
  for (const [k, j] of planJobs) if (Date.now() - j.at > 6 * 3600_000) planJobs.delete(k); // forget old results
  jobs.unshift(async () => {
    job.status = "reading";
    try {
      const readings = [];
      for (const img of images) {
        readings.push(await readPlan(img));
        job.done++;
      }
      job.draft = draftFromReadings(readings);
      job.status = "done";
    } catch (e) {
      console.error("Plan reading failed:", e);
      job.status = "failed";
      job.error = e instanceof Error && /Ollama/.test(e.message) ? e.message : "The AI could not read this plan. Try a clearer image, or enter the building by hand.";
    }
  });
  void drain();
  return id;
}

async function runJob(job: Job) {
  if (!(await db.getProject(job.projectId))) return; // deleted while queued
  let ai: Photo["ai"] = null;
  try {
    const a = await analysePhoto(readFileSync(db.photoPath(job.projectId, job.file)));
    ai = { stage: a.stage, confidence: a.confidence, materials: a.materials, issues: a.issues, features: a.features };
  } catch (e) {
    console.error(`AI check failed for ${job.file}:`, e instanceof Error ? e.message : e);
  }
  // Same place as an earlier update: did the work move on? Only the update's first photo, one extra call per update.
  let cmp: { c: Compare; before: string } | null = null;
  if (canCompare()) {
    try {
      const all = await db.updates.load(job.projectId);
      const now = all.find((x) => x.id === job.updateId);
      const key = now?.roomIds.slice().sort().join(",");
      const prev = now && now.photos[0]?.file === job.file ? all.filter((x) => x.id < now.id && x.review !== "rejected" && x.photos.length && x.roomIds.slice().sort().join(",") === key).pop() : undefined;
      if (now && prev) cmp = { before: prev.stage, c: await comparePhotos(readFileSync(db.photoPath(job.projectId, prev.photos[0].file)), readFileSync(db.photoPath(job.projectId, job.file)), { before: prev.stage, after: now.stage }, prev.id) };
    } catch (e) {
      console.error(`Photo comparison failed for ${job.file}:`, e instanceof Error ? e.message : e);
    }
  }
  const hit = await db.updates.mutate(job.projectId, (list) => {
    const u = list.find((x) => x.id === job.updateId);
    const p = u?.photos.find((x) => x.file === job.file);
    if (!u || !p) return null;
    p.checking = false;
    p.aiError = !ai;
    p.ai = ai;
    if (cmp) {
      p.compare = cmp.c;
      const f = !u.review && progressFlag(cmp.c, cmp.before, u.stage);
      if (f) p.flags.push(f);
    }
    // a person already decided on this claim: a late AI result must not re-flag it
    if (ai && !u.review) p.flags.push(...claimFlags(u.stage, ai));
    return { roomIds: u.roomIds, scopeLabel: u.scopeLabel };
  });
  if (!hit || !ai?.issues.length) return;
  // AI-spotted problems become *suggestions*: a person confirms or dismisses them.
  await db.issues.mutate(job.projectId, (list, next) => {
    const key = hit.roomIds.join(",");
    for (const raw of ai!.issues.slice(0, 3)) {
      const title = raw.trim().slice(0, 140);
      if (!title || list.some((i) => i.roomIds.join(",") === key && i.title.toLowerCase() === title.toLowerCase())) continue;
      list.push({ id: next++, at: new Date().toISOString(), roomIds: hit.roomIds, scopeLabel: hit.scopeLabel, title, note: "", severity: "medium", status: "suggested", source: "ai", updateId: job.updateId, photo: job.file, resolvedAt: null });
    }
  });
}

// ---------- project routes

const etaCache = new Map<string, Eta>();

async function bundle(p: Project, readOnly: boolean) {
  return {
    project: readOnly ? { ...p, id: "", shareToken: null, whatsapp: undefined } : p, // viewers never see managers' phone numbers
    updates: await db.updates.load(p.id),
    issues: await db.issues.load(p.id),
    documents: await db.docs.load(p.id),
    readOnly,
  };
}

async function sendPhoto(res: ServerResponse, id: string, file: string, width: number) {
  const path = db.photoPath(id, file);
  if (!PHOTO_FILE.test(file) || !existsSync(path)) fail(404, "No such photo");
  if (width === 0) {
    res.writeHead(200, { "content-type": file.endsWith("png") ? "image/png" : file.endsWith("webp") ? "image/webp" : "image/jpeg", "cache-control": "private, max-age=86400" });
    return res.end(readFileSync(path));
  }
  // originals are 3-8 MB phone photos; screens get a resized copy
  const img = await sharp(path).rotate().resize(width, width, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
  res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" });
  res.end(img);
}

const INLINE_TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
function sendDoc(res: ServerResponse, id: string, d: Doc) {
  const path = db.docPath(id, d.file);
  if (!existsSync(path)) fail(404, "File missing");
  const ext = d.originalName.split(".").pop()?.toLowerCase() ?? "";
  // only PDFs and images open in the browser; anything else (HTML, SVG, ...) downloads, so uploads cannot run scripts here
  const inline = INLINE_TYPES[ext];
  res.writeHead(200, {
    "content-type": inline ?? "application/octet-stream",
    "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(d.originalName)}`,
    "x-content-type-options": "nosniff",
    "content-length": statSync(path).size,
  });
  res.end(readFileSync(path));
}

// p: already checked to belong to the signed-in account, or found by a share token (readOnly)
async function projectRoute(req: IncomingMessage, res: ServerResponse, url: URL, p: Project, rest: string, readOnly: boolean) {
  const m = req.method ?? "GET";
  const id = p.id;
  let g: RegExpMatchArray | null;

  if (m === "GET" && rest === "") return send(res, 200, await bundle(p, readOnly));
  if (m === "GET" && (g = rest.match(/^\/photos\/([^/]+)$/))) return sendPhoto(res, id, g[1], Math.min(2000, Math.max(0, Number(url.searchParams.get("w") ?? 1600) || 0)));
  if (m === "GET" && (g = rest.match(/^\/documents\/(\d+)\/file$/))) {
    const d = (await db.docs.load(id)).find((x) => x.id === Number(g![1])) ?? fail(404, "No such document");
    return sendDoc(res, id, d);
  }
  if (readOnly) fail(403, "This is a read-only link");

  if (m === "PATCH" && rest === "") {
    const e = await json(req, EditProject);
    return send(res, 200, await db.updateProject(id, (x) => Object.assign(x, e)));
  }
  if (m === "DELETE" && rest === "") {
    await db.deleteProject(id);
    return send(res, 200, { ok: true });
  }

  // Rooms can change after creation: a new block, a forgotten pool, a removed store room.
  if (m === "POST" && rest === "/rooms") {
    const { groups } = await json(req, AddRooms);
    const fresh = groups.flatMap((g) => placeRooms(p.rooms, g.place, g.names));
    if (p.rooms.length + fresh.length > MAX_ROOMS) fail(400, `That would make ${p.rooms.length + fresh.length} rooms; the limit is ${MAX_ROOMS}`);
    const added = withItems(withIds(p.rooms, fresh));
    await db.updateProject(id, (x) => x.rooms.push(...added));
    return send(res, 201, { added: added.length });
  }
  if (m === "POST" && rest === "/rooms/remove") {
    const { roomIds } = await json(req, RemoveRooms);
    const drop = new Set(roomIds);
    if (drop.size >= p.rooms.length) fail(400, "A project needs at least one room");
    // updates and issues keep their history (and their labels); they simply stop counting toward progress
    const after = await db.updateProject(id, (x) => (x.rooms = x.rooms.filter((r) => !drop.has(r.id))));
    return send(res, 200, { removed: p.rooms.length - after.rooms.length });
  }

  // Required items in each room: tick one item across many rooms (e.g. "Granite platform" in every kitchen of Block A)
  if (m === "POST" && rest === "/items") {
    const b = await json(req, ItemToggle);
    const ids = new Set(roomsOf(p, b.roomIds).map((r) => r.id));
    let changed = 0;
    await db.updateProject(id, (x) => {
      for (const r of x.rooms) {
        const it = ids.has(r.id) ? r.items?.find((i) => i.name === b.name) : undefined;
        if (!it || !!it.doneAt === b.done) continue;
        it.doneAt = b.done ? new Date().toISOString() : null;
        changed++;
      }
    });
    return send(res, 200, { changed });
  }
  if (m === "PUT" && (g = rest.match(/^\/rooms\/(r\d+)\/items$/))) {
    const { names } = await json(req, ItemList);
    const roomId = g[1];
    roomsOf(p, [roomId]);
    await db.updateProject(id, (x) => {
      const r = x.rooms.find((y) => y.id === roomId)!;
      const old = new Map((r.items ?? []).map((i) => [i.name, i.doneAt]));
      r.items = [...new Set(names)].map((name) => ({ name, doneAt: old.get(name) ?? null }));
    });
    return send(res, 200, { ok: true });
  }

  if (m === "POST" && rest === "/updates") {
    const fd = await form(req, 320 * MB);
    const stage = z.enum(ORDER).safeParse(fd.get("stage"));
    if (!stage.success) fail(400, "Pick a stage");
    let ids: unknown;
    try {
      ids = JSON.parse(String(fd.get("roomIds") ?? "[]"));
    } catch {
      fail(400, "roomIds must be a JSON list");
    }
    const rooms = roomsOf(p, z.array(z.string()).min(1, "Pick at least one room").parse(ids));
    const note = String(fd.get("note") ?? "").trim().slice(0, 1000);
    const photos = files(fd, "photos");
    if (photos.length > MAX_PHOTOS) fail(400, `At most ${MAX_PHOTOS} photos per upload`);
    if (stage.data === "finishing" && !photos.length) fail(400, "Finishing needs at least one photo for review");
    for (const f of photos) {
      if (!IMAGE_EXT[f.type]) fail(400, `${f.name}: use JPEG, PNG or WebP photos (on iPhone: Settings → Camera → Formats → Most Compatible)`);
      if (f.size > 20 * MB) fail(400, `${f.name} is over 20 MB`);
    }
    const now = new Date();
    const prior = (await db.updates.load(id)).flatMap((u) => u.photos);
    const prepared: { buf: Buffer; ext: string; meta: Awaited<ReturnType<typeof readMeta>>; flags: string[] }[] = [];
    for (const f of photos) {
      const buf = Buffer.from(await f.arrayBuffer());
      const meta = await readMeta(buf);
      const flags = photoFlags(meta, now, [...prior, ...prepared.map((x) => ({ hash: x.meta.hash, gps: x.meta.gps }))]);
      prepared.push({ buf, ext: IMAGE_EXT[f.type], meta, flags });
    }
    const created = await db.updates.mutate(id, (list, next) => {
      const u: Update = {
        id: next,
        at: now.toISOString(),
        roomIds: rooms.map((r) => r.id),
        scopeLabel: scopeLabel(rooms),
        stage: stage.data!,
        note,
        photos: prepared.map((x, i) => {
          const file = `${next}-${i + 1}.${x.ext}`;
          writeFileSync(db.photoPath(id, file), x.buf);
          return { file, hash: x.meta.hash, takenAt: x.meta.takenAt?.toISOString() ?? null, gps: x.meta.gps ?? null, flags: x.flags, checking: true, ai: null, aiError: false };
        }),
        review: null,
        reviewedAt: null,
      };
      list.push(u);
      return u;
    });
    for (const ph of created.photos) enqueue({ projectId: id, updateId: created.id, file: ph.file });
    return send(res, 201, created);
  }

  if (m === "POST" && (g = rest.match(/^\/updates\/(\d+)\/review$/))) {
    const { decision } = await json(req, Review);
    const ok = await db.updates.mutate(id, (list) => {
      const u = list.find((x) => x.id === Number(g![1]));
      if (!u) return false;
      u.review = decision;
      u.reviewedAt = decision ? new Date().toISOString() : null;
      return true;
    });
    return ok ? send(res, 200, { ok }) : fail(404, "No such update");
  }
  if (m === "DELETE" && (g = rest.match(/^\/updates\/(\d+)$/))) {
    const uid = Number(g[1]);
    const removed = await db.updates.mutate(id, (list) => {
      const i = list.findIndex((x) => x.id === uid);
      return i < 0 ? null : list.splice(i, 1)[0];
    });
    if (!removed) fail(404, "No such update");
    for (const ph of removed!.photos) rmSync(db.photoPath(id, ph.file), { force: true });
    // AI suggestions from these photos go too; real issues stay but lose the deleted photo
    await db.issues.mutate(id, (list) => {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].updateId !== uid) continue;
        if (list[i].status === "suggested") list.splice(i, 1);
        else Object.assign(list[i], { updateId: null, photo: null });
      }
    });
    return send(res, 200, { ok: true });
  }

  if (m === "POST" && rest === "/issues") {
    const b = await json(req, NewIssue);
    const rooms = roomsOf(p, b.roomIds);
    const update = b.updateId === null ? null : (await db.updates.load(id)).find((u) => u.id === b.updateId) ?? null;
    const issue = await db.issues.mutate(id, (list, next) => {
      const i: Issue = { id: next, at: new Date().toISOString(), roomIds: rooms.map((r) => r.id), scopeLabel: scopeLabel(rooms), title: b.title, note: b.note, severity: b.severity, status: "open", source: "manager", updateId: update?.id ?? null, photo: update?.photos[0]?.file ?? null, resolvedAt: null };
      list.push(i);
      return i;
    });
    return send(res, 201, issue);
  }
  if (m === "PATCH" && (g = rest.match(/^\/issues\/(\d+)$/))) {
    const { status } = await json(req, IssueStatus);
    const ok = await db.issues.mutate(id, (list) => {
      const i = list.find((x) => x.id === Number(g![1]));
      if (!i) return false;
      i.status = status;
      i.resolvedAt = status === "resolved" ? new Date().toISOString() : null;
      return true;
    });
    return ok ? send(res, 200, { ok }) : fail(404, "No such issue");
  }

  if (m === "POST" && rest === "/documents") {
    const fd = await form(req, 26 * MB);
    const [file] = files(fd, "file");
    if (!file) fail(400, "Choose a file");
    if (file.size > 25 * MB) fail(400, "Documents can be at most 25 MB");
    const category = z.enum(["plans", "permits", "contracts", "reports", "other"]).catch("other").parse(fd.get("category"));
    const title = String(fd.get("title") ?? "").trim().slice(0, 120) || file.name;
    const buf = Buffer.from(await file.arrayBuffer());
    const doc = await db.docs.mutate(id, (list, next) => {
      const stored = `${next}-${file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80)}`;
      writeFileSync(db.docPath(id, stored), buf);
      const d: Doc = { id: next, at: new Date().toISOString(), title, category, file: stored, originalName: file.name.slice(0, 200), size: file.size, type: file.type };
      list.push(d);
      return d;
    });
    return send(res, 201, doc);
  }
  if (m === "DELETE" && (g = rest.match(/^\/documents\/(\d+)$/))) {
    const d = await db.docs.mutate(id, (list) => {
      const i = list.findIndex((x) => x.id === Number(g![1]));
      return i < 0 ? null : list.splice(i, 1)[0];
    });
    if (!d) fail(404, "No such document");
    rmSync(db.docPath(id, d!.file), { force: true });
    return send(res, 200, { ok: true });
  }

  if (rest === "/share" && (m === "POST" || m === "DELETE")) {
    const token = m === "POST" ? randomBytes(16).toString("base64url") : null;
    await db.updateProject(id, (x) => (x.shareToken = token));
    return send(res, 200, { shareToken: token });
  }

  if (m === "PUT" && rest === "/whatsapp") {
    const b = await json(req, WhatsAppSettings);
    const now = new Date();
    return send(res, 200, (await db.updateProject(id, (x) => {
      const old = x.whatsapp;
      // a newly chosen schedule starts with the next period, not with a report for the one already over
      const lastReport = old?.frequency === b.frequency ? old.lastReport : b.frequency === "off" ? null : lastPeriod(b.frequency === "weekly" ? "week" : "month", now).key;
      x.whatsapp = { ...b, lastReport, sentAlerts: old?.sentAlerts ?? [] };
    })).whatsapp);
  }
  // "Send now": the report for the period so far, to check the template and the phones
  if (m === "POST" && rest === "/whatsapp/test") {
    if (!p.whatsapp?.managers.length) fail(400, "Add a manager's phone number first");
    if (!waReady()) fail(503, "WhatsApp is not connected yet: set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID in sitesight/.env");
    await sendReport(p, p.whatsapp!.frequency === "weekly" ? "week" : "month", new Date());
    return send(res, 200, { sent: p.whatsapp!.managers.length });
  }

  if (m === "POST" && rest === "/chat") {
    const { question, history, image } = await json(req, Question, 3 * MB);
    return send(res, 200, await answerQuestion(p, await db.updates.load(id), await db.issues.load(id), question, history, { image: image && (await smallPhoto(image)) }));
  }
  // what stage a photo shows, to pre-select it on the upload form (a hint only: the uploader picks)
  if (m === "POST" && rest === "/suggest") {
    const { image } = await json(req, PhotoOnly, 3 * MB);
    const a = await analysePhoto(Buffer.from(await smallPhoto(image), "base64"));
    return send(res, 200, { stage: a.stage, area: a.area, confidence: a.confidence });
  }
  // finish estimate: building size + stages + a typical crew + real pace, checked by the AI; "need" until a week of history
  if (m === "POST" && rest === "/eta") {
    const s = summarise(p.rooms, await db.updates.load(id), await db.issues.load(id));
    if (!enoughHistory(s) && s.roomsDone < s.roomsTotal) return send(res, 200, { need: "history", historyDays: s.historyDays });
    const k = `${id}:${JSON.stringify(etaInput(p.rooms, s, typicalCrew(p.rooms)).input)}`;
    // same site data -> same answer, so repeat clicks do not re-run the slow model; failed AI answers are not kept
    const eta = etaCache.get(k) ?? (await askEta(p.rooms, s));
    if (eta.ai) etaCache.set(k, eta);
    return send(res, 200, eta);
  }
  fail(404, "Not found");
}

// ---------- top level

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  const m = req.method ?? "GET";
  let g0: RegExpMatchArray | null;

  // Changes must come from this site: blocks other sites posting forms or scripts at the API with the user's cookie.
  if (m !== "GET" && m !== "HEAD" && req.headers.origin) {
    let host = "";
    try {
      host = new URL(req.headers.origin).host;
    } catch {}
    if (host !== req.headers.host) fail(403, "Request from another site refused");
  }
  const ip = clientIp(req);
  const secure = process.env.COOKIE_SECURE === "1" || req.headers["x-forwarded-proto"] === "https";

  // which AI answers: the web app only auto-asks it when it is quick (Gemini); the local model takes minutes
  if (path === "/api/ai" && m === "GET") return send(res, 200, { provider: process.env.AI_PROVIDER ?? "demo", fast: process.env.AI_PROVIDER === "gemini" || !process.env.AI_PROVIDER || process.env.AI_PROVIDER === "demo" });
  if (path.startsWith("/api/admin")) return adminRoute(req, res, path, m, ip, secure);

  // ---------- accounts: one per company; each sees only its own projects
  const token = readCookie(req.headers.cookie, USER_COOKIE);
  const me = await sessionAccount(token, false);
  if (path === "/api/session" && m === "GET") return send(res, 200, { signedIn: !!me, account: me && { company: me.company, name: me.name, email: me.email }, signupCode: !!process.env.SIGNUP_CODE });
  if (path === "/api/signup" && m === "POST") {
    if (tooMany(`signup:${ip}`, 5, 3600_000)) fail(429, "Too many sign-ups from this network. Try again in an hour.");
    const b = await json(req, Signup);
    if (process.env.SIGNUP_CODE && b.code !== process.env.SIGNUP_CODE) fail(403, "Wrong sign-up code");
    const id = await accountCall(() => createAccount(b, ip));
    const s = await newSession(id, false);
    return send(res, 201, { ok: true }, { "set-cookie": cookie(USER_COOKIE, s.token, s.maxAge, secure) });
  }
  if (path === "/api/login" && m === "POST") {
    if (tooMany(`login:${ip}`, 20, 15 * 60_000)) fail(429, "Too many login attempts from this network. Wait 15 minutes.");
    const b = await json(req, Login);
    const id = await accountCall(() => login(b.email, b.password, false, ip));
    const s = await newSession(id, false);
    return send(res, 200, { ok: true }, { "set-cookie": cookie(USER_COOKIE, s.token, s.maxAge, secure) });
  }
  if (path === "/api/logout" && m === "POST") {
    await endSession(token);
    return send(res, 200, { ok: true }, { "set-cookie": clearCookie(USER_COOKIE) });
  }
  // ---------- WhatsApp webhook: Meta calls this, so no login; requests are checked by their signature instead
  if (path === "/api/whatsapp" && m === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && !!process.env.WHATSAPP_VERIFY_TOKEN && url.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
    if (!ok) fail(403, "Wrong verify token");
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end(url.searchParams.get("hub.challenge") ?? "");
  }
  if (path === "/api/whatsapp" && m === "POST") {
    const raw = await body(req, MB);
    const secret = process.env.WHATSAPP_APP_SECRET;
    // without a secret, unsigned posts are only accepted while no token is set (nothing can be sent then)
    if (secret ? !validSignature(raw, req.headers["x-hub-signature-256"] as string | undefined, secret) : process.env.WHATSAPP_TOKEN) fail(403, "Bad signature");
    let msgs: ReturnType<typeof parseWebhook> = [];
    try {
      msgs = parseWebhook(JSON.parse(raw.toString("utf8")));
    } catch {}
    send(res, 200, { ok: true }); // answer Meta at once; replies can take the model a while
    for (const msg of msgs) void handleIncoming(msg).catch((e) => console.error("WhatsApp reply failed:", e instanceof Error ? e.message : e));
    return;
  }
  // Share links resolve to a project on the server, and only GET routes are allowed: viewers never learn the project id.
  let g = path.match(/^\/api\/share\/([A-Za-z0-9_-]{10,})(\/.*)?$/);
  if (g) {
    if (tooMany(`share:${ip}`, 600, 60_000)) fail(429, "Too many requests");
    const p = (await db.findByShareToken(g[1])) ?? fail(404, "This share link is no longer valid");
    if (m !== "GET") fail(403, "This is a read-only link");
    return projectRoute(req, res, url, p, g[2] ?? "", true);
  }

  if (!me) fail(401, "Please log in");
  const acc = me!;
  if (path === "/api/account/password" && m === "POST") {
    if (tooMany(`password:${acc.id}`, 5, 15 * 60_000)) fail(429, "Too many tries. Wait 15 minutes.");
    const b = await json(req, NewPassword);
    await accountCall(() => changePassword(acc.id, b.current, b.next, token, ip));
    return send(res, 200, { ok: true });
  }
  if (path === "/api/account/logout-everywhere" && m === "POST") {
    await endAllSessions(acc.id);
    return send(res, 200, { ok: true }, { "set-cookie": clearCookie(USER_COOKIE) });
  }

  if (path === "/api/projects" && m === "GET") {
    return send(res, 200, await Promise.all((await db.listProjects(acc.id)).map(async (p) => {
      const ups = await db.updates.load(p.id);
      const full = summarise(p.rooms, ups, await db.issues.load(p.id));
      const { states: _states, ...s } = full;
      const { alerts, more } = progressAlerts(p.rooms, full, ups);
      // newest photo that was not rejected: the card's cover, so a site is recognisable at a glance
      const cover = [...ups].reverse().find((u) => u.review !== "rejected" && u.photos.length)?.photos[0].file ?? null;
      return { alerts: alerts.length + more, id: p.id, name: p.name, location: p.location, createdAt: p.createdAt, type: p.spec.type, description: describeRooms(p.spec.type, p.rooms), summary: s, cover };
    })));
  }
  if (path === "/api/projects" && m === "POST") {
    const b = await json(req, NewProject);
    const n = countRooms(b.spec);
    if (n < 1) fail(400, "Add at least one room");
    if (n > MAX_ROOMS) fail(400, `That is ${n} rooms; the limit is ${MAX_ROOMS}`);
    return send(res, 201, await db.createProject(acc.id, { name: b.name, location: b.location, spec: b.spec, rooms: withItems(buildRooms(b.spec), b.checklists) }));
  }
  if (path === "/api/plans" && m === "POST") {
    const fd = await form(req, 41 * MB);
    const imgs = files(fd, "plans");
    if (!imgs.length) fail(400, "Choose at least one plan image");
    if (imgs.length > 4) fail(400, "At most 4 plan images at once (one per floor or block)");
    for (const f of imgs) {
      if (!IMAGE_EXT[f.type]) fail(400, `${f.name}: use a JPEG, PNG or WebP image. For a PDF plan, take a screenshot of each sheet.`);
      if (f.size > 10 * MB) fail(400, `${f.name} is over 10 MB`);
    }
    return send(res, 202, { jobId: startPlanJob(acc.id, await Promise.all(imgs.map(async (f) => Buffer.from(await f.arrayBuffer())))) });
  }
  if ((g0 = path.match(/^\/api\/plans\/([a-f0-9]{16})$/)) && m === "GET") {
    const job = planJobs.get(g0[1]);
    if (!job || job.owner !== acc.id) fail(404, "This plan reading has expired. Upload the plan again.");
    const j = job!;
    const ahead = j.status === "queued" ? jobs.length : 0;
    return send(res, 200, { status: j.status, done: j.done, total: j.total, ahead, draft: j.draft ?? null, error: j.error ?? null });
  }

  g = path.match(/^\/api\/projects\/([^/]+)(\/.*)?$/);
  if (g) {
    // another account's project answers exactly like one that does not exist
    const p = (await db.ownedProject(g[1], acc.id)) ?? fail(404, "No such project");
    return projectRoute(req, res, url, p, g[2] ?? "", false);
  }
  fail(404, "Not found");
}

// behind nginx (the only way in, in Docker) the real address is in X-Real-IP
// ponytail: trusted as given; when running `npm run api` directly it can be faked, which only affects rate limits
const clientIp = (req: IncomingMessage) => String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "").slice(0, 64) || null;

async function accountCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AccountError) fail(400, e.message);
    throw e;
  }
}

// ---------- admin: reached from /suhayb in the web app; its own login, cookie and short sessions.
// Anything here without an admin session answers 404, so the admin API does not show itself.
async function adminRoute(req: IncomingMessage, res: ServerResponse, path: string, m: string, ip: string | null, secure: boolean) {
  const token = readCookie(req.headers.cookie, ADMIN_COOKIE);
  if (path === "/api/admin/login" && m === "POST") {
    if (tooMany(`admin:${ip}`, 5, 15 * 60_000)) fail(429, "Too many attempts. Wait 15 minutes.");
    const b = await json(req, Login);
    const id = await accountCall(() => login(b.email, b.password, true, ip));
    const s = await newSession(id, true);
    return send(res, 200, { ok: true }, { "set-cookie": cookie(ADMIN_COOKIE, s.token, s.maxAge, secure) });
  }
  if (path === "/api/admin/logout" && m === "POST") {
    await endSession(token);
    return send(res, 200, { ok: true }, { "set-cookie": clearCookie(ADMIN_COOKIE) });
  }
  const admin: Account | null = await sessionAccount(token, true);
  if (path === "/api/admin/overview" && m === "GET") {
    if (!admin) fail(401, "Admin login needed");
    return send(res, 200, await adminOverview());
  }
  fail(404, "Not found");
}

await migrate();
createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (e instanceof HttpError) return send(res, e.code, { error: e.message });
    if (e instanceof z.ZodError) return send(res, 400, { error: e.issues.map((i) => i.message).join("; ") });
    console.error(e);
    send(res, 500, { error: "Something went wrong on the server" });
  });
}).listen(Number(process.env.PORT ?? 3001), () => {
  console.log(`SiteSight API on http://localhost:${process.env.PORT ?? 3001}`);
  if (!process.env.SIGNUP_CODE) console.warn("SIGNUP_CODE is not set: anyone who finds this site can create an account. Set it in .env for a public server.");
  const ai = process.env.AI_PROVIDER;
  if (!ai) console.warn("AI_PROVIDER is not set: photo checks use the DEMO provider (fake answers). Use `npm run api`.");
  else if (ai === "gemini") console.log(`AI: Google Gemini (${process.env.GEMINI_MODEL || GEMINI_MODEL})${process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? "" : " - GEMINI_API_KEY is not set, AI calls will fail"}`);
  else console.log(`AI: ${ai === "local" ? "local Ollama" : ai} (${process.env.OLLAMA_MODEL ?? DEFAULT_MODEL})`);
  // photos that were still waiting for the AI when the server last stopped
  void (async () => {
    for (const p of await db.listProjects()) for (const u of await db.updates.load(p.id)) for (const ph of u.photos) if (ph.checking) enqueue({ projectId: p.id, updateId: u.id, file: ph.file });
  })().catch((e) => console.error("Could not re-queue photo checks:", e));
  // WhatsApp reports and alerts: checked every hour (each is sent once, so a restart never repeats one)
  void tick();
  setInterval(() => void tick(), 3600_000);
});
