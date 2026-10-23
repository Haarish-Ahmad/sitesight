import { ORDER, type Stage } from "./stages.js";
import type { Room } from "./structure.js";
import type { Summary } from "./summary.js";
import type { Crew } from "./types.js";

// Pure, no AI: the web app imports it too.

// An estimate needs real progress over time; before that the app says "need more" instead of guessing.
export const MIN_HISTORY_DAYS = 7;
export const enoughHistory = (s: Pick<Summary, "etaDays" | "historyDays">) => s.etaDays !== null && s.historyDays >= MIN_HISTORY_DAYS;

// Nobody is asked for a head count: assume the crew a site this size usually has
// (about 6-10 for a 2-floor house, 25-35 for a 4-floor block of 12 flats), 6 days a week.
export const typicalCrew = (rooms: Room[]): Crew => ({ workers: Math.min(80, Math.max(6, 4 + Math.ceil(rooms.length / 2))), daysPerWeek: 6 });
// Working days for one gang, from typical Indian residential sites. A starting point the AI may adjust, not data about this site.
// Groundwork happens once per block; frame and walls once per floor, one floor after another;
// the finishing trades are per room and shared out between teams of about four people.
const BLOCK_DAYS: Partial<Record<Stage, number>> = { excavation: 7, foundation: 14 };
const FLOOR_DAYS: Partial<Record<Stage, number>> = { structure: 18, brickwork: 12 };
const ROOM_DAYS: Partial<Record<Stage, number>> = { plastering: 4, plumbing: 2, electrical: 2, flooring: 2, tiling: 3, painting: 3, finishing: 2 };
const TEAM = 4;

// days of the given stages still ahead for something whose least-advanced room is at stageNo (0 = not started)
const ahead = (table: Partial<Record<Stage, number>>, stageNo: number) =>
  Object.entries(table).reduce((d, [st, n]) => d + (stageNo <= ORDER.indexOf(st as Stage) ? n! : 0), 0);

// ponytail: frame of floor n+1 and walls of floor n overlap on real sites; ignored, so this leans long. The AI may pull it in.
export function planEstimate(rooms: Room[], s: Summary, crew: Crew) {
  const no = (r: Room) => s.states[r.id]?.stageNo ?? 0;
  const teams = Math.max(1, Math.floor(crew.workers / TEAM));
  const small = crew.workers < 6 ? 1.5 : 1; // a gang of 2-5 pours slabs and lays brick more slowly
  const blocks = new Map<string, Room[]>();
  for (const r of rooms) if (r.floor !== null) blocks.set(r.block ?? "", [...(blocks.get(r.block ?? "") ?? []), r]);
  const shells = [...blocks.values()].map((rs) => {
    const floors = [...new Set(rs.map((r) => r.floor))];
    return ahead(BLOCK_DAYS, Math.min(...rs.map(no))) + floors.reduce<number>((d, f) => d + ahead(FLOOR_DAYS, Math.min(...rs.filter((r) => r.floor === f).map(no))), 0);
  });
  // enough teams: blocks go up side by side; otherwise one after another
  const shellDays = Math.round(small * (teams >= shells.length ? Math.max(0, ...shells) : shells.reduce((a, b) => a + b, 0)));
  const left = rooms.map((r) => ahead(ROOM_DAYS, no(r)));
  const finishDays = Math.max(0, ...left, Math.ceil(left.reduce((a, b) => a + b, 0) / teams));
  const days = Math.ceil(((shellDays + finishDays) * 7) / crew.daysPerWeek);
  return { days, shellDays, finishDays, teams };
}

