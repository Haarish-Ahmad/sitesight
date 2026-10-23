import { readFileSync } from "node:fs";
import { draftFromReadings, readPlan } from "../src/plan.js";

// usage: [OLLAMA_PLAN_MODEL=qwen2.5vl:7b] npx tsx scripts/read-plan.ts plans/a.png [plans/b.png ...]
const files = process.argv.slice(2);
if (!files.length) throw new Error("usage: npx tsx scripts/read-plan.ts <plan image> [...]");
const readings = [];
for (const f of files) {
  const t = Date.now();
  readings.push(await readPlan(readFileSync(f)));
  console.log(f, `${((Date.now() - t) / 1000).toFixed(0)} s`, JSON.stringify(readings.at(-1)));
}
console.log(JSON.stringify(draftFromReadings(readings), null, 1));
