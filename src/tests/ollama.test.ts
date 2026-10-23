import sharp from "sharp";
import { afterEach, expect, test, vi } from "vitest";
import { analysePhoto } from "../ai/analysePhoto.js";
import { modelProvider } from "../ai/ollama.js";

const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#888" } }).png().toBuffer();

afterEach(() => vi.unstubAllGlobals());

const reply = { area: "unknown", stage: "unknown", materials: [], issues: [], confidence: "not_enough_evidence" };

test("sends image + schema to Ollama and parses the reply", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { content: JSON.stringify(reply) } })));
  vi.stubGlobal("fetch", fetchMock);
  const out = await analysePhoto(png, modelProvider);
  expect(out.area).toBe("unknown");
  const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
  const sent = await sharp(Buffer.from(body.messages[0].images[0], "base64")).metadata();
  expect(sent.width).toBe(1024); // downscaled from 2000
  expect(body.format.properties.area.enum).toContain("bathroom");
  expect(body.messages[0].content).toContain("loose_wires");
  expect(out.features.loose_wires).toBe(false); // missing answers count as "not seen"
});

test("throws when Ollama returns an error", async () => {
  vi.stubGlobal("fetch", async () => new Response("model not found", { status: 404 }));
  await expect(modelProvider(png)).rejects.toThrow("Ollama 404");
});
