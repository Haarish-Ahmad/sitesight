import type { NewRoom, Room } from "./structure.js";

// "Required things" in each room: fittings a room needs before handover. Starts from Indian residential norms
// by room type; the manager edits the list per type in the wizard and per room later.
export type Item = { name: string; doneAt: string | null };

const RULES: [RegExp, string[]][] = [
  [/toilet|bath|wc|powder/, ["Floor tiles (anti-skid)", "Wall tiles", "EWC / Indian WC", "Wash basin", "Taps and shower", "Geyser point", "Exhaust fan", "Door"]],
  [/kitchen|pantry/, ["Granite platform", "Sink with tap", "Wall dado tiles", "Floor tiles", "Chimney / exhaust point", "Water purifier point", "Power sockets"]],
  [/pooja|puja|prayer/, ["Flooring", "Granite shelf", "Light point", "Door"]],
  [/bed|guest/, ["Flooring", "Skirting", "Fan point", "Light points", "AC point", "Wardrobe / loft", "Door", "Windows"]],
  [/living|hall|dining|lounge|family|drawing|study/, ["Flooring", "Skirting", "Fan points", "Light points", "TV / data point", "Windows"]],
  [/utility|wash|laundry/, ["Floor tiles", "Washing machine point", "Taps", "Drain outlet"]],
  [/balcony|sit out|sitout|verandah|veranda|portico/, ["Floor tiles", "Railing", "Drain outlet", "Light point"]],
  [/stair/, ["Step finish (granite)", "Handrail", "Light points"]],
  [/lift/, ["Lift car installed", "Lift door frames", "Lift machine room"]],
  [/lobby|corridor|passage|foyer/, ["Flooring", "Light points"]],
  [/parking|garage|stilt|car/, ["Floor finish", "Light points", "Gate / shutter"]],
  [/terrace|roof/, ["Waterproofing", "Parapet wall", "Rainwater outlets", "Overhead tank"]],
  [/exterior|elevation|outside/, ["External plaster", "External paint", "Rainwater pipes"]],
  [/store/, ["Flooring", "Shelves", "Light point", "Door"]],
  [/garden|landscap/, ["Soil and planting", "Garden tap", "Lights"]],
  [/compound|boundary|gate/, ["Compound wall", "Main gate"]],
  [/sump|septic|tank/, ["Waterproofing", "Cover slab", "Pipe connections"]],
  [/electrical|generator|meter/, ["Panel / meter board", "Earthing"]],
];

// "Bedroom 2" and "Bedroom" share a checklist; the trailing number only tells rooms apart.
export const roomType = (name: string) => name.trim().toLowerCase().replace(/\s+\d+$/, "");

export function defaultItems(name: string): string[] {
  const t = roomType(name).replace(/[^a-z ]/g, " ");
  return RULES.find(([re]) => re.test(t))?.[1] ?? [];
}

// Attach checklists to new rooms: the manager's list for the room type if given, else the default.
export function withItems<R extends NewRoom | Room>(rooms: R[], lists: Record<string, string[]> = {}): (R & { items: Item[] })[] {
  return rooms.map((r) => ({ ...r, items: (lists[roomType(r.name)] ?? defaultItems(r.name)).map((name) => ({ name, doneAt: null })) }));
}

export const itemsLeft = (r: Room) => (r.items ?? []).filter((i) => !i.doneAt);
