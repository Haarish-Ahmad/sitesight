import { expect, test } from "vitest";
import { score } from "../ai/score.js";
import type { PhotoAnalysis } from "../ai/schema.js";

const r = (area: PhotoAnalysis["area"], stage: PhotoAnalysis["stage"], confidence: PhotoAnalysis["confidence"]): PhotoAnalysis => ({
  area, stage, confidence, materials: [], issues: [], features: {} as PhotoAnalysis["features"],
});

test("scores fields and confidence separately", () => {
  const out = score([
    { label: { area: "kitchen", stage: "tiling" }, result: r("kitchen", "tiling", "confirmed") },
    { label: { area: "kitchen", stage: "tiling" }, result: r("kitchen", "painting", "confirmed") },
    { label: { area: "bathroom", stage: "plumbing" }, result: r("unknown", "unknown", "not_enough_evidence") },
  ]);
  expect(out.byField).toEqual({ area: 2, stage: 1 });
  expect(out.byConfidence.confirmed).toEqual({ n: 2, correct: 1 });
  expect(out.byConfidence.not_enough_evidence).toEqual({ n: 1, correct: 0 });
});
