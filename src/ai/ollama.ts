import sharp from "sharp";
import { z } from "zod";
import { AREAS, FEATURES, PhotoAnalysisSchema, STAGES } from "./schema.js";
import type { Provider } from "./analysePhoto.js";
import { gemini } from "./gemini.js";

export const DEFAULT_MODEL = "qwen2.5vl:3b";
export const chatModel = () => process.env.OLLAMA_CHAT_MODEL ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;

export type OllamaMessage = { role: "system" | "user" | "assistant"; content: string; images?: string[] };

// Every model call goes through here: one place for the URL, options and error text.
// `format` is a JSON schema: Ollama then constrains the output to it and we parse it.
export async function ollama(messages: OllamaMessage[], opts: { model?: string; format?: object; temperature?: number; ctx?: number; maxTokens?: number } = {}): Promise<string> {
  const base = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? chatModel(),
      // streamed: a slow model on a small GPU can take minutes, past fetch's 5-minute wait for headers
      stream: true,
      ...(opts.format && { format: opts.format }),
      // OLLAMA_NUM_GPU: layers on the GPU. unset = Ollama decides, 0 = CPU only.
      options: { temperature: opts.temperature ?? 0, num_ctx: opts.ctx ?? 8192, ...(opts.maxTokens && { num_predict: opts.maxTokens }), ...(process.env.OLLAMA_NUM_GPU && { num_gpu: Number(process.env.OLLAMA_NUM_GPU) }) },
      messages,
    }),
  }).catch((e) => {
    throw new Error(`Cannot reach Ollama at ${base}. Is it running? (${e?.cause?.code ?? e?.message ?? e})`);
  });
  if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  let text = "", buf = "";
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const l of lines) if (l.trim()) text += (JSON.parse(l) as { message?: { content?: string } }).message?.content ?? "";
  }
  if (buf.trim()) text += (JSON.parse(buf) as { message?: { content?: string } }).message?.content ?? "";
  return text;
}

// Every caller goes through here. AI_PROVIDER=gemini sends the call to Google instead of the local Ollama
// (the model then comes from GEMINI_MODEL, since the Ollama model names mean nothing there).
export const generate = (messages: OllamaMessage[], opts: Parameters<typeof ollama>[1] = {}) =>
  process.env.AI_PROVIDER === "gemini" ? gemini(messages, { ...opts, model: undefined }) : ollama(messages, opts);

const PROMPT = `You are inspecting a photo from a building construction site.
Describe only what is visible. Fill every field:
- area: the room or space shown, one of: ${AREAS.join(", ")}. Use "unknown" if bare walls give no clue
- stage: the construction stage visible, one of: ${STAGES.join(", ")}. Use "unknown" if unclear
- materials: materials you can see
- issues: only clear, serious safety or quality problems a site manager must act on, such as a collapsed or cracked structure, standing water, exposed live wiring in a finished room, or a missing guard rail. Untidy or unfinished work is normal on a building site and is NOT an issue: loose wires, open conduits, exposed pipes, bare walls, debris, tools and materials lying around. Empty list if none, and when unsure leave it empty
- confidence: "confirmed" only for a clear view, "probable" for a partial view, otherwise "not_enough_evidence"
- features: answer true ONLY if you can clearly see it in the photo, otherwise false:
${Object.entries(FEATURES).map(([k, v]) => `  - ${k}: ${v}`).join("\n")}
Never guess. Prefer "unknown" and "not_enough_evidence" over a wrong answer.`;

const FRAMES = (n: number) => `The ${n} images are frames, in order, from one short video of a single place on a building site. Treat them together as one view of that place: answer for the place, and "the photo" below means all ${n} frames.\n\n`;

export const modelProvider: Provider = async (image) => {
  const list = Array.isArray(image) ? image : [image];
  // phone photos are huge; full-res made the 3b model loop and blow the context. Several frames get fewer pixels each.
  const side = list.length > 1 ? 768 : 1024;
  const small = await Promise.all(list.map((b) => sharp(b).rotate().resize(side, side, { fit: "inside", withoutEnlargement: true }).jpeg().toBuffer()));
  const out = await generate([{ role: "user", content: (list.length > 1 ? FRAMES(list.length) : "") + PROMPT, images: small.map((b) => b.toString("base64")) }], {
    model: process.env.OLLAMA_MODEL ?? DEFAULT_MODEL,
    format: z.toJSONSchema(PhotoAnalysisSchema),
  });
  return JSON.parse(out);
};
