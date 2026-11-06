import { ORDER, stageNo, type Stage } from "./stages.js";
import type { Room } from "./structure.js";
import type { Issue, Update } from "./types.js";

const DAY = 86_400_000;

// Rejected claims never count; "finishing" only counts once a person approves it.
export const counts = (u: Update) => u.review !== "rejected" && (u.stage !== "finishing" || u.review === "approved");
export const flagsOf = (u: Update) => u.photos.flatMap((p) => p.flags);
// "3 photos", "2 photos, 1 video", "1 video"
export function mediaLabel(photos: { video?: unknown }[]) {
  const v = photos.filter((p) => p.video).length;
  const n = photos.length - v;
  const part = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  return v ? (n ? `${part(n, "photo")}, ${part(v, "video")}` : part(v, "video")) : part(n, "photo");
}
export const needsReview = (u: Update) => u.review === null && (u.stage === "finishing" || flagsOf(u).length > 0);

export type UpdateStatus = "rejected" | "approved" | "checking" | "needs_review" | "no_photo" | "looks_right";
export function statusOf(u: Update): UpdateStatus {
  if (u.review) return u.review;
  if (u.photos.some((p) => p.checking)) return "checking";
  if (needsReview(u)) return "needs_review";
  return u.photos.length ? "looks_right" : "no_photo";
}

export type RoomState = { stage: Stage | null; stageNo: number; lastAt: string | null; lastUpdateId: number | null; pendingFinish: number | null; itemsPct: number | null }; // itemsPct: share of the room's checklist ticked (now only; null = no checklist)

// Replays the claims in time order. `until` lets reports ask "what did the site look like at the start of the week?".
export function roomStates(rooms: Room[], updates: Update[], until?: Date) {
  const states: Record<string, RoomState> = {};
  // ticks have no history, so past views ("until") ignore them rather than show today's ticks in the past
  const tickPct = (r: Room) => (!until && r.items?.length ? Math.round((r.items.filter((i) => i.doneAt).length / r.items.length) * 100) : null);
  for (const r of rooms) states[r.id] = { stage: null, stageNo: 0, lastAt: null, lastUpdateId: null, pendingFinish: null, itemsPct: tickPct(r) };
  let days = 0, steps = 0; // pace: days per stage step, over every forward move of every room
  const sorted = [...updates].filter((u) => !until || new Date(u.at) < until).sort((a, b) => +new Date(a.at) - +new Date(b.at));
  for (const u of sorted) {
    for (const id of u.roomIds) {
      const s = states[id];
      if (!s) continue;
      if (u.stage === "finishing" && u.review === null) s.pendingFinish = u.id;
      if (!counts(u)) continue;
      const no = stageNo(u.stage);
      if (s.lastAt && no > s.stageNo) { days += (+new Date(u.at) - +new Date(s.lastAt)) / DAY; steps += no - s.stageNo; }
      Object.assign(s, { stage: u.stage, stageNo: no, lastAt: u.at, lastUpdateId: u.id });
      if (u.stage === "finishing") s.pendingFinish = null;
    }
  }
  return { states, days, steps };
}

export const pct = (no: number) => Math.round((no / ORDER.length) * 100);
// a room's progress: its stage, averaged with its ticked checklist when it has one
export const roomPct = (s?: RoomState) => (s?.itemsPct == null ? pct(s?.stageNo ?? 0) : (pct(s.stageNo) + s.itemsPct) / 2);
export const meanProgress = (ids: string[], states: Record<string, RoomState>) =>
  ids.length ? Math.round(ids.reduce((s, id) => s + roomPct(states[id]), 0) / ids.length) : 0;

export type Summary = {
  roomsTotal: number;
  roomsStarted: number;
  roomsDone: number;
  progressPct: number; // average over ALL rooms; not-started rooms count as 0
  stageCounts: Record<string, number>; // stage -> rooms currently there, plus "not_started"
  avgDaysPerStage: number | null; // null = under a day of history, so no honest pace yet
  etaDays: number | null;
  historyDays: number; // first update to last, in whole days
  needsReview: number;
  checking: number; // photos still with the AI
  openIssues: number;
  highIssues: number;
  suggestedIssues: number;
  updatesCount: number;
  photosCount: number;
  lastActivityAt: string | null;
  states: Record<string, RoomState>;
};

export function summarise(rooms: Room[], updates: Update[], issues: Issue[] = []): Summary {
  const { states, days, steps } = roomStates(rooms, updates);
  const list = Object.values(states);
  const stageCounts: Record<string, number> = { not_started: 0 };
  for (const s of list) stageCounts[s.stage ?? "not_started"] = (stageCounts[s.stage ?? "not_started"] ?? 0) + 1;

  // Updates minutes apart say nothing about real pace: need at least a day of history.
  const avgDaysPerStage = steps && days >= 1 ? days / steps : null;
  // ponytail: rooms assumed to progress in parallel, so ETA = slowest room. Add crew capacity if it matters.
  const stepsLeft = Math.max(0, ...list.map((s) => ORDER.length - s.stageNo));
  const open = issues.filter((i) => i.status === "open");
  const last = updates.reduce<string | null>((m, u) => (!m || u.at > m ? u.at : m), null);
  const first = updates.reduce<string | null>((m, u) => (!m || u.at < m ? u.at : m), null);
  return {
    roomsTotal: rooms.length,
    roomsStarted: list.filter((s) => s.stageNo > 0).length,
    roomsDone: list.filter((s) => s.stageNo === ORDER.length).length,
    progressPct: meanProgress(rooms.map((r) => r.id), states),
    stageCounts,
    avgDaysPerStage,
    etaDays: avgDaysPerStage === null || !rooms.length ? null : Math.ceil(stepsLeft * avgDaysPerStage),
    historyDays: first && last ? Math.floor((+new Date(last) - +new Date(first)) / 86_400_000) : 0,
    needsReview: updates.filter(needsReview).length,
    checking: updates.reduce((n, u) => n + u.photos.filter((p) => p.checking).length, 0),
    openIssues: open.length,
    highIssues: open.filter((i) => i.severity === "high").length,
    suggestedIssues: issues.filter((i) => i.status === "suggested").length,
    updatesCount: updates.length,
    photosCount: updates.reduce((n, u) => n + u.photos.length, 0),
    lastActivityAt: last,
    states,
  };
}
