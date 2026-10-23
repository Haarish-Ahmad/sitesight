import sharp from "sharp";
import { z } from "zod";
import { generate } from "./ai/ollama.js";
import type { BlockSpec, FlatType, StructureSpec } from "./structure.js";

// Reading a floor plan: the model only transcribes labels (room names, the floor heading each sits under,
// the flat it belongs to, and the floor-count note). Turning that into floors, flats and blocks is plain code,
// because small models are good at reading text and bad at building nested structure.

export const PlanReading = z.object({
  title: z.string().catch(""),
  location: z.string().catch(""),
  building_type: z.enum(["house", "apartment"]).catch("house"),
  floors_note: z.string().catch(""),
  total_floors: z.number().int().min(0).max(80).catch(0),
  rooms: z.array(z.object({ name: z.string(), floor: z.string().catch(""), flat: z.string().catch("") })).max(400).catch([]),
  outside: z.array(z.string()).max(30).catch([]),
});
export type PlanReading = z.infer<typeof PlanReading>;

// Plain text, not JSON: a small local model writes about a third as many tokens, and a reply cut off
// half-way still parses up to where it stopped.
const PROMPT = `This image is an architectural floor plan of a building in India. Copy the text written on it, in this exact format:
TITLE: <project or building name, or blank>
LOCATION: <town, street or plot, or blank>
TYPE: <apartment if it shows flats, BHK, lift or a typical floor; otherwise house>
FLOORS: <any text about the number of floors, e.g. STILT + 4, G+1, 1ST TO 4TH FLOOR, or blank>
[<heading of a drawing or flat, e.g. GROUND FLOOR PLAN, FIRST FLOOR PLAN, FLAT A1, COMMON>]
<every room label under that heading, separated by commas>
[<next heading>]
<rooms>
NOTES: <tanks, compound wall and other items listed outside the rooms, separated by commas>
Write each room label as printed, without sizes. Write a label again if it appears twice. Do not invent anything.`;

// Model input: plans are line drawings with small text, so keep more pixels than for site photos.
async function prepare(image: Buffer) {
  return (await sharp(image, { density: 150 }).flatten({ background: "#fff" }).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).png().toBuffer()).toString("base64");
}

export async function readPlan(image: Buffer): Promise<PlanReading> {
  const model = process.env.OLLAMA_PLAN_MODEL ?? process.env.OLLAMA_MODEL;
  // a small model can loop on long lists: cap it
  return parseReading(await generate([{ role: "user", content: PROMPT, images: [await prepare(image)] }], { model, ctx: 8192, maxTokens: 700 }));
}

