import sharp from "sharp";
import { z } from "zod";
import { generate } from "./ai/ollama.js";
import { stageLabel, stageNo } from "./stages.js";

// Is this photo of the same room further along than the last one? Needs two images, so it runs only on a
// capable model (Gemini); the local 3b model is too slow and too weak for it (COMPARE_PHOTOS=1 forces it on).
export const VERDICTS = ["progress", "same_work", "less_finished", "different_place"] as const;
export type Compare = { verdict: (typeof VERDICTS)[number]; note: string; since: number }; // since = the earlier update's id
const Reply = z.object({ verdict: z.enum(VERDICTS), note: z.string().max(200) });

export const canCompare = () => process.env.AI_PROVIDER === "gemini" || !!process.env.COMPARE_PHOTOS;

const prompt = (before: string, after: string) => `Two photos of the same room on a building site. Photo 1 is the EARLIER one (reported as "${before}"). Photo 2 is the NEW one (reported as "${after}").
Say what changed. verdict is one of:
- progress: the new photo shows more work done than the earlier one (new layer, more area covered, new fittings)
- same_work: no real difference in the work done (a different angle, lighting or tidying up is still same_work)
- less_finished: the new photo clearly shows less finished work than the earlier one
- different_place: it is clearly not the same room (be generous: other angles, lighting and clutter are normal)
note: one short plain sentence on what changed, or "" if nothing.
When unsure choose progress or same_work. Describe only what is visible.`;

const small = async (b: Buffer) => (await sharp(b).rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()).toString("base64");

export async function comparePhotos(before: Buffer, after: Buffer, claims: { before: string; after: string }, since: number): Promise<Compare> {
  const out = await generate([{ role: "user", content: prompt(claims.before, claims.after), images: [await small(before), await small(after)] }], { format: z.toJSONSchema(Reply), temperature: 0 });
  return { ...Reply.parse(JSON.parse(out)), since };
}

// A reason for a person to look, or nothing. Lenient: only a clear contradiction of the claim is flagged.
export function progressFlag(c: Compare, before: string, after: string): string | null {
  const moved = stageNo(after) > stageNo(before);
  if (c.verdict === "same_work" && moved) return `${stageLabel(after)} was reported (earlier: ${before}), but the photo shows no new work since the earlier photo`;
  if (c.verdict === "less_finished") return "The photo shows less finished work than the earlier photo of this place";
  if (c.verdict === "different_place") return "This may not be the same place as the earlier photo";
  return null;
}
