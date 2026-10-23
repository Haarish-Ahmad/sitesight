import { readFileSync } from "node:fs";
import { analysePhoto } from "../src/ai/analysePhoto.js";

const file = process.argv[2];
if (!file) throw new Error("usage: npx tsx scripts/analyse.ts <photo>");
console.log(await analysePhoto(readFileSync(file)));
