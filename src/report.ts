import { ago } from "./describe.js";
import { stageNo } from "./stages.js";
import { needsReview, roomStates, meanProgress } from "./summary.js";
import type { Room } from "./structure.js";
import type { Issue, Update } from "./types.js";

export type Period = "day" | "week" | "month";

// Local-time window: a day, Monday to Sunday, or a calendar month.
export function periodRange(period: Period, date: Date) {
  if (period === "month") return { from: new Date(date.getFullYear(), date.getMonth(), 1), to: new Date(date.getFullYear(), date.getMonth() + 1, 1) };
  const from = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (period === "week") from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  const to = new Date(from);
  to.setDate(to.getDate() + (period === "week" ? 7 : 1));
  return { from, to };
}

const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", o);

export function reportTitle(period: Period, from: Date, to: Date) {
  if (period === "day") return `Daily report · ${fmt(from, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`;
  if (period === "month") return `Monthly report · ${fmt(from, { month: "long", year: "numeric" })}`;
  const last = new Date(to.getTime() - 1);
  return `Weekly report · ${fmt(from, { day: "numeric", month: "short" })} – ${fmt(last, { day: "numeric", month: "short", year: "numeric" })}`;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function buildReport(rooms: Room[], updates: Update[], issues: Issue[], period: Period, date: Date) {
  const { from, to } = periodRange(period, date);
  const inside = (iso: string | null) => !!iso && new Date(iso) >= from && new Date(iso) < to;
  const ids = rooms.map((r) => r.id);
  const start = roomStates(rooms, updates, from).states;
  const end = roomStates(rooms, updates, to).states;

  const logged = updates.filter((u) => inside(u.at)).sort((a, b) => a.at.localeCompare(b.at));
  const advanced = ids.filter((id) => end[id].stageNo > start[id].stageNo);
  const finished = advanced.filter((id) => end[id].stageNo === stageNo("finishing"));
  const covered = new Set(logged.flatMap((u) => u.roomIds));
  const photos = logged.flatMap((u) => u.photos.map((p) => ({ file: p.file, updateId: u.id, label: u.scopeLabel, stage: u.stage, flagged: p.flags.length > 0 })));
  const opened = issues.filter((i) => inside(i.at) && i.status !== "dismissed" && i.status !== "suggested");
  const resolved = issues.filter((i) => inside(i.resolvedAt));
  const review = logged.filter(needsReview);
  const progressStart = meanProgress(ids, start);
  const progressEnd = meanProgress(ids, end);

  const narrative: string[] = [];
  if (!logged.length) narrative.push(`No site updates were logged ${period === "day" ? "on this day" : `this ${period}`}.`);
  else {
    narrative.push(`${plural(logged.length, "update")} ${logged.length === 1 ? "was" : "were"} logged with ${plural(photos.length, "photo")}, covering ${plural(covered.size, "room")}.`);
    narrative.push(advanced.length ? `${plural(advanced.length, "room")} moved to a later stage${finished.length ? `, and ${finished.length} ${finished.length === 1 ? "was" : "were"} signed off as finished` : ""}.` : "No room moved to a later stage.");
  }
  narrative.push(progressEnd === progressStart ? `Overall progress stayed at ${progressEnd}%.` : `Overall progress went from ${progressStart}% to ${progressEnd}%.`);
  if (review.length) narrative.push(`${plural(review.length, "update")} from this period still ${review.length === 1 ? "needs" : "need"} review.`);
  if (opened.length || resolved.length) narrative.push(`${plural(opened.length, "issue")} reported, ${resolved.length} resolved.`);
  const lastUpdate = updates.filter((u) => new Date(u.at) < to).map((u) => u.at).sort().pop();
  if (!logged.length && lastUpdate) narrative.push(`The last update before this was ${ago(lastUpdate, from)} (counting from the start of this period).`);

  return { period, from, to, title: reportTitle(period, from, to), logged, advanced: advanced.length, finished: finished.length, roomsCovered: covered.size, photos, opened, resolved, review, progressStart, progressEnd, narrative };
}
export type Report = ReturnType<typeof buildReport>;
