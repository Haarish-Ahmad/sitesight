import sharp from "sharp";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { analysePhoto } from "../ai/analysePhoto.js";
import { modelProvider } from "../ai/ollama.js";

const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#888" } }).png().toBuffer();
const reply = { area: "kitchen", stage: "tiling", materials: [], issues: [], confidence: "probable" };
const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "hmm", thought: true }, { text }] }, finishReason: "STOP" }] }));
type Call = [string, { body: string; headers: Record<string, string> }];

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "k123");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("AI_PROVIDER=gemini sends the photo and schema to Gemini, not Ollama, and skips thought parts", async () => {
  const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => ok(JSON.stringify(reply)));
  vi.stubGlobal("fetch", fetchMock);
  const out = await analysePhoto(png, modelProvider);
  expect(out.stage).toBe("tiling");
  const [url, init] = fetchMock.mock.calls[0] as unknown as Call;
  expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  expect(init.headers["x-goog-api-key"]).toBe("k123");
  const body = JSON.parse(init.body);
  const [image, text] = body.contents[0].parts;
  expect(image.inlineData.mimeType).toBe("image/jpeg"); // photos are re-encoded as JPEG before sending
  expect(text.text).toContain("loose_wires");
  expect(body.generationConfig.responseMimeType).toBe("application/json");
  expect(body.generationConfig.responseJsonSchema.properties.area.enum).toContain("bathroom");
  expect(body.generationConfig.responseJsonSchema.$schema).toBeUndefined();
  expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
});

test("rate limit: waits as asked and retries; a blocked or failed reply throws a readable error", async () => {
  const { gemini } = await import("../ai/gemini.js");
  const busy = new Response(JSON.stringify({ error: { message: "quota", details: [{ retryDelay: "0.01s" }] } }), { status: 429 });
  const fetchMock = vi.fn(async () => (fetchMock.mock.calls.length === 1 ? busy : ok("fine")));
  vi.stubGlobal("fetch", fetchMock);
  expect(await gemini([{ role: "user", content: "hi" }])).toBe("fine");
  expect(fetchMock).toHaveBeenCalledTimes(2);

  // the day's quota gone on the first model: the next model answers at once, and later calls skip the first
  const gone = () => new Response(JSON.stringify({ error: { message: "quota", details: [{ retryDelay: "61261s" }] } }), { status: 429 });
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => (urls.push(url), url.includes("/gemini-3.8-flash:") ? gone() : ok("from the next model")));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await gemini([{ role: "user", content: "hi" }])).toBe("from the next model");
  expect(await gemini([{ role: "user", content: "hi" }])).toBe("from the next model");
  expect(urls.map((u) => u.split("/models/")[1].split(":")[0])).toEqual(["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.6-flash"]);
  vi.stubGlobal("fetch", async () => gone());
  await expect(gemini([{ role: "user", content: "hi" }], { model: "a,b" })).rejects.toThrow("no answer on a, b");

  // a model that never answers is given up on after the timeout, and the next one is used
  vi.stubEnv("GEMINI_TIMEOUT_S", "0.05");
  vi.resetModules();
  const { gemini: fresh } = await import("../ai/gemini.js");
  vi.stubGlobal("fetch", (url: string, init: { signal: AbortSignal }) => (url.includes("/slow:") ? new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason))) : Promise.resolve(ok("fast one"))));
  expect(await fresh([{ role: "user", content: "hi" }], { model: "slow,quick" })).toBe("fast one");

  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })));
  await expect(gemini([{ role: "user", content: "hi" }])).rejects.toThrow("Gemini gave no answer (SAFETY)");
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 }));
  await expect(gemini([{ role: "user", content: "hi" }])).rejects.toThrow("Gemini 400: API key not valid");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GOOGLE_API_KEY", "");
  await expect(gemini([{ role: "user", content: "hi" }])).rejects.toThrow("GEMINI_API_KEY is not set");
});

test("a model that stays busy (503) is rested and the next model answers", async () => {
  const { gemini } = await import("../ai/gemini.js");
  vi.stubGlobal("setTimeout", (fn: () => void) => (fn(), 0)); // skip the retry waits
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => (urls.push(url), url.includes("/busy1:") ? new Response(JSON.stringify({ error: { message: "high demand" } }), { status: 503 }) : ok("from busy2")));
  expect(await gemini([{ role: "user", content: "hi" }], { model: "busy1,busy2" })).toBe("from busy2");
  expect(urls.map((u) => u.split("/models/")[1].split(":")[0])).toEqual(["busy1", "busy1", "busy1", "busy2"]);
});
