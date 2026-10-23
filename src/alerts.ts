import { ORDER, stageLabel } from "./stages.js";
import { floorLabel, scopeLabel, type Room } from "./structure.js";
import { needsReview, type Summary } from "./summary.js";
import type { Update } from "./types.js";

const DAY = 86_400_000;
const BEHIND_BY = 3; // stages behind the typical area before it counts as lagging
const UNEVEN_BY = 4; // rooms in one flat 1-3 stages apart is normal overlap; 4+ is worth a look
const HIGH_UNEVEN = 6; // e.g. bathroom at flooring while the rest of the flat has not started
const MIN_STALL_DAYS = 14;
const MAX_ALERTS = 8;

export type Alert = {
  kind: "stalled" | "behind" | "uneven" | "site_idle";
  severity: "high" | "medium";
  key: string;
  label: string;
  roomIds: string[];
  detail: string;
  weight: number;
};
export type Alerts = {
  alerts: Alert[];
  more: number;
  notStarted: { count: number; total: number; noun: string; labels: string[] }; // calm summary, not an alert
  reviewNotes: Record<number, string>; // extra context added to an update already waiting in Review
};

// Areas a manager thinks in: each flat (and each floor's shared spaces) in apartments, each room in a house.
export function areasOf(rooms: Room[]) {
  const groups = new Map<string, Room[]>();
  for (const r of rooms) {
    const k = r.block ? `${r.block}|${r.floor}|${r.unit ?? "shared"}` : r.id;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups].map(([key, rs]) => ({ key, rooms: rs }));
}

