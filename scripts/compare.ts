import "../src/env.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analysePhoto } from "../src/ai/analysePhoto.js";
import { GEMINI_MODEL } from "../src/ai/gemini.js";
import { modelProvider } from "../src/ai/ollama.js";
import type { Label } from "../src/ai/score.js";
import { answerQuestion, askModel } from "../src/chat.js";
import { draftFromReadings, readPlan } from "../src/plan.js";
import { buildRooms, type StructureSpec } from "../src/structure.js";
import { summarise } from "../src/summary.js";
import type { Issue, Project, Update } from "../src/types.js";

// Runs the same jobs on each AI and writes a side-by-side report to eval-results/.
// usage: npm run compare -- [local] [gemini] [--only photos,plans,chat] [--project <id>]
//   default AIs: local, plus gemini when GEMINI_API_KEY is set. Chat uses the sample projects (JSON files) in DATA_DIR (default eval-data/).
const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const hasKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
const named = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const ais = named.length ? named : ["local", ...(hasKey ? ["gemini"] : [])];
const only = (flag("--only") ?? "photos,plans,chat").split(",");
const notes: string[] = [];
if (!named.length && !hasKey) notes.push("Gemini skipped: GEMINI_API_KEY is not set.");

const secs = (t: number) => Math.round((Date.now() - t) / 100) / 10;
async function timed<T>(f: () => Promise<T>) {
  const t = Date.now();
  try {
    return { value: await f(), s: secs(t), error: "" };
  } catch (e) {
    return { value: undefined, s: secs(t), error: e instanceof Error ? e.message : String(e) };
  }
}
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);

// ---------- plans: rooms the draft would create, by floor, compared with the right answer
const roomKeys = (spec: StructureSpec) =>
  buildRooms(spec)
    .filter((r) => r.floor !== null)
    .map((r) => `${r.floor}|${r.name.replace(/\s*\d+$/, "").toLowerCase()}`);
export function roomScore(got: string[], want: string[]) {
  const left = new Map<string, number>();
  for (const k of want) left.set(k, (left.get(k) ?? 0) + 1);
  let hit = 0;
  for (const k of got) if ((left.get(k) ?? 0) > 0) left.set(k, left.get(k)! - 1), hit++;
  const missed = [...left].flatMap(([k, n]) => Array(n).fill(k));
  return { precision: got.length ? hit / got.length : 0, recall: want.length ? hit / want.length : 0, missed };
}

// ---------- chat: every number in the answer should come from what the model was shown
const numbers = (s: string) => new Set(s.replace(/\[?[UI]\d+\]?/g, " ").match(/\d+(?:\.\d+)?/g) ?? []);
const ungrounded = (answer: string, prompt: string) => {
  const known = numbers(prompt);
  return [...numbers(answer)].filter((n) => !known.has(n));
};

type Row = Record<string, unknown>;
const results: Record<string, { photos: Row[]; plans: Row[]; chat: Row[] }> = {};
const pct = (x: number) => `${Math.round(x * 100)}%`;

const labels: Record<string, Label> = JSON.parse(readFileSync("photos/labels.json", "utf8"));
const expected: Record<string, { name: string; spec: StructureSpec }> = JSON.parse(readFileSync("plans/expected.json", "utf8"));

const project = (() => {
  const dir = join(process.env.DATA_DIR ?? "eval-data", "projects");
  const file = <T,>(id: string, name: string, fallback: T): T => (existsSync(join(dir, id, name)) ? JSON.parse(readFileSync(join(dir, id, name), "utf8")) : fallback);
  const all = (existsSync(dir) ? readdirSync(dir) : []).map((id) => ({ p: file<Project>(id, "project.json", null as never), ups: file<Update[]>(id, "updates.json", []), iss: file<Issue[]>(id, "issues.json", []) })).filter((x) => x.p);
  const want = flag("--project");
  return want ? all.find((x) => x.p.id.startsWith(want)) : all.find((x) => x.ups.length);
})();
function questions() {
  if (!project) return [];
  const { p, ups, iss } = project;
  const s = summarise(p.rooms, ups, iss);
  const unit = p.rooms.find((r) => r.unit && s.states[r.id]?.stage)?.unit;
  const common = Object.entries(s.stageCounts).filter(([k]) => k !== "not_started").sort((x, y) => y[1] - x[1])[0]?.[0]?.replace(/_/g, " ");
  return [
    "How far along is the project?",
    ...(unit ? [`What is left in Flat ${unit}?`] : []),
    ...(common ? [`Which rooms are at ${common}?`] : []),
    "What changed this week?",
    "Are there any high priority issues?",
  ];
}

