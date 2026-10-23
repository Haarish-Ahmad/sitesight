// Turns the setup wizard's answers into the list of rooms the project tracks.
// After creation the room list is the truth (rooms can be added and removed); the spec is only the starting point.

export type Room = { id: string; block: string | null; floor: number | null; unit: string | null; name: string; items?: import("./checklist.js").Item[] };
export type NewRoom = Omit<Room, "id" | "items">;

export type HouseSpec = { type: "house"; levels: { floor: number; rooms: string[] }[]; outside: string[] };
// A block can mix layouts, e.g. two 2BHK and two 3BHK flats on every floor.
export type FlatType = { name: string; perFloor: number; rooms: string[] };
export type BlockSpec = {
  floors: number; // including ground
  basement: boolean;
  stilt: boolean; // ground floor is open parking with no flats (common in India)
  flatTypes: FlatType[];
  commonRooms: string[]; // shared spaces on every floor (staircase, corridor)
  outside: string[]; // around this block (exterior, roof)
};
// Each block has its own layout; `site` is for areas that belong to no block (pool, parking, boundary wall).
export type ApartmentSpec = { type: "apartment"; blocks: BlockSpec[]; site: string[] };
export type StructureSpec = HouseSpec | ApartmentSpec;

export const MAX_ROOMS = 5000;
export const ROOM_PRESETS = [
  "Living room", "Kitchen", "Bedroom", "Bathroom", "Toilet", "Dining room", "Balcony", "Utility room", "Study",
  "Hallway", "Staircase", "Corridor", "Lift lobby", "Parking", "Exterior", "Roof", "Terrace", "Garage", "Garden",
];
export const EXTRA_PRESETS = [
  "Swimming pool", "Parking", "Garage", "Driveway", "Garden", "Landscaping", "Boundary wall", "Gate",
  "Clubhouse", "Gym", "Playground", "Water tank", "Septic tank", "Generator room", "Shed", "Terrace",
];

export const blockName = (i: number) => String.fromCharCode(65 + i);
export const nextBlockName = (rooms: Room[]) => {
  const used = new Set(rooms.map((r) => r.block));
  let i = 0;
  while (used.has(blockName(i))) i++;
  return blockName(i);
};

export const floorLabel = (f: number | null) =>
  f === null ? "Outside" : f < 0 ? "Basement" : f === 0 ? "Ground floor" : `Floor ${f}`;

const unitName = (block: string, floor: number, i: number) =>
  `${block}-${floor < 0 ? "B" : floor === 0 ? "G" : floor}${String(i + 1).padStart(2, "0")}`;

