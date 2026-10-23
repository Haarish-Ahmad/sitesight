import { expect, test } from "vitest";
import { claimFlags } from "../rules.js";
import type { PhotoAi } from "../types.js";

const ai = (features: PhotoAi["features"], stage = "unknown", confidence = "probable"): PhotoAi => ({ stage, confidence, materials: [], issues: [], features });

test("overlapping work is never flagged", () => {
  // walls half plastered with pipes and wires out: plastering, plumbing and electrical can all be true at once
  const mixed = ai({ plastered: true, exposed_pipes: true, loose_wires: true, open_frame: true });
  for (const c of ["plastering", "plumbing", "electrical"] as const) expect(claimFlags(c, mixed)).toEqual([]);
  // tiles going down while the floor is being finished
  expect(claimFlags("tiling", ai({ plastered: true, finished_floor: true }))).toEqual([]);
  expect(claimFlags("painting", ai({ plastered: true, painted: true, loose_wires: true }))).toEqual([]);
});

test("extreme contradictions are flagged", () => {
  expect(claimFlags("painting", ai({ bare_masonry: true }))[0]).toMatch(/bare brick or block/);
  expect(claimFlags("finishing", ai({ open_frame: true }))[0]).toMatch(/open framing/);
  expect(claimFlags("tiling", ai({ open_frame: true }))[0]).toMatch(/open framing/);
  expect(claimFlags("finishing", ai({ plastered: true, painted: true, loose_wires: true }))[0]).toMatch(/wires/);
  // the user's example: a finished room cannot be at the wiring stage
  expect(claimFlags("electrical", ai({ plastered: true, painted: true, finished_floor: true }))[0]).toMatch(/finished room/);
  expect(claimFlags("brickwork", ai({ soil: true }))[0]).toMatch(/bare ground/);
  expect(claimFlags("excavation", ai({ exposed_pipes: true }))[0]).toMatch(/built room/);
  expect(claimFlags("foundation", ai({ open_frame: true }))).toEqual([]); // framing is the very next stage: lenient
});

test("doubtful answers and small gaps are left alone", () => {
  expect(claimFlags("painting", ai({ bare_masonry: true }, "brickwork", "not_enough_evidence"))).toEqual([]);
  expect(claimFlags("tiling", ai({}, "plumbing", "confirmed"))).toEqual([]); // 3 stages apart: lenient
  expect(claimFlags("finishing", ai({}, "foundation", "confirmed"))[0]).toMatch(/far from/); // 9 apart, confident
  expect(claimFlags("finishing", ai(undefined, "foundation", "probable"))).toEqual([]); // far, but not confident; old data has no features
});

import { progressFlag } from "../compare.js";
test("progress check flags only a clear contradiction of the claim", () => {
  const c = (verdict: "progress" | "same_work" | "less_finished" | "different_place") => ({ verdict, note: "", since: 1 }) as const;
  expect(progressFlag(c("progress"), "plastering", "tiling")).toBeNull();
  expect(progressFlag(c("same_work"), "plastering", "plastering")).toBeNull(); // still working on the same stage
  expect(progressFlag(c("same_work"), "plastering", "tiling")).toContain("no new work");
  expect(progressFlag(c("less_finished"), "tiling", "tiling")).toContain("less finished");
  expect(progressFlag(c("different_place"), "tiling", "painting")).toContain("not be the same place");
});
