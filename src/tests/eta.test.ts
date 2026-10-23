import { afterEach, expect, test, vi } from "vitest";
import { askEta } from "../eta.js";
import { enoughHistory, planEstimate, typicalCrew } from "../finish.js";
import { buildRooms } from "../structure.js";
import { summarise } from "../summary.js";
import { day, upd } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());
const rooms = buildRooms({ type: "house", levels: [{ floor: 0, rooms: ["Bathroom", "Hall"] }], outside: [] });
const site = summarise(rooms, [upd(["r1"], "tiling", day(0))]);
// eight days of real progress: bathroom brickwork -> plastering
const history = summarise(rooms, [upd(["r1"], "brickwork", day(0)), upd(["r1"], "plastering", day(8))]);
const reply = (etaDays: number) => vi.fn(async (_url: string, _init: { body: string }) => new Response(JSON.stringify({ message: { content: JSON.stringify({ etaDays, confidence: "medium", reason: "Hall has not started." }) } })));

test("plan: groundwork + frame and walls per floor + finishing work shared by teams", () => {
  // shell: hall not started -> groundwork 21 + floor 30 = 51, x1.5 for a gang under 6 = 77; finishing: bathroom 5 + hall 18 = 23, one team
  expect(planEstimate(rooms, site, { workers: 4, daysPerWeek: 7 })).toMatchObject({ shellDays: 77, finishDays: 23, teams: 1, days: 100 });
  expect(planEstimate(rooms, site, { workers: 4, daysPerWeek: 6 }).days).toBe(117); // calendar days
});

test("plan: a bigger building takes longer, and gets a bigger assumed crew", () => {
  const big = buildRooms({ type: "house", levels: [0, 1, 2].map((floor) => ({ floor, rooms: ["Hall", "Kitchen", "Bedroom", "Bathroom"] })), outside: [] });
  expect(typicalCrew(rooms).workers).toBe(6);
  expect(typicalCrew(big).workers).toBe(10);
  expect(planEstimate(big, summarise(big, []), typicalCrew(big)).days).toBeGreaterThan(planEstimate(rooms, summarise(rooms, []), typicalCrew(rooms)).days);
});

test("too little history: no estimate, no model call", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  expect(enoughHistory(site)).toBe(false);
  await expect(askEta(rooms, site)).rejects.toThrow(/history/);
  expect(f).not.toHaveBeenCalled();
  expect(enoughHistory(history)).toBe(true);
});

test("the AI's answer is kept near pace and plan, with low confidence under two weeks of history", async () => {
  // plan 97 days (6 workers, 6-day week), pace 88 (8 days a step, hall has 11 steps) -> anchor 93, band 65-140
  vi.stubGlobal("fetch", reply(100));
  expect(await askEta(rooms, history)).toMatchObject({ etaDays: 100, confidence: "low", ai: true, adjusted: false, baselineDays: 97 });
  vi.stubGlobal("fetch", reply(10));
  expect(await askEta(rooms, history)).toMatchObject({ etaDays: 65, adjusted: true });
  vi.stubGlobal("fetch", reply(900));
  expect(await askEta(rooms, history)).toMatchObject({ etaDays: 140, adjusted: true });
});

test("no AI answer: the computed number, marked low confidence", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
  expect(await askEta(rooms, history)).toMatchObject({ etaDays: 93, confidence: "low", ai: false });
});

test("no model call when every room is finished", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const done = summarise(rooms, [upd(["r1", "r2"], "finishing", day(0), { review: "approved" })]);
  expect(await askEta(rooms, done)).toMatchObject({ etaDays: 0 });
  expect(f).not.toHaveBeenCalled();
});
