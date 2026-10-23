import type { OllamaMessage } from "./ollama.js";

// Google Gemini over REST. Works on the free tier (key from https://aistudio.google.com/apikey),
// but on the free tier Google may use the prompts and photos sent to improve its products.
// Same call shape as ollama(), so generate() in ollama.ts can switch between them.
// Free-tier models, best first. Each has its own daily quota (gemini-3.8-flash's is small: about 20-25 calls),
// so when one is used up the next takes over. GEMINI_MODEL overrides the list (comma-separated).
export const GEMINI_MODEL = "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite";
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type Opts = { model?: string; format?: object; temperature?: number };
type Reply = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; details?: { retryDelay?: string }[] };
};

const mime = (b64: string) => (b64.startsWith("iVBOR") ? "image/png" : b64.startsWith("UklGR") ? "image/webp" : "image/jpeg");

export function geminiBody(messages: OllamaMessage[], opts: Opts) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  // zod's JSON schema carries a "$schema" key that is not part of the schema itself
  const { $schema: _, ...schema } = (opts.format ?? {}) as Record<string, unknown>;
  // low thinking: these are reading and wording jobs, and thinking tokens slow the reply. GEMINI_THINKING= (empty) leaves the model default.
  const level = process.env.GEMINI_THINKING ?? "low";
  return {
    ...(system && { systemInstruction: { parts: [{ text: system }] } }),
    contents: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [...(m.images ?? []).map((data) => ({ inlineData: { mimeType: mime(data), data } })), { text: m.content }],
      })),
    generationConfig: {
      temperature: opts.temperature ?? 0,
      ...(opts.format && { responseMimeType: "application/json", responseJsonSchema: schema }),
      ...(level && { thinkingConfig: { thinkingLevel: level } }),
    },
  };
}

// Google's "try again in N s": a few seconds = per-minute limit (wait); hours = the day's quota is gone (switch model).
const askedMs = (reply: Reply) => {
  const d = reply.error?.details?.find((x) => x.retryDelay)?.retryDelay;
  return d ? parseFloat(d) * 1000 : null;
};
class QuotaGone extends Error {
  constructor(public model: string, public untilMs: number, why = "free quota used up") {
    super(`Gemini ${model}: ${why}`);
  }
}
const outOfQuota = new Map<string, number>(); // model -> when it is worth trying again; skipped until then
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_S || 60) * 1000; // a busy model can accept the call and never answer

export async function gemini(messages: OllamaMessage[], opts: Opts = {}): Promise<string> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey and put it in sitesight/.env");
  const models = (opts.model || process.env.GEMINI_MODEL || GEMINI_MODEL).split(",").map((m) => m.trim()).filter(Boolean);
  const ready = models.filter((m) => (outOfQuota.get(m) ?? 0) <= Date.now());
  for (const model of ready.length ? ready : models) {
    try {
      return await call(model, key, messages, opts);
    } catch (e) {
      if (!(e instanceof QuotaGone)) throw e;
      outOfQuota.set(model, e.untilMs);
      console.warn(`${e.message}; skipping it for ${Math.ceil((e.untilMs - Date.now()) / 60_000)} min and trying the next model`);
    }
  }
  throw new Error(`Gemini gave no answer on ${models.join(", ")}: the free quota is used up (it comes back within a day) or the models are busy. Try again in a few minutes, or run with the local AI (npm run api).`);
}

async function call(model: string, key: string, messages: OllamaMessage[], opts: Opts): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(geminiBody(messages, opts)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((e) => {
      if (e?.name === "TimeoutError") throw new QuotaGone(model, Date.now() + 5 * 60_000, `no answer in ${TIMEOUT_MS / 1000} s`);
      throw new Error(`Cannot reach Gemini (${e?.cause?.code ?? e?.message ?? e})`);
    });
    const reply = (await res.json().catch(() => ({}))) as Reply;
    if (res.status === 429) {
      const asked = askedMs(reply);
      if ((asked !== null && asked > 60_000) || attempt >= 3) throw new QuotaGone(model, Date.now() + (asked ?? 60_000));
      const ms = asked ?? 2000 * 2 ** attempt;
      console.warn(`Gemini ${model}: rate limit; retrying in ${Math.round(ms / 1000)} s`);
      await new Promise((r) => setTimeout(r, ms));
      continue;
    }
    if (res.status >= 500) {
      // "high demand" (503) can last minutes: after two retries rest this model briefly and try the next one
      if (attempt >= 2) throw new QuotaGone(model, Date.now() + 2 * 60_000, `busy (error ${res.status})`);
      console.warn(`Gemini ${model}: error ${res.status}; retrying`);
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${reply.error?.message ?? res.statusText}`);
    const c = reply.candidates?.[0];
    const text = (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    if (!text) throw new Error(`Gemini gave no answer (${reply.promptFeedback?.blockReason ?? c?.finishReason ?? "no candidate"})`);
    return text;
  }
}
