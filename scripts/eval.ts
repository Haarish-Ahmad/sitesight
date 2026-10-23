import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analysePhoto } from "../src/ai/analysePhoto.js";
import { Label, score } from "../src/ai/score.js";

// usage: AI_PROVIDER=local npx tsx scripts/eval.ts [photos-dir]
// photos-dir/labels.json: { "kitchen1.jpg": { "area": "kitchen", "stage": "tiling" } }
const dir = process.argv[2] ?? "photos";
const labels: Record<string, Label> = JSON.parse(readFileSync(join(dir, "labels.json"), "utf8"));

const rows = [];
for (const [file, label] of Object.entries(labels)) {
  const result = await analysePhoto(readFileSync(join(dir, file)));
  console.log(file, "| expected", label.area, label.stage, "| got", result.area, result.stage, `(${result.confidence})`);
  rows.push({ label, result });
}
console.log(score(rows));
