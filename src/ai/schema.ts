import { z } from "zod";

export const AREAS = ["bedroom", "bathroom", "kitchen", "living_room", "balcony", "staircase", "exterior", "terrace", "other", "unknown"] as const;
// Floor is supplied by the uploader (dropdown), not guessed by the model.
export const FLOORS = ["basement", "ground", "first", "second", "third", "terrace", "unknown"] as const;
export const STAGES = ["excavation", "foundation", "structure", "brickwork", "plastering", "plumbing", "electrical", "flooring", "tiling", "painting", "finishing", "unknown"] as const;
export const CONFIDENCE = ["confirmed", "probable", "not_enough_evidence"] as const;

// Yes/no things the model can see. A small model answers these far more reliably than "which stage is this?",
// and src/rules.ts turns them into build-order checks.
export const FEATURES = {
  soil: "bare soil, trenches or an excavation pit",
  open_frame: "open framing: exposed studs, joists or columns with no wall surface between them",
  bare_masonry: "bare brick or concrete blocks with no plaster on them",
  plastered: "walls covered with plaster or plasterboard",
  exposed_pipes: "pipes that are visible and not yet hidden in walls or floors",
  loose_wires: "loose or hanging electrical wires, or empty open conduits",
  finished_floor: "a finished floor: tiles, wood, laminate or vinyl laid",
  wall_tiles: "tiles fixed on the walls",
  painted: "walls painted in a final colour",
  fixtures: "fitted fixtures: sink, toilet, bath, switches, sockets or light fittings",
} as const;
export type Feature = keyof typeof FEATURES;

const flag = z.boolean().catch(false); // a missing or odd answer counts as "not seen"
export const FeaturesSchema = z.object(Object.fromEntries(Object.keys(FEATURES).map((k) => [k, flag])) as Record<Feature, typeof flag>);

export const PhotoAnalysisSchema = z.object({
  area: z.enum(AREAS),
  stage: z.enum(STAGES),
  materials: z.array(z.string()),
  issues: z.array(z.string()),
  confidence: z.enum(CONFIDENCE),
  features: FeaturesSchema.catch(() => FeaturesSchema.parse({})), // no checklist at all = nothing seen
});

export type PhotoAnalysis = z.infer<typeof PhotoAnalysisSchema>;