// Groups whose rooms should move roughly together: a flat, or a floor of a house.
function evenGroups(rooms: Room[]) {
  const groups = new Map<string, Room[]>();
  for (const r of rooms) {
    if (r.floor === null || (r.block && !r.unit)) continue; // outside and shared spaces run on their own schedule
    const k = r.unit ? `flat|${r.unit}` : `floor|${r.floor}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups].filter(([, rs]) => rs.length > 1).map(([key, rs]) => ({ key, rooms: rs }));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const names = (rs: Room[]) => (rs.length <= 3 ? rs.map((r) => r.name).join(", ").replace(/, ([^,]*)$/, " and $1") : `${rs.slice(0, 2).map((r) => r.name).join(", ")} and ${rs.length - 2} more`);
const stageText = (no: number) => (no === 0 ? "not started" : `at ${stageLabel(ORDER[no - 1]).toLowerCase()}`);

// Plain-arithmetic progress warnings, computed from the claims after the AI has checked the photos.
// Kept deliberately few: one alert per area, and nothing that Review already shows.
export function progressAlerts(rooms: Room[], s: Summary, updates: Update[] = [], now = new Date()): Alerts {
  const empty: Alerts = { alerts: [], more: 0, notStarted: { count: 0, total: 0, noun: "room", labels: [] }, reviewNotes: {} };
  if (!s.lastActivityAt) return empty;
  const idleDays = Math.floor((+now - +new Date(s.lastActivityAt)) / DAY);
  if (idleDays >= MIN_STALL_DAYS)
    return { ...empty, alerts: [{ kind: "site_idle", severity: "high", key: "site", label: "Whole site", roomIds: [], detail: `No updates anywhere for ${idleDays} days`, weight: idleDays }] };

  const byId = new Map(updates.map((u) => [u.id, u]));
  const alerts: Alert[] = [];
  const reviewNotes: Record<number, string> = {};
  const covered = new Set<string>();

  // 1. uneven: rooms in one flat (or one floor of a house) far apart
  for (const g of evenGroups(rooms)) {
    const no = (r: Room) => s.states[r.id].stageNo;
    const hi = Math.max(...g.rooms.map(no));
    const lo = Math.min(...g.rooms.map(no));
    if (hi - lo < UNEVEN_BY) continue;
    const leaders = g.rooms.filter((r) => no(r) === hi);
    const behind = g.rooms.filter((r) => no(r) - lo < UNEVEN_BY / 2); // the ones at (or near) the bottom
    const detail = `${names(leaders)} ${leaders.length === 1 ? "is" : "are"} ${stageText(hi)}, but ${names(behind)} ${behind.length === 1 ? "is" : "are"} ${stageText(lo)}`;
    // the claim that put the leaders ahead: if Review already shows it, say it there instead of a second alert
    const lead = leaders.map((r) => byId.get(s.states[r.id].lastUpdateId ?? -1)).find(Boolean);
    const where = g.rooms[0].unit ? "the flat" : "this floor";
    if (lead && lead.photos.some((p) => p.checking)) continue; // wait for the AI before raising it
    if (lead && needsReview(lead)) {
      reviewNotes[lead.id] = `It is also far ahead of the rest of ${where}: ${detail}.`;
      g.rooms.forEach((r) => covered.add(r.id));
      continue;
    }
    alerts.push({ kind: "uneven", severity: hi - lo >= HIGH_UNEVEN ? "high" : "medium", key: g.key, label: g.rooms[0].unit ? `Flat ${g.rooms[0].unit}` : floorLabel(g.rooms[0].floor), roomIds: g.rooms.map((r) => r.id), detail, weight: 100 + (hi - lo) * 10 });
    g.rooms.forEach((r) => covered.add(r.id));
  }

  // 2. stalled and behind, per area; skipped where an uneven alert already speaks for those rooms
  // a slow crew should not trip the alarm: wait at least three typical stage-lengths
  const stallDays = Math.max(MIN_STALL_DAYS, Math.ceil(3 * (s.avgDaysPerStage ?? 0)));
  const areas = areasOf(rooms).map((a) => {
    const st = a.rooms.map((r) => s.states[r.id]);
    const last = st.map((x) => x.lastAt).filter((x): x is string => !!x).sort().pop() ?? null;
    return { ...a, mean: st.reduce((n, x) => n + x.stageNo, 0) / st.length, last, done: st.every((x) => x.stageNo === ORDER.length), started: st.some((x) => x.stageNo > 0) };
  });
  const typical = median(areas.map((a) => a.mean));
  for (const a of areas) {
    if (a.done || a.rooms.every((r) => covered.has(r.id))) continue;
    const label = scopeLabel(a.rooms);
    const ids = a.rooms.map((r) => r.id);
    const days = a.last ? Math.floor((+now - +new Date(a.last)) / DAY) : null;
    if (days !== null && days >= stallDays)
      alerts.push({ kind: "stalled", severity: days >= 2 * stallDays ? "high" : "medium", key: a.key, label, roomIds: ids, detail: `No progress for ${days} days while other areas moved on`, weight: days });
    else if (a.started && typical >= BEHIND_BY && typical - a.mean >= BEHIND_BY)
      alerts.push({ kind: "behind", severity: "medium", key: a.key, label, roomIds: ids, detail: `About ${Math.round(typical - a.mean)} stages behind most of the site`, weight: (typical - a.mean) * 10 });
  }

  // 3. not started at all: one calm summary line, since early in a job most of the site is untouched
  const apartment = rooms.some((r) => r.unit);
  const untouched = areas.filter((a) => !a.started && (!apartment || a.rooms[0].unit));
  const pool = areas.filter((a) => !apartment || a.rooms[0].unit);
  const notStarted = { count: untouched.length, total: pool.length, noun: apartment ? "flat" : "room", labels: untouched.map((a) => scopeLabel(a.rooms)) };

  alerts.sort((x, y) => (x.severity === y.severity ? y.weight - x.weight : x.severity === "high" ? -1 : 1));
  return { alerts: alerts.slice(0, MAX_ALERTS), more: Math.max(0, alerts.length - MAX_ALERTS), notStarted, reviewNotes };
}
