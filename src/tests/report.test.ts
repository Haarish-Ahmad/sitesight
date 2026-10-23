import { expect, test } from "vitest";
import { buildReport, periodRange } from "../report.js";
import { buildRooms } from "../structure.js";
import { day, issue, photo, upd } from "./helpers.js";

const rooms = buildRooms({ type: "house", levels: [{ floor: 0, rooms: ["Kitchen", "Bathroom"] }], outside: [] });

test("week runs Monday to Monday in local time", () => {
  const { from, to } = periodRange("week", new Date(2026, 0, 8)); // Thu 8 Jan 2026
  expect(from).toEqual(new Date(2026, 0, 5));
  expect(to).toEqual(new Date(2026, 0, 12));
});

test("daily report: what was logged, what advanced, progress before and after", () => {
  const ups = [upd(["r1"], "plumbing", day(0)), upd(["r1", "r2"], "tiling", day(3), { photos: [photo(), photo({ flags: ["x"] })] })];
  const r = buildReport(rooms, ups, [issue({ at: day(3) }), issue({ at: day(1), status: "resolved", resolvedAt: day(3) })], "day", new Date(day(3)));
  expect(r.logged).toHaveLength(1);
  expect(r.advanced).toBe(2);
  expect(r.photos).toHaveLength(2);
  expect(r.review).toHaveLength(1);
  expect(r.progressStart).toBe(28); // (r1 plumbing 55% + r2 0%) / 2 = 27.5
  expect(r.progressEnd).toBe(82);
  expect(r.opened).toHaveLength(1);
  expect(r.resolved).toHaveLength(1);
  expect(r.narrative.join(" ")).toContain("went from 28% to 82%");
});

test("an empty day says so", () => {
  const r = buildReport(rooms, [upd(["r1"], "plumbing", day(0))], [], "day", new Date(day(5)));
  expect(r.narrative[0]).toMatch(/No site updates/);
});
