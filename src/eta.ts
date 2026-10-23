import { z } from "zod";
import { enoughHistory, planEstimate, typicalCrew } from "./finish.js";
import type { Room } from "./structure.js";
import type { Summary } from "./summary.js";
import type { Crew, Eta } from "./types.js";
import { generate } from "./ai/ollama.js";
export type { Crew, Eta } from "./types.js";
export { planEstimate };

const BAND = [0.7, 1.5] as const;

const Estimate = z.object({
  etaDays: z.number().int().min(0).max(3000),
  confidence: z.enum(["low", "medium", "high"]),
  reason: z.string().max(400),
});

const PROMPT = `You estimate how many calendar days remain until a residential building site in India is finished.
planEstimateDays was worked out from the building's size, the stage of every floor and room, and a typical crew for a site this size (workers is that assumption, not a count): frame and walls go floor by floor, then finishing trades shared between teams of about 4 workers.
paceEstimateDays, if not null, comes from this crew's real pace so far; trust it more the longer historyDays is.
Adjust for what the plan misses (monsoon, materials, many rooms at the same stage, very little history) but stay near the evidence.
Give a whole number of days, a confidence (low when historyDays is under 14), and one plain sentence a site manager understands.
Only state what the data shows; do not invent causes or events.

SITE DATA:
`;

export function etaInput(rooms: Room[], s: Summary, crew: Crew) {
  const plan = planEstimate(rooms, s, crew);
  const floors = [...new Set(rooms.filter((r) => r.floor !== null).map((r) => `${r.block ?? ""}:${r.floor}`))].length;
  const input = {
    blocks: new Set(rooms.filter((r) => r.floor !== null).map((r) => r.block ?? "")).size,
    floors,
    totalRooms: s.roomsTotal,
    roomsByStage: s.stageCounts,
    workers: crew.workers,
    workDaysPerWeek: crew.daysPerWeek,
    planEstimateDays: plan.days,
    plan: { frameAndWallsWorkDays: plan.shellDays, finishingWorkDays: plan.finishDays, finishingTeams: plan.teams },
    paceEstimateDays: s.etaDays,
    historyDays: s.historyDays,
  };
  return { input, plan };
}

export async function askEta(rooms: Room[], s: Summary): Promise<Eta> {
  if (!s.roomsTotal) throw new Error("no rooms yet");
  const crew = typicalCrew(rooms);
  const { input, plan } = etaInput(rooms, s, crew);
  const base = { baselineDays: plan.days, ai: false, adjusted: false };
  if (plan.days === 0) return { ...base, etaDays: 0, confidence: "high", reason: "Every room is finished." };
  if (!enoughHistory(s)) throw new Error("Not enough history yet");
  // real pace is averaged in: it knows this crew, the plan knows the building
  const anchor = Math.round((s.etaDays! + plan.days) / 2);
  try {
    const out = await generate([{ role: "user", content: PROMPT + JSON.stringify(input) }], { format: z.toJSONSchema(Estimate) });
    const est = Estimate.parse(JSON.parse(out));
    // small models get arithmetic wrong: keep the answer within a band around the number computed in code
    const etaDays = Math.min(Math.max(est.etaDays, Math.round(anchor * BAND[0])), Math.round(anchor * BAND[1]));
    const confidence = s.historyDays < 14 ? "low" : est.confidence;
    return { ...base, ...est, etaDays, confidence, ai: true, adjusted: etaDays !== est.etaDays };
  } catch {
    return { ...base, etaDays: anchor, confidence: "low", reason: `Worked out from the pace so far and the size of the building (${plural(input.floors, "floor")}, ${plural(s.roomsTotal, "room")}); the AI did not answer.` };
  }
}

const plural = (n: number, w: string) => `${n} ${n === 1 ? w : `${w}s`}`;
