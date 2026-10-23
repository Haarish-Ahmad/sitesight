import type { Feature } from "./ai/schema.js";
import { stageLabel, stageNo, type Stage } from "./stages.js";
import type { PhotoAi } from "./types.js";

// Build-order checks on what a photo shows. Lenient on purpose: crews overlap work (plaster, pipes and wiring
// go on together; floors and tiles; paint and finishing), so only claims the photo physically contradicts are flagged.
// Each rule returns a reason a person should look, never proof of anything.
type Rule = { when: (claim: Stage, n: number, f: (k: Feature) => boolean) => boolean; say: (claim: string, f: (k: Feature) => boolean) => string };

const shellWalls = (f: (k: Feature) => boolean) => (f("open_frame") || f("bare_masonry")) && !f("plastered");
const wallsText = (f: (k: Feature) => boolean) => (f("open_frame") ? "open framing" : "bare brick or block");

const RULES: Rule[] = [
  // finishes need closed, plastered walls
  { when: (c, _n, f) => (c === "painting" || c === "finishing") && shellWalls(f), say: (c, f) => `${c} was reported, but the walls are still ${wallsText(f)} with no plaster` },
  // floors and tiles need a closed room, not open framing or a pit
  { when: (c, _n, f) => (c === "flooring" || c === "tiling") && (f("soil") || (f("open_frame") && !f("plastered"))), say: (c, f) => `${c} was reported, but the photo shows ${f("soil") ? "bare ground or an excavation" : "open framing"}` },
  // a finished room still has wires hanging out
  { when: (c, _n, f) => c === "finishing" && f("loose_wires"), say: () => "Finishing was reported, but loose or hanging wires are still visible" },
  // the other way round: an early-stage claim with a photo of a finished room is likely the wrong room or an old photo
  { when: (_c, n, f) => n <= stageNo("electrical") && f("painted") && f("finished_floor"), say: (c) => `The photo shows a finished room (painted walls, finished floor), but ${c} was reported: check it is the right room and photo` },
  // groundwork claimed, but the photo shows services or finishes (4+ stages later); open framing alone is only one stage on, so it passes
  { when: (_c, n, f) => n <= stageNo("foundation") && !f("soil") && (["plastered", "painted", "finished_floor", "wall_tiles", "exposed_pipes", "loose_wires", "fixtures"] as Feature[]).some(f), say: (c) => `${c} was reported, but the photo shows a built room (services or finishes): check it is the right photo` },
  // later work claimed, but the photo is still just ground
  { when: (_c, n, f) => n >= stageNo("structure") && f("soil") && !f("open_frame") && !f("bare_masonry") && !f("plastered"), say: (c) => `${c} was reported, but the photo shows only bare ground or an excavation` },
];

export function claimFlags(claim: Stage, ai: PhotoAi): string[] {
  if (ai.confidence === "not_enough_evidence") return [];
  const f = (k: Feature) => ai.features?.[k] === true;
  const n = stageNo(claim);
  const hit = RULES.find((r) => r.when(claim, n, f));
  if (hit) return [cap(hit.say(stageLabel(claim).toLowerCase(), f))];
  // last resort for photos the checklist missed: the model is confident and very far off (6+ of 11 stages)
  const seen = stageNo(ai.stage);
  if (ai.confidence === "confirmed" && seen > 0 && Math.abs(seen - n) >= 6) return [`Photo looks like ${ai.stage}, far from the reported ${claim}`];
  return [];
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