// "Bedroom", "Bedroom" -> "Bedroom 1", "Bedroom 2"
export function numbered(names: string[]) {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  const total = new Map<string, number>();
  for (const n of clean) total.set(n, (total.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return clean.map((n) => {
    if (total.get(n)! === 1) return n;
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return `${n} ${k}`;
  });
}

// Counted with arithmetic, not by building: the wizard calls this on every keystroke, and a typo
// like 80 floors x 30 flats must not build a million rooms.
export const flatsPerFloor = (b: BlockSpec) => b.flatTypes.reduce((n, t) => n + t.perFloor, 0);
const flatFloors = (b: BlockSpec) => b.floors - (b.stilt ? 1 : 0);
export const flatCount = (b: BlockSpec) => flatFloors(b) * flatsPerFloor(b);
const parkingLevel = (b: BlockSpec, name: string) => numbered([name, ...b.commonRooms]).length;
export const countBlock = (b: BlockSpec) =>
  flatFloors(b) * (b.flatTypes.reduce((n, t) => n + t.perFloor * numbered(t.rooms).length, 0) + numbered(b.commonRooms).length) +
  (b.stilt ? parkingLevel(b, "Stilt parking") : 0) +
  (b.basement ? parkingLevel(b, "Parking") : 0) +
  numbered(b.outside).length;

export function countRooms(spec: StructureSpec) {
  if (spec.type === "house") return spec.levels.reduce((s, l) => s + numbered(l.rooms).length, 0) + numbered(spec.outside).length;
  return spec.blocks.reduce((s, b) => s + countBlock(b), 0) + numbered(spec.site).length;
}

export function buildBlockRooms(b: BlockSpec, block: string): NewRoom[] {
  const out: NewRoom[] = [];
  const add = (floor: number | null, unit: string | null, name: string) => out.push({ block, floor, unit, name });
  if (b.basement) for (const n of numbered(["Parking", ...b.commonRooms])) add(-1, null, n);
  // flats are numbered along the floor across all types: A-101, A-102 (2BHK), A-103 (3BHK)...
  const layouts = b.flatTypes.flatMap((t) => Array<string[]>(t.perFloor).fill(numbered(t.rooms)));
  for (let f = 0; f < b.floors; f++) {
    if (f === 0 && b.stilt) {
      for (const n of numbered(["Stilt parking", ...b.commonRooms])) add(0, null, n);
      continue;
    }
    layouts.forEach((rooms, u) => rooms.forEach((n) => add(f, unitName(block, f, u), n)));
    for (const n of numbered(b.commonRooms)) add(f, null, n);
  }
  for (const n of numbered(b.outside)) add(null, null, n);
  return out;
}

// Rooms added later continue the id sequence, so ids already used in updates never change meaning.
export function withIds(existing: Room[], fresh: NewRoom[]): Room[] {
  let next = Math.max(0, ...existing.map((r) => Number(r.id.slice(1)) || 0)) + 1;
  return fresh.map((r) => ({ ...r, id: `r${next++}` }));
}

export function buildRooms(spec: StructureSpec): Room[] {
  const fresh: NewRoom[] = [];
  if (spec.type === "house") {
    for (const l of [...spec.levels].sort((a, b) => a.floor - b.floor)) for (const n of numbered(l.rooms)) fresh.push({ block: null, floor: l.floor, unit: null, name: n });
    for (const n of numbered(spec.outside)) fresh.push({ block: null, floor: null, unit: null, name: n });
  } else {
    spec.blocks.forEach((b, i) => fresh.push(...buildBlockRooms(b, blockName(i))));
    for (const n of numbered(spec.site)) fresh.push({ block: null, floor: null, unit: null, name: n });
  }
  return withIds([], fresh);
}

// New rooms in one place: a name already used there gets a number, so labels stay unique.
export function placeRooms(existing: Room[], place: Omit<NewRoom, "name">, names: string[]): NewRoom[] {
  const here = existing.filter((r) => r.block === place.block && r.floor === place.floor && r.unit === place.unit).map((r) => r.name);
  const taken = new Set(here);
  return names.map((raw) => {
    const n = raw.trim();
    let name = n;
    for (let k = 2; taken.has(name); k++) name = `${n} ${k}`;
    taken.add(name);
    return { ...place, name };
  });
}

export const roomLabel = (r: Room) =>
  [r.block && `Block ${r.block}`, floorLabel(r.floor), r.unit && `Flat ${r.unit}`, r.name].filter(Boolean).join(" · ");

// Short description of a set of rooms: what they share, plus how many.
export function scopeLabel(rooms: Room[]) {
  if (rooms.length === 1) return roomLabel(rooms[0]);
  const same = <K extends keyof Room>(k: K) => rooms.every((r) => r[k] === rooms[0][k]);
  const parts = [
    same("block") && rooms[0].block && `Block ${rooms[0].block}`,
    same("floor") && floorLabel(rooms[0].floor),
    same("unit") && rooms[0].unit && `Flat ${rooms[0].unit}`,
    same("name") && `${rooms[0].name}s`,
  ].filter(Boolean);
  return `${parts.length ? parts.join(" · ") : "Whole site"} · ${rooms.length} rooms`;
}

// Described from the rooms that exist, so it stays right after rooms are added or removed.
export function describeRooms(type: StructureSpec["type"], rooms: Room[]) {
  const n = `${rooms.length} room${rooms.length === 1 ? "" : "s"}`;
  if (type === "house") {
    const floors = new Set(rooms.map((r) => r.floor).filter((f) => f !== null)).size;
    return `House · ${floors} floor${floors === 1 ? "" : "s"} · ${n}`;
  }
  const blocks = [...new Set(rooms.map((r) => r.block).filter((b): b is string => !!b))];
  const floors = blocks.map((b) => new Set(rooms.filter((r) => r.block === b && r.floor !== null && r.floor >= 0).map((r) => r.floor)).size);
  const lo = Math.min(...floors), hi = Math.max(...floors);
  const flats = new Set(rooms.map((r) => r.unit).filter(Boolean)).size;
  const floorText = !blocks.length ? "" : lo === hi ? ` · ${hi} floors` : ` · ${lo}–${hi} floors`;
  return `Apartments · ${blocks.length} block${blocks.length === 1 ? "" : "s"}${floorText} · ${flats} flats · ${n}`;
}

export const describeSpec = (spec: StructureSpec) => describeRooms(spec.type, countRooms(spec) <= MAX_ROOMS ? buildRooms(spec) : []);
