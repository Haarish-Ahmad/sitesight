import type { PhotoAnalysis } from "./schema.js";

export type Label = Pick<PhotoAnalysis, "area" | "stage">;
const FIELDS = ["area", "stage"] as const;

// Accuracy per field, and per confidence level (does "confirmed" actually mean right?).
export function score(rows: { label: Label; result: PhotoAnalysis }[]) {
  const byField = { area: 0, stage: 0 };
  const byConfidence: Record<string, { n: number; correct: number }> = {};
  for (const { label, result } of rows) {
    const hits = FIELDS.filter((f) => result[f] === label[f]);
    for (const f of hits) byField[f]++;
    const c = (byConfidence[result.confidence] ??= { n: 0, correct: 0 });
    c.n++;
    if (hits.length === FIELDS.length) c.correct++;
  }
  return { total: rows.length, byField, byConfidence };
}
