import { expect, test } from "vitest";
import { roomStates, statusOf, summarise } from "../summary.js";
import { buildRooms } from "../structure.js";
import { day, issue, photo, upd } from "./helpers.js";

const rooms = buildRooms({ type: "house", levels: [{ floor: 0, rooms: ["Kitchen", "Bathroom", "Hall", "Porch"] }], outside: [] }); // r1..r4

test("progress averages ALL rooms; not-started rooms count as 0", () => {
  const s = summarise(rooms, [upd(["r2"], "plumbing", day(0))]);
  expect(s.roomsStarted).toBe(1);
  expect(s.progressPct).toBe(14); // plumbing = 6/11 = 55% in one room of four
  expect(s.stageCounts).toMatchObject({ not_started: 3, plumbing: 1 });
});

test("one update can cover many rooms; pace comes from forward moves over real days", () => {
  const s = summarise(rooms, [upd(["r1", "r2"], "plumbing", day(0)), upd(["r1", "r2"], "tiling", day(6))]);
  expect(s.states.r1.stage).toBe("tiling");
  expect(s.avgDaysPerStage).toBeCloseTo(2); // 3 steps in 6 days, per room
  expect(s.etaDays).toBe(22); // slowest rooms (r3, r4) have 11 stages x 2 days
});

test("updates minutes apart are not a real pace", () => {
  const t = new Date(2026, 0, 1).toISOString();
  const s = summarise(rooms, [upd(["r1"], "plumbing", t), upd(["r1"], "tiling", new Date(Date.parse(t) + 60_000).toISOString())]);
  expect(s.avgDaysPerStage).toBeNull();
  expect(s.etaDays).toBeNull();
});

test("finishing counts only once approved; rejected claims never count", () => {
  const paint = upd(["r1"], "painting", day(0));
  const fin = upd(["r1"], "finishing", day(2), { photos: [photo()] });
  expect(roomStates(rooms, [paint, fin]).states.r1).toMatchObject({ stage: "painting", pendingFinish: fin.id });
  expect(roomStates(rooms, [paint, { ...fin, review: "approved" }]).states.r1).toMatchObject({ stage: "finishing", pendingFinish: null });
  expect(roomStates(rooms, [paint, { ...fin, review: "rejected" }]).states.r1).toMatchObject({ stage: "painting", pendingFinish: null });
  expect(roomStates(rooms, [{ ...paint, review: "rejected" }]).states.r1.stage).toBeNull();
});

test("status and review counts", () => {
  const flagged = upd(["r1"], "tiling", day(0), { photos: [photo({ flags: ["looks like structure"] })] });
  const checking = upd(["r2"], "tiling", day(0), { photos: [photo({ checking: true })] });
  const plain = upd(["r3"], "tiling", day(0));
  expect([flagged, checking, plain].map(statusOf)).toEqual(["needs_review", "checking", "no_photo"]);
  expect(statusOf({ ...flagged, review: "approved" })).toBe("approved");
  const s = summarise(rooms, [flagged, checking, plain], [issue({ severity: "high" }), issue({ status: "suggested" })]);
  expect(s).toMatchObject({ needsReview: 1, checking: 1, openIssues: 1, highIssues: 1, suggestedIssues: 1 });
});

test("ticked checklist items move a room's progress; past views ignore them", () => {
  const withItems = rooms.map((r) => (r.id === "r2" ? { ...r, items: [{ name: "Flooring", doneAt: day(0) }, { name: "Door", doneAt: null }] } : r));
  const ups = [upd(["r2"], "plumbing", day(0))];
  // r2: stage 55% and half its items = 52.5%; the other three rooms 0 -> 13%
  expect(summarise(withItems, ups).progressPct).toBe(13);
  expect(summarise(rooms, ups).progressPct).toBe(14);
  expect(roomStates(withItems, ups, new Date(day(1))).states.r2.itemsPct).toBeNull();
});