// "[FLAT A1]" headings decide whether rooms belong to a floor or a flat.
const FLAT_HEAD = /\b(flat|unit|bhk|apartment|type)\b/i;
const COMMON_HEAD = /\b(common|shared|core|lobby)\b/i;
const SIZE = /\d+\s*['’]\s*\d*\s*["”]?\s*[x×]\s*\d+.*$|\d+(\.\d+)?\s*(m|mm|ft)?\s*[x×]\s*\d+(\.\d+)?\s*(m|mm|ft)?/i;

// what a model writes when a field is missing
const BLANK = /^(blank|none|nil|n\/?a|not (specified|given|mentioned|shown|visible)|unknown|-)\.?$/i;

export function parseReading(text: string): PlanReading {
  const out = { title: "", location: "", building_type: "house" as "house" | "apartment", floors_note: "", total_floors: 0, rooms: [] as PlanReading["rooms"], outside: [] as string[] };
  let head = "";
  for (const raw of text.replace(/\*\*/g, "").split("\n")) {
    const line = raw.replace(/^[\s>*#-]+/, "").trim();
    if (!line) continue;
    const field = line.match(/^(TITLE|LOCATION|TYPE|FLOORS|NOTES)\s*:\s*(.*)$/i);
    if (field) {
      const val = field[2].replace(/^<|>$/g, "").trim().replace(BLANK, "");
      const key = field[1].toUpperCase();
      if (key === "TITLE") out.title = val;
      else if (key === "LOCATION") out.location = val;
      else if (key === "TYPE") out.building_type = /apart|flat/i.test(val) ? "apartment" : "house";
      else if (key === "FLOORS") out.floors_note = val;
      else out.outside.push(...val.split(/[,;]/).map((x) => x.trim()).filter((x) => x && !BLANK.test(x)));
      continue;
    }
    const h = line.match(/^\[(.+)\]$/);
    if (h) {
      head = h[1].trim();
      continue;
    }
    const isFlat = FLAT_HEAD.test(head) && !COMMON_HEAD.test(head);
    for (const name of line.split(/[,;]/).map((x) => x.replace(SIZE, "").replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean)) {
      if (out.rooms.length >= 400) break;
      out.rooms.push({ name, floor: isFlat ? "" : head, flat: isFlat ? head : "" });
    }
  }
  if (out.rooms.some((r) => r.flat)) out.building_type = "apartment";
  return PlanReading.parse(out);
}

// ---------- reading -> project draft (pure, tested)

// "BED ROOM 1" -> "Bedroom", "M.BED ROOM" -> "Master bedroom", "TOILET-2" -> "Toilet"
export function cleanName(raw: string) {
  let s = raw.replace(/\s+/g, " ").trim().toLowerCase();
  s = s.replace(/\bbed\s*room\b/g, "bedroom").replace(/^m\.?\s*bedroom/, "master bedroom").replace(/\bw\.?c\.?$/, "toilet").replace(/\bd\.?\s*&\s*d\b/, "dining");
  s = s.replace(/[\s.-]*\(?\d+\)?$/, "").replace(/[^a-z0-9/&' -]/g, "").trim();
  return s ? s[0].toUpperCase() + s.slice(1, 40) : "";
}

const ORDINAL: [RegExp, number][] = [
  [/basement|cellar/, -1], [/ground|\bg\.?f\b|stilt/, 0], [/first|\b1st\b|\bf\.?f\b/, 1], [/second|\b2nd\b|\bs\.?f\b/, 2],
  [/third|\b3rd\b/, 3], [/fourth|\b4th\b/, 4], [/fifth|\b5th\b/, 5],
];
export function floorOf(label: string) {
  const t = label.toLowerCase();
  if (!t.trim()) return 0;
  for (const [re, n] of ORDINAL) if (re.test(t)) return n;
  const n = t.match(/(\d+)/);
  return n ? Math.min(100, Number(n[1])) : 0;
}

// "STILT + 4" -> 5 floors with a stilt; "G+1" -> 2 floors; "1ST TO 4TH FLOOR" -> 5 (ground + 4)
export function floorsFromNote(note: string, fallback: number): { floors: number; stilt: boolean } {
  const t = note.toLowerCase();
  const stilt = /stilt/.test(t);
  const plus = t.match(/(?:stilt|g|ground)\s*\+\s*(\d+)/);
  if (plus) return { floors: Number(plus[1]) + 1, stilt };
  const range = t.match(/(\d+)(?:st|nd|rd|th)?\s*(?:to|-)\s*(\d+)(?:st|nd|rd|th)?/);
  if (range) return { floors: Number(range[2]) + 1, stilt };
  return { floors: Math.max(1, fallback), stilt };
}

const SHARED = /^(lift|staircase|stair|lobby|corridor|passage|common|duct|shaft|electrical|meter)/i;
const PARKING = /parking|stilt/i;
const bhk = (rooms: string[]) => {
  const beds = rooms.filter((r) => /bedroom/i.test(r)).length;
  return beds ? `${beds}BHK` : "";
};

function blockFrom(r: PlanReading): { block: BlockSpec; notes: string[] } {
  const notes: string[] = [];
  const { floors, stilt } = floorsFromNote(r.floors_note, r.total_floors);
  const flats = new Map<string, string[]>();
  const common: string[] = [];
  let parking = false;
  for (const room of r.rooms) {
    const name = cleanName(room.name);
    if (!name) continue;
    if (PARKING.test(name)) parking = true;
    else if (room.flat.trim() && !SHARED.test(name)) flats.set(room.flat.trim().toUpperCase(), [...(flats.get(room.flat.trim().toUpperCase()) ?? []), name]);
    else if (!common.includes(name)) common.push(name);
  }
  // flats with the same rooms are one type; with no flat labels, everything not shared is one flat
  if (!flats.size && common.length) {
    const own = common.filter((n) => !SHARED.test(n));
    if (own.length) flats.set("FLAT", own);
    common.splice(0, common.length, ...common.filter((n) => SHARED.test(n)));
    notes.push("No flat labels were found, so the rooms were treated as one flat per floor. Check the number of flats.");
  }
  const types = new Map<string, FlatType>();
  for (const rooms of flats.values()) {
    const key = [...rooms].sort().join("|");
    const t = types.get(key);
    if (t) t.perFloor++;
    else types.set(key, { name: "", perFloor: 1, rooms });
  }
  const flatTypes = [...types.values()].map((t, i) => ({ ...t, name: bhk(t.rooms) || `Type ${i + 1}` }));
  if (!r.floors_note && !r.total_floors) notes.push("The number of floors was not written on the plan. Set it below.");
  return {
    block: { floors: Math.min(80, floors), basement: false, stilt: stilt || (parking && floors > 1), flatTypes: flatTypes.slice(0, 6), commonRooms: common.slice(0, 10), outside: ["Exterior", "Terrace"] },
    notes,
  };
}

export type PlanDraft = { name: string; location: string; spec: StructureSpec; notes: string[] };

export function draftFromReadings(readings: PlanReading[]): PlanDraft {
  const name = readings.map((r) => r.title.trim()).find(Boolean)?.slice(0, 80) ?? "";
  const location = readings.map((r) => r.location.trim()).find(Boolean)?.slice(0, 120) ?? "";
  const outside = [...new Set(readings.flatMap((r) => r.outside.map(cleanName)).filter(Boolean))].slice(0, 20);
  const apartment = readings.filter((r) => r.building_type === "apartment").length > readings.length / 2;

  if (apartment) {
    // one sheet per block, as builders draw them
    const built = readings.map(blockFrom);
    const blocks = built.map((b) => b.block).filter((b) => b.flatTypes.length);
    const notes = [...new Set(built.flatMap((b) => b.notes))];
    if (!blocks.length) return { name, location, spec: { type: "apartment", blocks: [], site: outside }, notes: ["No flats could be read from the plan. Enter the blocks by hand."] };
    return { name, location, spec: { type: "apartment", blocks, site: outside }, notes };
  }

  const levels = new Map<number, string[]>();
  const out: string[] = [...outside];
  for (const room of readings.flatMap((r) => r.rooms)) {
    const n = cleanName(room.name);
    if (!n) continue;
    if (/terrace|roof/i.test(room.floor) && !/terrace|roof/i.test(n)) out.push(n);
    else if (/^(open )?terrace$|^roof$/i.test(n) && !room.floor.trim()) out.push(n);
    else {
      const f = Math.max(-1, floorOf(room.floor));
      levels.set(f, [...(levels.get(f) ?? []), n]);
    }
  }
  const notes = levels.size ? [] : ["No rooms could be read from the plan. Enter them by hand."];
  return {
    name,
    location,
    spec: {
      type: "house",
      levels: [...levels].sort((a, b) => a[0] - b[0]).map(([floor, rooms]) => ({ floor, rooms: rooms.slice(0, 30) })),
      outside: [...new Set(["Exterior", ...out])].slice(0, 20),
    },
    notes,
  };
}
