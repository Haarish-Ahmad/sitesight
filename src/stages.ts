import { STAGES } from "./ai/schema.js";

// Real stages in build order; "unknown" is not a stage.
export const ORDER = STAGES.filter((s) => s !== "unknown");
export type Stage = (typeof ORDER)[number];

export const stageNo = (s: string | null | undefined) => (s ? ORDER.indexOf(s as Stage) + 1 : 0); // 0 = not started
export const isStage = (s: unknown): s is Stage => ORDER.includes(s as Stage);
export const stageLabel = (s: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : "Not started");

// Five ordinal groups: 11 stages are too many to tell apart by colour, so maps colour by group.
export const GROUPS = [
  { name: "Groundwork", stages: ["excavation", "foundation"] },
  { name: "Frame & walls", stages: ["structure", "brickwork"] },
  { name: "Plaster & services", stages: ["plastering", "plumbing", "electrical"] },
  { name: "Floors & tiles", stages: ["flooring", "tiling"] },
  { name: "Finishes", stages: ["painting", "finishing"] },
] as const;

// group index 1..5 for a stage number (0 = not started); fractional stage numbers (averages) round down
export const groupOf = (no: number) => {
  if (no <= 0) return 0;
  const stage = ORDER[Math.min(ORDER.length, Math.floor(no)) - 1];
  return GROUPS.findIndex((g) => (g.stages as readonly string[]).includes(stage)) + 1;
};
