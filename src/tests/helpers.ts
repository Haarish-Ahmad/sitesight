import type { Stage } from "../stages.js";
import type { Issue, Photo, Update } from "../types.js";

export const day = (n: number, h = 12) => new Date(2026, 0, 1 + n, h).toISOString();
export const photo = (p: Partial<Photo> = {}): Photo => ({ file: "1-1.jpg", hash: "h", takenAt: null, gps: null, flags: [], checking: false, ai: null, aiError: false, ...p });
let n = 0;
export const upd = (roomIds: string[], stage: Stage, at: string, u: Partial<Update> = {}): Update => ({
  id: ++n, at, roomIds, scopeLabel: roomIds.join(","), stage, note: "", photos: [], review: null, reviewedAt: null, ...u,
});
export const issue = (i: Partial<Issue> = {}): Issue => ({
  id: ++n, at: day(0), roomIds: ["r1"], scopeLabel: "r1", title: "Crack", note: "", severity: "medium", status: "open", source: "manager", updateId: null, photo: null, resolvedAt: null, ...i,
});
