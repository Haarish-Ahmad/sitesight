import { expect, test } from "vitest";
import { cleanName, draftFromReadings, floorOf, floorsFromNote, PlanReading } from "../plan.js";
import { buildRooms, countRooms } from "../structure.js";

const reading = (r: Partial<PlanReading>) => PlanReading.parse({ title: "", location: "", building_type: "house", floors_note: "", total_floors: 0, rooms: [], outside: [], ...r });

test("room labels become plain names; numbers are dropped so rooms renumber themselves", () => {
  expect(["BED ROOM 1", "M.BED ROOM", "TOILET-2", "LIVING / DINING", "KITCHEN", "W.C.", "  "].map(cleanName)).toEqual(["Bedroom", "Master bedroom", "Toilet", "Living / dining", "Kitchen", "Toilet", ""]);
});

test("floor headings and floor-count notes", () => {
  expect(["GROUND FLOOR PLAN", "FIRST FLOOR PLAN", "2ND FLOOR", "BASEMENT", "", "STILT FLOOR"].map(floorOf)).toEqual([0, 1, 2, -1, 0, 0]);
  expect(floorsFromNote("NO. OF FLOORS: STILT + 4", 0)).toEqual({ floors: 5, stilt: true });
  expect(floorsFromNote("G+1", 0)).toEqual({ floors: 2, stilt: false });
  expect(floorsFromNote("TYPICAL FLOOR PLAN (1ST TO 4TH FLOOR)", 0)).toEqual({ floors: 5, stilt: false });
  expect(floorsFromNote("", 3)).toEqual({ floors: 3, stilt: false });
});

test("house: rooms grouped by the floor heading they sit under", () => {
  const d = draftFromReadings([
    reading({
      title: "PROPOSED RESIDENCE", location: "Coimbatore", outside: ["OVERHEAD TANK"],
      rooms: [
        { name: "LIVING", floor: "GROUND FLOOR PLAN", flat: "" }, { name: "KITCHEN", floor: "GROUND FLOOR PLAN", flat: "" },
        { name: "BED ROOM", floor: "FIRST FLOOR PLAN", flat: "" }, { name: "BED ROOM", floor: "FIRST FLOOR PLAN", flat: "" },
      ],
    }),
  ]);
  expect(d.name).toBe("PROPOSED RESIDENCE");
  expect(d.spec).toEqual({ type: "house", levels: [{ floor: 0, rooms: ["Living", "Kitchen"] }, { floor: 1, rooms: ["Bedroom", "Bedroom"] }], outside: ["Exterior", "Overhead tank"] });
  expect(buildRooms(d.spec).map((r) => r.name)).toContain("Bedroom 2");
});

test("apartment: identical flats merge into one type; shared rooms and parking are recognised", () => {
  const flat2 = (f: string) => ["LIVING / DINING", "KITCHEN", "BED ROOM 1", "BED ROOM 2", "TOILET 1", "TOILET 2"].map((name) => ({ name, floor: "", flat: f }));
  const flat3 = (f: string) => [...flat2(f), { name: "BED ROOM 3", floor: "", flat: f }];
  const d = draftFromReadings([
    reading({
      building_type: "apartment", floors_note: "STILT + 4",
      rooms: [...flat2("FLAT A1"), ...flat3("FLAT A2"), { name: "LIFT", floor: "", flat: "" }, { name: "STAIRCASE", floor: "", flat: "" }, { name: "CAR PARKING", floor: "", flat: "" }, ...flat3("FLAT A3"), ...flat2("FLAT A4")],
    }),
  ]);
  expect(d.spec.type).toBe("apartment");
  if (d.spec.type !== "apartment") return;
  const [b] = d.spec.blocks;
  expect(b.floors).toBe(5);
  expect(b.stilt).toBe(true);
  expect(b.flatTypes.map((t) => [t.name, t.perFloor])).toEqual([["2BHK", 2], ["3BHK", 2]]);
  expect(b.commonRooms).toEqual(["Lift", "Staircase"]);
  // 4 flat floors x (2x6 + 2x7 + 2 shared) + stilt (parking + 2 shared) + 2 outside
  expect(countRooms(d.spec)).toBe(4 * 28 + 3 + 2);
});

test("apartment with no flat labels: treated as one flat per floor, with a note to check", () => {
  const d = draftFromReadings([reading({ building_type: "apartment", total_floors: 3, rooms: [{ name: "KITCHEN", floor: "", flat: "" }, { name: "LIFT", floor: "", flat: "" }] })]);
  expect(d.spec.type === "apartment" && d.spec.blocks[0].flatTypes).toEqual([{ name: "Type 1", perFloor: 1, rooms: ["Kitchen"] }]);
  expect(d.notes[0]).toMatch(/No flat labels/);
});

test("the model's text reply parses into rooms by floor or flat, and a cut-off reply keeps what it has", async () => {
  const { parseReading } = await import("../plan.js");
  const r = parseReading(`TITLE: SRI VINAYAGA APARTMENTS
LOCATION: Coimbatore
TYPE: apartment
FLOORS: STILT + 4
[FLAT A1 (2BHK)]
LIVING / DINING 14'0" X 12'0", KITCHEN, BED ROOM 1, TOILET 1
[COMMON]
LIFT, STAIRCASE
NOTES: OVERHEAD TANK, SOLAR
[FLAT A2]
KITCHEN, BED`);
  expect(r).toMatchObject({ title: "SRI VINAYAGA APARTMENTS", building_type: "apartment", floors_note: "STILT + 4", outside: ["OVERHEAD TANK", "SOLAR"] });
  expect(r.rooms.map((x) => `${x.flat || x.floor}:${x.name}`)).toEqual([
    "FLAT A1 (2BHK):LIVING / DINING", "FLAT A1 (2BHK):KITCHEN", "FLAT A1 (2BHK):BED ROOM 1", "FLAT A1 (2BHK):TOILET 1",
    "COMMON:LIFT", "COMMON:STAIRCASE", "FLAT A2:KITCHEN", "FLAT A2:BED",
  ]);
  const house = parseReading("LOCATION: Not specified\nTYPE: house\n**[GROUND FLOOR PLAN]**\n1. LIVING\n2. KITCHEN\n[FIRST FLOOR PLAN]\nBED ROOM, TOILET\nNOTES: blank");
  expect(house.rooms.map((x) => `${x.floor}:${x.name}`)).toEqual(["GROUND FLOOR PLAN:LIVING", "GROUND FLOOR PLAN:KITCHEN", "FIRST FLOOR PLAN:BED ROOM", "FIRST FLOOR PLAN:TOILET"]);
  expect([house.outside, house.location]).toEqual([[], ""]);
});