for (const ai of ais) {
  process.env.AI_PROVIDER = ai;
  const r = (results[ai] = { photos: [] as Row[], plans: [] as Row[], chat: [] as Row[] });

  if (only.includes("photos"))
    for (const [file, label] of Object.entries(labels)) {
      const t = await timed(() => analysePhoto(readFileSync(join("photos", file)), modelProvider));
      const v = t.value;
      r.photos.push({ file, want: `${label.area} / ${label.stage}`, got: v ? `${v.area} / ${v.stage} (${v.confidence})` : "", area: v?.area === label.area, stage: v?.stage === label.stage, confidentlyWrong: v?.confidence === "confirmed" && v.stage !== label.stage, s: t.s, error: t.error });
      console.log(ai, file, r.photos.at(-1));
    }

  if (only.includes("plans"))
    for (const [file, want] of Object.entries(expected)) {
      const t = await timed(async () => draftFromReadings([await readPlan(readFileSync(join("plans", file)))]));
      const d = t.value;
      const sc = d ? roomScore(roomKeys(d.spec), roomKeys(want.spec)) : undefined;
      r.plans.push({ file, name: d?.name ?? "", nameOk: !!d && d.name.toLowerCase().includes(want.name.toLowerCase()), rooms: d ? roomKeys(d.spec).length : 0, wantRooms: roomKeys(want.spec).length, precision: sc?.precision ?? 0, recall: sc?.recall ?? 0, missed: [...new Set(sc?.missed ?? [])].slice(0, 12).join(", "), s: t.s, error: t.error });
      console.log(ai, file, r.plans.at(-1));
    }

  if (only.includes("chat") && project)
    for (const q of questions()) {
      let prompt = "";
      const t = await timed(() => answerQuestion(project.p, project.ups, project.iss, q, [], { ask: (pr) => ((prompt = pr), askModel(pr)) }));
      const a = t.value;
      r.chat.push({ q, answer: a?.answer ?? "", offline: a?.offline ?? true, refs: a?.refs.length ?? 0, ungrounded: a && !a.offline ? ungrounded(a.answer, prompt).join(", ") : "", s: t.s, error: t.error });
      console.log(ai, q, r.chat.at(-1));
    }
}
if (only.includes("chat") && !project) notes.push("Chat skipped: no project with updates in the data folder.");

// ---------- report
const L: string[] = [`# AI comparison, ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, ""];
L.push(`AIs: ${ais.map((a) => (a === "gemini" ? `gemini (${process.env.GEMINI_MODEL || GEMINI_MODEL})` : a === "local" ? `local Ollama (${process.env.OLLAMA_MODEL ?? "qwen2.5vl:3b"}, plans: ${process.env.OLLAMA_PLAN_MODEL ?? process.env.OLLAMA_MODEL ?? "qwen2.5vl:3b"})` : a)).join(" vs ")}`, ...notes.map((n) => `\n> ${n}`), "");
const head = (cols: string[]) => [`| ${cols.join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`];
L.push("## Summary", "", ...head(["", ...ais]));
const sum = (label: string, f: (r: (typeof results)[string]) => string) => L.push(`| ${label} | ${ais.map((a) => f(results[a])).join(" | ")} |`);
const n = (rows: Row[], k: string) => rows.filter((x) => x[k] === true).length;
if (only.includes("photos")) {
  sum("Photos: area right", (r) => `${n(r.photos, "area")}/${r.photos.length}`);
  sum("Photos: stage right", (r) => `${n(r.photos, "stage")}/${r.photos.length}`);
  sum("Photos: confidently wrong", (r) => `${n(r.photos, "confidentlyWrong")}`);
  sum("Photos: failed calls", (r) => `${r.photos.filter((x) => x.error).length}`);
  sum("Photos: seconds each (avg)", (r) => `${avg(r.photos.map((x) => x.s as number))}`);
}
if (only.includes("plans")) {
  sum("Plans: rooms found (recall)", (r) => r.plans.map((x) => pct(x.recall as number)).join(" / "));
  sum("Plans: rooms correct (precision)", (r) => r.plans.map((x) => pct(x.precision as number)).join(" / "));
  sum("Plans: seconds each", (r) => r.plans.map((x) => x.s).join(" / "));
}
if (only.includes("chat") && project) {
  sum("Chat: answered by the AI", (r) => `${r.chat.filter((x) => !x.offline).length}/${r.chat.length}`);
  sum("Chat: answers with a number not in the records", (r) => `${r.chat.filter((x) => x.ungrounded).length}`);
  sum("Chat: seconds each (avg)", (r) => `${avg(r.chat.map((x) => x.s as number))}`);
}
const table = (title: string, key: "photos" | "plans" | "chat", cols: string[]) => {
  if (!ais.some((a) => results[a][key].length)) return;
  L.push("", `## ${title}`);
  for (const a of ais) {
    L.push("", `### ${a}`, "", ...head(cols));
    for (const row of results[a][key]) L.push(`| ${cols.map((c) => String(row[c] ?? "").replace(/\|/g, "/").replace(/\n+/g, " ")).join(" | ")} |`);
  }
};
table("Photos", "photos", ["file", "want", "got", "s", "error"]);
table("Plans", "plans", ["file", "name", "rooms", "wantRooms", "missed", "s", "error"]);
table("Chat", "chat", ["q", "answer", "refs", "ungrounded", "s", "error"]);
L.push("", "Plans: rooms are compared by floor and type (e.g. `1|toilet`); recall = share of the right rooms found, precision = share of drafted rooms that are right. Chat: 'a number not in the records' means a number in the answer that appears nowhere in what the model was shown.");

mkdirSync("eval-results", { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const out = join("eval-results", `compare-${stamp}.md`);
writeFileSync(out, L.join("\n") + "\n");
writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify(results, null, 1));
console.log(`\nWrote ${out}\n`);
console.log(L.slice(0, L.indexOf("## Photos") > 0 ? L.indexOf("## Photos") : undefined).join("\n"));
