import { describe, expect, test } from "vitest";
import { analysePhoto, demoProvider } from "../ai/analysePhoto.js";

const img = Buffer.from("x");
const good = await demoProvider(img);

describe("analysePhoto", () => {
  test("accepts valid output", async () => {
    expect((await analysePhoto(img, demoProvider)).area).toBe("bathroom");
  });

  test("rejects a value outside the enum", async () => {
    await expect(analysePhoto(img, async () => ({ ...(good as object), area: "toilet" }))).rejects.toThrow();
  });

  test("rejects a missing field", async () => {
    const { stage: _stage, ...noStage } = good as Record<string, unknown>;
    await expect(analysePhoto(img, async () => noStage)).rejects.toThrow();
  });

  test("accepts area unknown (bare walls)", async () => {
    const bare = async () => ({ ...(good as object), area: "unknown", confidence: "not_enough_evidence" });
    expect((await analysePhoto(img, bare)).area).toBe("unknown");
  });

  test("retries once: bad then good succeeds", async () => {
    let calls = 0;
    const flaky = async () => (calls++ === 0 ? { nonsense: true } : good);
    expect((await analysePhoto(img, flaky)).stage).toBe("tiling");
    expect(calls).toBe(2);
  });
});
