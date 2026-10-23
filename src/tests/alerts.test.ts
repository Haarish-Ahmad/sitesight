import { expect, test } from "vitest";
import { areasOf, progressAlerts } from "../alerts.js";
import { buildRooms } from "../structure.js";
import { summarise } from "../summary.js";
import { photo, upd } from "./helpers.js";

const now = new Date(2026, 1, 1, 12);
const ago = (d: number) => new Date(+now - d * 86_400_000).toISOString();
// one block, 2 floors x 2 flats, 3 rooms per flat, no shared spaces -> 4 flats
const rooms = buildRooms({ type: "apartment", blocks: [{ floors: 2, basement: false, stilt: false, flatTypes: [{ name: "Flat", perFloor: 2, rooms: ["Kitchen", "Bathroom", "Bedroom"] }], commonRooms: [], outside: [] }], site: [] });
const flat = (unit: string) => rooms.filter((r) => r.unit === unit).map((r) => r.id);
const room = (unit: string, name: string) => rooms.find((r) => r.unit === unit && r.name === name)!.id;
const run = (ups: ReturnType<typeof upd>[]) => progressAlerts(rooms, summarise(rooms, ups), ups, now);

test("areas are flats in apartments", () => {
  expect(areasOf(rooms).map((a) => a.rooms.length)).toEqual([3, 3, 3, 3]);
});

test("one room far ahead of the rest of its flat is a high alert; 1-3 stages apart is normal", () => {
  expect(run([upd(flat("A-G01"), "plastering", ago(2)), upd([room("A-G01", "Bathroom")], "electrical", ago(1))]).alerts).toEqual([]);
  const a = run([upd([room("A-G01", "Bathroom")], "flooring", ago(1))]).alerts;
  expect(a).toHaveLength(1);
  expect(a[0]).toMatchObject({ kind: "uneven", severity: "high", label: "Flat A-G01" });
  expect(a[0].detail).toBe("Bathroom is at flooring, but Kitchen and Bedroom are not started");
});

test("rooms not started are one calm summary, not an alert each", () => {
  const r = run([upd(flat("A-G01"), "plumbing", ago(1))]);
  expect(r.alerts).toEqual([]);
  expect(r.notStarted).toMatchObject({ count: 3, total: 4, noun: "flat" });
});

test("no second alert when Review already shows the claim; and none while the AI is still checking", () => {
  const flagged = upd([room("A-G01", "Bathroom")], "flooring", ago(1), { photos: [photo({ flags: ["Flooring was reported, but the photo shows open framing"] })] });
  const r = run([flagged]);
  expect(r.alerts).toEqual([]);
  expect(r.reviewNotes[flagged.id]).toMatch(/far ahead of the rest of the flat/);
  const checking = upd([room("A-G01", "Bathroom")], "flooring", ago(1), { photos: [photo({ checking: true })] });
  expect(run([checking]).alerts).toEqual([]);
});

test("a started flat with no progress for weeks while others move is stalled", () => {
  const a = run([upd(flat("A-G01"), "plumbing", ago(30)), upd([...flat("A-G02"), ...flat("A-101"), ...flat("A-102")], "plumbing", ago(1))]).alerts;
  expect(a[0]).toMatchObject({ kind: "stalled", label: "Block A · Ground floor · Flat A-G01 · 3 rooms" });
  expect(a[0].detail).toMatch(/30 days/);
});

test("a started flat far behind the others is flagged", () => {
  const a = run([upd([...flat("A-G02"), ...flat("A-101"), ...flat("A-102")], "tiling", ago(1)), upd(flat("A-G01"), "brickwork", ago(1))]).alerts;
  expect(a).toEqual([expect.objectContaining({ kind: "behind", label: "Block A · Ground floor · Flat A-G01 · 3 rooms" })]);
});

test("a whole quiet site is one alert, not one per flat", () => {
  expect(run([upd(rooms.map((r) => r.id), "plumbing", ago(20))]).alerts).toEqual([expect.objectContaining({ kind: "site_idle" })]);
});

test("houses: rooms on one floor far apart are uneven", () => {
  const house = buildRooms({ type: "house", levels: [{ floor: 0, rooms: ["Kitchen", "Living room"] }], outside: ["Garden"] });
  const ups = [upd([house[0].id], "painting", ago(1))];
  const a = progressAlerts(house, summarise(house, ups), ups, now).alerts;
  expect(a[0]).toMatchObject({ kind: "uneven", label: "Ground floor" });
});
