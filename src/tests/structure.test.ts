import { expect, test } from "vitest";
import { buildRooms, countRooms, describeRooms, numbered, placeRooms, roomLabel, scopeLabel, withIds, type ApartmentSpec, type BlockSpec } from "../structure.js";

const block = (b: Partial<BlockSpec> & { flatsPerFloor?: number; flatRooms?: string[] } = {}): BlockSpec => {
  const { flatsPerFloor = 2, flatRooms = ["Kitchen", "Bedroom", "Bedroom"], ...rest } = b;
  return { floors: 3, basement: false, stilt: false, flatTypes: [{ name: "Flat", perFloor: flatsPerFloor, rooms: flatRooms }], commonRooms: ["Staircase"], outside: ["Roof"], ...rest };
};

test("numbered disambiguates repeated names only", () => {
  expect(numbered(["Bedroom", "Kitchen", "Bedroom", " "])).toEqual(["Bedroom 1", "Kitchen", "Bedroom 2"]);
});

test("house: one room per name per level, plus outside and extra areas", () => {
  const rooms = buildRooms({ type: "house", levels: [{ floor: 1, rooms: ["Bedroom"] }, { floor: 0, rooms: ["Kitchen", "Living room"] }], outside: ["Exterior", "Swimming pool"] });
  expect(rooms.map(roomLabel)).toEqual(["Ground floor · Kitchen", "Ground floor · Living room", "Floor 1 · Bedroom", "Outside · Exterior", "Outside · Swimming pool"]);
});

test("apartments: every block has its own layout, plus site-wide areas; count matches build", () => {
  const spec: ApartmentSpec = { type: "apartment", blocks: [block({ basement: true }), block({ floors: 5, flatsPerFloor: 1, flatRooms: ["Studio", "Bathroom"] })], site: ["Swimming pool", "Parking"] };
  const rooms = buildRooms(spec);
  // A: basement 2 + 3 x (2x3 + 1) 21 + roof 1 = 24;  B: 5 x (1x2 + 1) 15 + roof 1 = 16;  site 2
  expect(rooms).toHaveLength(42);
  expect(countRooms(spec)).toBe(42);
  expect(new Set(rooms.map((r) => r.id)).size).toBe(42);
  expect(rooms.find((r) => r.unit === "A-201" && r.name === "Bedroom 2")).toBeTruthy();
  expect(rooms.filter((r) => r.block === "B" && r.unit).map((r) => r.name)).toContain("Studio");
  expect(rooms.filter((r) => r.block === null).map((r) => r.name)).toEqual(["Swimming pool", "Parking"]);
  expect(describeRooms("apartment", rooms)).toBe("Apartments · 2 blocks · 3–5 floors · 11 flats · 42 rooms");
});

test("rooms added later get new ids and unique names in their place", () => {
  const rooms = buildRooms({ type: "house", levels: [{ floor: 0, rooms: ["Kitchen"] }], outside: [] });
  const fresh = withIds(rooms, placeRooms(rooms, { block: null, floor: 0, unit: null }, ["Kitchen", "Pantry"]));
  expect(fresh).toEqual([
    { id: "r2", block: null, floor: 0, unit: null, name: "Kitchen 2" },
    { id: "r3", block: null, floor: 0, unit: null, name: "Pantry" },
  ]);
  // ids continue after the highest, even when some rooms were removed
  expect(withIds([{ ...rooms[0], id: "r9" }], [{ block: null, floor: 0, unit: null, name: "X" }])[0].id).toBe("r10");
});

test("scopeLabel names what a set of rooms shares", () => {
  const rooms = buildRooms({ type: "apartment", blocks: [block({ floors: 2, flatRooms: ["Kitchen", "Bathroom"], commonRooms: [], outside: [] })], site: [] });
  expect(scopeLabel(rooms.filter((r) => r.unit === "A-101"))).toBe("Block A · Floor 1 · Flat A-101 · 2 rooms");
  expect(scopeLabel(rooms.filter((r) => r.name === "Kitchen" && r.floor === 1))).toBe("Block A · Floor 1 · Kitchens · 2 rooms");
  expect(scopeLabel(rooms.slice(0, 1))).toBe("Block A · Ground floor · Flat A-G01 · Kitchen");
});

test("mixed flat types and a stilt floor: parking on the ground, flats numbered across types", () => {
  const b = block({ floors: 3, stilt: true, commonRooms: ["Lift"], outside: [], flatTypes: [{ name: "2BHK", perFloor: 1, rooms: ["Bedroom", "Bedroom"] }, { name: "3BHK", perFloor: 1, rooms: ["Bedroom", "Bedroom", "Bedroom"] }] });
  const rooms = buildRooms({ type: "apartment", blocks: [b], site: [] });
  // ground: stilt parking + lift = 2; floors 1-2: (2 + 3) flat rooms + lift = 6 each
  expect(rooms).toHaveLength(14);
  expect(countRooms({ type: "apartment", blocks: [b], site: [] })).toBe(14);
  expect(rooms.filter((r) => r.floor === 0).map((r) => r.name)).toEqual(["Stilt parking", "Lift"]);
  expect(rooms.filter((r) => r.unit === "A-102").map((r) => r.name)).toEqual(["Bedroom 1", "Bedroom 2", "Bedroom 3"]);
  expect(describeRooms("apartment", rooms)).toBe("Apartments · 1 block · 3 floors · 4 flats · 14 rooms");
});
