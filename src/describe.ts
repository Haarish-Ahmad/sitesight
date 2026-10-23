import { GROUPS, ORDER, stageLabel } from "./stages.js";
import { meanProgress, type Summary } from "./summary.js";
import type { Room } from "./structure.js";
import { enoughHistory, MIN_HISTORY_DAYS } from "./finish.js";

const DAY = 86_400_000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ago(iso: string, now = new Date()) {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(new Date(iso))) / DAY);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} days ago` : `${Math.round(days / 7)} weeks ago`;
}

export function weeksText(days: number) {
  if (days <= 0) return "no time at all";
  if (days < 14) return `about ${plural(days, "day")}`;
  return `about ${plural(Math.round(days / 7), "week")}`;
}

// The project in a few plain sentences, for people who will not read a chart.
// `viewer`: wording for people with a read-only link, who are not the ones reviewing.
export function plainSummary(name: string, rooms: Room[], s: Summary, now = new Date(), viewer = false): string[] {
  if (!rooms.length) return [`${name} has no rooms set up yet.`];
  if (!s.updatesCount) return [`${name} is set up with ${plural(rooms.length, "room")}. No site updates yet: upload the first photos to start tracking progress.`];

  const out = [`${name} is about ${s.progressPct}% complete. ${s.roomsStarted} of ${plural(s.roomsTotal, "room")} have work under way, and ${s.roomsDone} ${s.roomsDone === 1 ? "is" : "are"} finished.`];

  const blocks = [...new Set(rooms.map((r) => r.block).filter((b): b is string => !!b))];
  if (blocks.length > 1) {
    const prog = blocks.map((b) => ({ b, p: meanProgress(rooms.filter((r) => r.block === b).map((r) => r.id), s.states) })).sort((x, y) => y.p - x.p);
    if (prog[0].p !== prog[prog.length - 1].p)
      out.push(`Block ${prog[0].b} is furthest along (${prog[0].p}%); Block ${prog[prog.length - 1].b} has the most left to do (${prog[prog.length - 1].p}%).`);
  }

  const common = ORDER.map((st) => ({ st, n: s.stageCounts[st] ?? 0 })).sort((a, b) => b.n - a.n)[0];
  if (common.n) {
    const group = GROUPS.find((g) => (g.stages as readonly string[]).includes(common.st))!.name.toLowerCase();
    out.push(`Most active rooms are at ${stageLabel(common.st).toLowerCase()} (${group}).`);
  }

  const who = viewer ? "the site team's" : "your";
  out.push(s.needsReview ? `${plural(s.needsReview, "update")} ${s.needsReview === 1 ? "is" : "are"} waiting for ${who} review.` : `Nothing is waiting for ${who} review.`);
  if (s.openIssues) out.push(`${plural(s.openIssues, "open issue")}${s.highIssues ? `, ${s.highIssues} high priority` : ""}.`);

  out.push(
    s.etaDays === 0
      ? "All work is finished."
      : !enoughHistory(s)
        ? `Finish date: not enough history yet. It needs about ${MIN_HISTORY_DAYS} days of updates showing rooms moving forward.`
        : `Finish date: at the pace of the last ${plural(s.historyDays, "day")}, roughly ${weeksText(s.etaDays!).replace("about ", "")}; a rough guide only.`,
  );
  if (s.lastActivityAt) out.push(`Last update: ${ago(s.lastActivityAt, now)}.`);
  return out;
}
