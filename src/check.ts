import { createHash } from "node:crypto";
import exifr from "exifr";
import type { Gps } from "./types.js";

const DAY = 86_400_000;
const MAX_AGE_DAYS = 2;
const MAX_KM = 1;

export type PhotoMeta = { hash: string; takenAt?: Date; gps?: Gps };

function km(a: Gps, b: Gps) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// ponytail: exact-bytes hash only (a re-saved or cropped copy passes); site location = the first photo that had GPS.
export function photoFlags(meta: PhotoMeta, uploadedAt: Date, prior: { hash?: string; gps?: Gps | null }[], what: "photo" | "video" = "photo"): string[] {
  const flags: string[] = [];
  const What = what === "photo" ? "Photo" : "Video";
  if (prior.some((p) => p.hash === meta.hash)) flags.push(`This exact ${what} was uploaded before`);
  if (meta.takenAt) {
    const days = Math.floor((+uploadedAt - +meta.takenAt) / DAY);
    if (days > MAX_AGE_DAYS) flags.push(`${What} was taken ${days} days before it was uploaded`);
  }
  const site = prior.find((p) => p.gps)?.gps ?? undefined;
  if (meta.gps && site && km(site, meta.gps) > MAX_KM) flags.push(`${What} was taken ${km(site, meta.gps).toFixed(1)} km from earlier photos`);
  return flags;
}

export async function readMeta(image: Buffer): Promise<PhotoMeta> {
  const hash = createHash("sha256").update(image).digest("hex");
  const exif = await exifr.parse(image, { gps: true, pick: ["DateTimeOriginal", "latitude", "longitude"] }).catch(() => null);
  return {
    hash,
    takenAt: exif?.DateTimeOriginal instanceof Date ? exif.DateTimeOriginal : undefined,
    gps: typeof exif?.latitude === "number" && typeof exif?.longitude === "number" ? { lat: exif.latitude, lon: exif.longitude } : undefined,
  };
}
