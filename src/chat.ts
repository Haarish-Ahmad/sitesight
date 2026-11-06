import { roomLabel, scopeLabel, type Room } from "./structure.js";
import { areasOf } from "./alerts.js";
import { ago } from "./describe.js";
import { buildReport } from "./report.js";
import { ORDER, stageLabel } from "./stages.js";
import { meanProgress, mediaLabel, needsReview, statusOf, summarise, type Summary } from "./summary.js";
import { progressAlerts } from "./alerts.js";
import { plainSummary } from "./describe.js";
import type { Issue, Update } from "./types.js";
import { generate } from "./ai/ollama.js";

const DAY = 86_400_000;
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const STOP = new Set("the a an is are was were of in on at to for and or what which how many much any did do does has have there this that it with from by be".split(" "));

// Pick the records most related to the question, so a small model sees a short, relevant context.
// `focus`: rooms the question is about; their records come first.
export function selectEvidence(question: string, updates: Update[], issues: Issue[], now = new Date(), max = 25, focus: Set<string> = new Set()) {
  const q = new Set(words(question).filter((w) => !STOP.has(w)));
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let since = 0;
  if (q.has("today")) since = startOfToday;
  else if (q.has("yesterday")) since = startOfToday - DAY;
  else if (q.has("week")) since = startOfToday - 7 * DAY;
  else if (q.has("month")) since = startOfToday - 30 * DAY;

  const score = (text: string, at: string, boost = 0) => {
    const hits = words(text).filter((w) => q.has(w) || q.has(w.replace(/s$/, ""))).length;
    const recency = Math.max(0, 1 - (+now - +new Date(at)) / (60 * DAY)); // 0..1, newer first on ties
    return hits * 10 + boost + recency;
  };
  // questions about reviews or problems should see those records first, whatever their wording
  const aboutReview = ["review", "check", "flag", "flagged", "approve", "fake", "suspicious"].some((w) => q.has(w));
  const aboutIssues = ["issue", "issues", "problem", "problems", "defect", "defects", "wrong", "damage"].some((w) => q.has(w));
  const u = updates
    .filter((x) => +new Date(x.at) >= since)
    .map((x) => ({ x, s: score(`${x.scopeLabel} ${x.stage} ${x.note} ${x.photos.flatMap((p) => [...p.flags, ...(p.ai?.issues ?? [])]).join(" ")}`, x.at, (aboutReview && needsReview(x) ? 50 : 0) + (x.roomIds.some((id) => focus.has(id)) ? 30 : 0)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((e) => e.x);
  const i = issues
    .filter((x) => x.status !== "dismissed")
    .map((x) => ({ x, s: score(`${x.scopeLabel} ${x.title} ${x.note} ${x.severity} ${x.status}`, x.at, (aboutIssues && x.status === "open" ? 50 : 0) + (x.roomIds.some((id) => focus.has(id)) ? 30 : 0)) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 15)
    .map((e) => e.x);
  return { updates: u, issues: i };
}

const day = (iso: string) => iso.slice(0, 10);
const STATUS = { needs_review: "NEEDS REVIEW", checking: "AI still checking", looks_right: "looks right", approved: "approved by a person", rejected: "rejected (does not count)", no_photo: "no photo" };

export function evidenceText(updates: Update[], issues: Issue[]) {
  const u = updates.map((x) => {
    const ai = x.photos.map((p) => p.ai && `AI saw ${p.ai.stage} (${p.ai.confidence})`).filter(Boolean);
    const flags = x.photos.flatMap((p) => p.flags);
    return `[U${x.id}] ${day(x.at)} | ${x.scopeLabel} | reported stage: ${x.stage} | ${mediaLabel(x.photos)} | status: ${STATUS[statusOf(x)]}${x.note ? ` | note: ${x.note}` : ""}${ai.length ? ` | ${ai.join(", ")}` : ""}${flags.length ? ` | flags: ${flags.join("; ")}` : ""}`;
  });
  const i = issues.map((x) => `[I${x.id}] ${day(x.at)} | ${x.scopeLabel} | ${x.severity} | ${x.status} | ${x.title}${x.note ? ` | ${x.note}` : ""}`);
  return [...u, ...i].join("\n");
}

const PROMPT = `You answer questions from a construction site manager using ONLY the facts and records below.
Rules:
- After every fact taken from a record, write that record's id in square brackets, like [U12] or [I3].
- KEY FACTS are already correct and complete: prefer them, and copy their ids.
- If neither the facts nor the records answer the question, say so plainly. Never invent rooms, dates, numbers or stages.
- Answer in plain language, in 1 to 4 short sentences.
Example answer: "Two updates need review: Block A Floor 1 re-used an earlier photo [U6], and the Flat A-101 kitchen photo looks like plumbing, not tiling [U3]."`;

// Facts computed in code, with ids, so a small model restates them instead of inferring them.
export function keyFacts(rooms: Room[], summary: Summary, updates: Update[], issues: Issue[]) {
  const review = updates.filter(needsReview).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  const open = issues.filter((i) => i.status === "open").slice(0, 10);
  const blocks = [...new Set(rooms.map((r) => r.block).filter((b): b is string => !!b))];
  return [
    review.length
      ? `Updates that need review (${updates.filter(needsReview).length}): ${review.map((u) => `[U${u.id}] ${u.scopeLabel}: ${u.stage === "finishing" && !u.photos.some((p) => p.flags.length) ? "marked finished, needs sign-off" : u.photos.flatMap((p) => p.flags).join("; ")}`).join(" / ")}`
      : "No updates need review.",
    open.length ? `Open issues (${open.length}): ${open.map((i) => `[I${i.id}] ${i.severity} priority: ${i.title} (${i.scopeLabel})`).join(" / ")}` : "No open issues.",
    (() => {
      const { alerts, more } = progressAlerts(rooms, summary, updates);
      return alerts.length ? `Progress alerts (${alerts.length + more}): ${alerts.map((a) => `${a.severity} priority, ${a.label}: ${a.detail}`).join(" / ")}` : "No progress alerts.";
    })(),
    `Rooms: ${summary.roomsTotal} total, ${summary.roomsStarted} started, ${summary.roomsDone} finished, ${summary.stageCounts.not_started ?? 0} not started.`,
    ...blocks.map((b) => `Block ${b}: ${meanProgress(rooms.filter((r) => r.block === b).map((r) => r.id), summary.states)}% complete.`),
  ].join("\n");
}

export type Turn = { q: string; a: string };

export function buildPrompt(question: string, projectName: string, rooms: Room[], summary: Summary, ev: ReturnType<typeof selectEvidence>, all: { updates: Update[]; issues: Issue[] }, now = new Date(), extra: { facts?: string[]; history?: Turn[]; photo?: boolean } = {}) {
  const history = extra.history?.length ? `\nEARLIER IN THIS CONVERSATION (for context only; answer the new question):\n${extra.history.map((t) => `Q: ${t.q}\nA: ${t.a}`).join("\n")}\n` : "";
  return `${PROMPT}

SITE OVERVIEW (${projectName}):
${plainSummary(projectName, rooms, summary, now).join(" ")}

KEY FACTS:
${[...(extra.facts ?? []), keyFacts(rooms, summary, all.updates, all.issues)].join("\n")}
${history}
RECORDS:
${evidenceText(ev.updates, ev.issues) || "(no records match)"}
${extra.photo ? `
PHOTO: The manager attached a photo from site. Say what is clearly visible in it that matters to the question (stage of work, workmanship, visible defects or safety problems). Say plainly if the photo is unclear. Progress figures and dates still come only from the facts and records above.
` : ""}
QUESTION: ${question}`;
}

// Keep only citations that point at records the model was actually shown (records or key facts).
export function checkCitations(answer: string, ev: ReturnType<typeof selectEvidence>, extra: string[] = []) {
  const known = new Set([...ev.updates.map((u) => `U${u.id}`), ...ev.issues.map((i) => `I${i.id}`), ...extra]);
  const refs: string[] = [];
  // models also write "[U3, U4]" or "[KEY FACTS, U3]": keep each known id as its own [U3], drop the rest
  const text = answer.replace(/\[([^\[\]]{1,80})\]/g, (m, inner: string) => {
    const ids = inner.match(/\b[UI]\d+\b/g);
    if (!ids) return /^\s*(key facts|records?|site overview)\s*$/i.test(inner) ? "" : m;
    const ok = ids.filter((id) => known.has(id));
    for (const id of ok) if (!refs.includes(id)) refs.push(id);
    return ok.map((id) => `[${id}]`).join(" ");
  });
  return { answer: text.replace(/ +([.,])/g, "$1").trim(), refs };
}

// image: base64 JPEG the manager attached to the question
export const askModel = (prompt: string, image?: string) => generate([{ role: "user", content: prompt, ...(image && { images: [image] }) }], { temperature: 0.1 });

// ---------- the part of the site a question is about, worked out in code

const ORD: Record<string, number> = { ground: 0, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, basement: -1 };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const baseName = (n: string) => n.toLowerCase().replace(/\s+\d+$/, "");

// "kitchens on the 2nd floor of block A", "flat A-102", "G01" -> the rooms meant. Null when the question names no place.
export function scopeOf(question: string, rooms: Room[]): { rooms: Room[]; label: string } | null {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9-]+/g, " ")} `;
  let picked = rooms;
  let named = false;
  const narrow = (keep: (r: Room) => boolean) => {
    const next = picked.filter(keep);
    named = true;
    picked = next;
  };
  const units = [...new Set(rooms.map((r) => r.unit).filter((u): u is string => !!u))];
  const unit = units.find((u) => new RegExp(`[ -]${u.toLowerCase().replace("-", "-?")} `).test(q) || new RegExp(` (flat|unit) ${u.split("-")[1].toLowerCase()} `).test(q));
  if (unit) narrow((r) => r.unit === unit);
  const block = q.match(/ block ([a-z]) /)?.[1]?.toUpperCase();
  if (block && rooms.some((r) => r.block === block)) narrow((r) => r.block === block);
  const fw = q.match(/ (ground|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|basement|(\d+)(?:st|nd|rd|th)?) floor /) ?? q.match(/ floor (\d+) /);
  if (fw && !unit) {
    const f = fw[1] in ORD ? ORD[fw[1]] : Number(fw[2] ?? fw[1]);
    narrow((r) => r.floor === f);
  }
  // room types: "kitchen", "kitchens", "bedroom 2"
  const types = [...new Set(rooms.map((r) => baseName(r.name)))].sort((a, b) => b.length - a.length);
  const exact = rooms.find((r) => q.includes(` ${r.name.toLowerCase()} `) && /\d$/.test(r.name));
  const type = types.find((t) => q.includes(` ${t} `) || q.includes(` ${t}s `) || (t === "toilet" && / (bathroom|bathrooms|washroom)s? /.test(q)) || (t === "bathroom" && / (toilet|toilets) /.test(q)));
  if (exact) narrow((r) => r.name === exact.name);
  else if (type) narrow((r) => baseName(r.name) === type);
  if (!named) return null;
  return { rooms: picked, label: picked.length ? (picked.length === 1 ? roomLabel(picked[0]) : scopeLabel(picked)) : "no matching rooms" };
}

// Exact figures for that part of the site, with record ids the model can cite.
export function scopeFacts(scope: { rooms: Room[]; label: string }, s: Summary, updates: Update[], now = new Date()) {
  if (!scope.rooms.length) return "The question names a place that does not match any room in this project.";
  const ids = new Set(scope.rooms.map((r) => r.id));
  const st = scope.rooms.map((r) => s.states[r.id]);
  const byStage = ORDER.map((o) => ({ o, n: st.filter((x) => x.stage === o).length })).filter((x) => x.n).reverse();
  const notStarted = st.filter((x) => !x.stage).length;
  const touching = updates.filter((u) => u.roomIds.some((id) => ids.has(id))).sort((a, b) => b.at.localeCompare(a.at));
  const photos = touching.reduce((n, u) => n + u.photos.length, 0);
  const left = new Map<string, number>();
  let total = 0;
  for (const r of scope.rooms) for (const i of r.items ?? []) {
    total++;
    if (!i.doneAt) left.set(i.name, (left.get(i.name) ?? 0) + 1);
  }
  const open = [...left.values()].reduce((a, b) => a + b, 0);
  const parts = [
    `${scope.label}: ${meanProgress([...ids], s.states)}% complete.`,
    byStage.length ? `Current stage: ${byStage.map((x) => `${x.n} at ${x.o}`).join(", ")}${notStarted ? `, ${notStarted} not started` : ""}.` : "No work recorded yet.",
    `${st.filter((x) => x.stage === "finishing").length} of ${plural(scope.rooms.length, "room")} finished.`,
    touching.length ? `${plural(touching.length, "update")} with ${plural(photos, "photo")}; latest [U${touching[0].id}] ${ago(touching[0].at, now)}: ${touching[0].scopeLabel} reported ${touching[0].stage}.` : "No updates mention these rooms.",
    total ? (open ? `Required items still to do: ${open} of ${total} (${[...left].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, k]) => `${n}${k > 1 ? ` in ${k} rooms` : ""}`).join("; ")}).` : `All ${total} required items are done.`) : "",
  ];
  if (scope.rooms.length <= 12) parts.push(`Rooms: ${scope.rooms.map((r) => `${r.unit ? `${r.unit} ` : ""}${r.name} ${s.states[r.id].stage ?? "not started"}`).join(", ")}.`);
  return parts.filter(Boolean).join(" ");
}

// "Which rooms are at plastering?" -> where they are, grouped by flat or room.
export function stageFacts(question: string, rooms: Room[], s: Summary) {
  const q = question.toLowerCase();
  const stage = ORDER.find((o) => q.includes(o)) ?? (/not (yet )?started|untouched/.test(q) ? null : undefined);
  if (stage === undefined) return null;
  const at = rooms.filter((r) => (s.states[r.id]?.stage ?? null) === stage);
  const areas = areasOf(at).map((a) => scopeLabel(a.rooms));
  const what = stage ? `at ${stage}` : "not started";
  return at.length ? `Rooms ${what}: ${plural(at.length, "room")}: ${areas.slice(0, 15).join(" / ")}${areas.length > 15 ? ` / and ${areas.length - 15} more areas` : ""}.` : `No rooms are ${what}.`;
}

// Recent change in code, so "what happened this week" never depends on the model's arithmetic.
export function periodFacts(question: string, rooms: Room[], updates: Update[], issues: Issue[], now = new Date()) {
  const q = question.toLowerCase();
  const period = /\b(today|yesterday)\b/.test(q) ? "day" : /\b(week|weekly|lately|recent|recently|changed|progress)\b/.test(q) ? "week" : null;
  if (!period) return null;
  const when = /yesterday/.test(q) ? new Date(+now - DAY) : now;
  const r = buildReport(rooms, updates, issues, period, when);
  return `${period === "day" ? (/yesterday/.test(q) ? "Yesterday" : "Today") : "This week"}: ${r.narrative.join(" ")}${r.logged.length ? ` Updates: ${r.logged.slice(-6).map((u) => `[U${u.id}] ${u.scopeLabel} ${u.stage}`).join("; ")}.` : ""}`;
}

export function chatFacts(question: string, rooms: Room[], s: Summary, updates: Update[], issues: Issue[], history: Turn[] = [], now = new Date()) {
  // a follow-up like "and the kitchens?" keeps the place from the question before
  const scope = scopeOf(question, rooms) ?? (history.length ? scopeOf(`${history[history.length - 1].q} ${question}`, rooms) : null);
  const facts = [scope && scopeFacts(scope, s, updates, now), stageFacts(question, scope?.rooms ?? rooms, s), periodFacts(question, rooms, updates, issues, now)].filter((x): x is string => !!x);
  return { facts, focus: new Set(scope?.rooms.map((r) => r.id) ?? []) };
}

// When the model is unreachable the manager still gets the computed figures, labelled as such.
export function offlineAnswer(facts: string[], projectName: string, rooms: Room[], s: Summary, now = new Date()) {
  const body = facts.length ? facts.join(" ") : plainSummary(projectName, rooms, s, now).join(" ");
  return `The AI is not available right now, so here are the figures straight from the site records. ${body}`;
}

// The whole answer, as the server gives it: figures from code, wording from the model, citations checked.
// If the model fails, the figures alone are returned (offline: true).
export async function answerQuestion(p: { name: string; rooms: Room[] }, ups: Update[], iss: Issue[], question: string, history: Turn[] = [], { now = new Date(), ask = askModel, image }: { now?: Date; ask?: typeof askModel; image?: string } = {}) {
  const sum = summarise(p.rooms, ups, iss);
  const { facts, focus } = chatFacts(question, p.rooms, sum, ups, iss, history, now);
  const ev = selectEvidence(question, ups, iss, now, 25, focus);
  const prompt = buildPrompt(question, p.name, p.rooms, sum, ev, { updates: ups, issues: iss }, now, { facts, history, photo: !!image });
  const factIds = [...[...facts, keyFacts(p.rooms, sum, ups, iss)].join(" ").matchAll(/\[([UI]\d+)\]/g)].map((m) => m[1]);
  let raw: string, offline = false;
  try {
    raw = await ask(prompt, image);
  } catch (e) {
    console.error("Chat model failed:", e instanceof Error ? e.message : e);
    raw = offlineAnswer(facts, p.name, p.rooms, sum);
    offline = true;
  }
  const out = checkCitations(raw, ev, factIds);
  // the records the model was shown first, so the answer can be checked even when it cites nothing
  const read = [...ev.updates.slice(0, 4).map((u) => `U${u.id}`), ...ev.issues.slice(0, 2).map((i) => `I${i.id}`)];
  return { ...out, read, offline };
}
