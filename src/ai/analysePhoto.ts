import { modelProvider } from "./ollama.js";
import { PhotoAnalysis, PhotoAnalysisSchema } from "./schema.js";

// A provider turns an image (or a video's frames, in order) into raw (unchecked) model output.
export type Provider = (image: Buffer | Buffer[]) => Promise<unknown>;

export const demoProvider: Provider = async () => ({
  area: "bathroom",
  stage: "tiling",
  materials: ["ceramic tile", "cement"],
  issues: [],
  confidence: "probable",
  features: { plastered: true, wall_tiles: true },
});

const providers: Record<string, Provider> = { demo: demoProvider, local: modelProvider, gemini: modelProvider };

// Every caller goes through here. Invalid output is retried once, then throws.
export async function analysePhoto(
  image: Buffer | Buffer[],
  provider: Provider = providers[process.env.AI_PROVIDER ?? "demo"] ?? demoProvider,
): Promise<PhotoAnalysis> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = PhotoAnalysisSchema.safeParse(await provider(image));
    if (result.success) return result.data;
    lastError = result.error;
  }
  throw new Error(`AI output failed validation twice: ${lastError}`);
}
