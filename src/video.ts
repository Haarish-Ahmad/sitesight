import { spawn } from "node:child_process";
import type { Gps } from "./types.js";

// Site videos: a walk round a room shows more than a few photos. ffmpeg does the work (installed in the api image;
// without it video uploads are refused). The AI never watches the video itself: it gets a few frames from it,
// so the same check runs on Gemini and on the local model.
export const MAX_SECONDS = 120;
export const AI_FRAMES = 4;

function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<Buffer> {
  return new Promise((ok, bad) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (c: Buffer) => out.push(c));
    p.stderr.on("data", (c: Buffer) => (err = (err + c).slice(-2000)));
    p.on("error", (e) => (clearTimeout(timer), bad(e)));
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? ok(Buffer.concat(out)) : bad(new Error(`${cmd} failed (${code ?? "killed"}): ${err.trim().split("\n").pop()}`));
    });
  });
}

let found: Promise<boolean> | undefined;
export const hasFfmpeg = () => (found ??= run("ffmpeg", ["-version"]).then(() => true, () => false));

// "+12.9716+077.5946+000.000/" (ISO 6709, how phones store where a video was recorded)
export function parseIso6709(s: unknown): Gps | null {
  const m = typeof s === "string" ? s.match(/^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/) : null;
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon) ? { lat, lon } : null;
}

export type VideoMeta = { seconds: number; takenAt?: Date; gps?: Gps };
type Probe = { format?: { duration?: string; tags?: Record<string, string> }; streams?: { codec_type?: string; tags?: Record<string, string> }[] };

export function metaFromProbe(p: Probe): VideoMeta | null {
  if (!p.streams?.some((s) => s.codec_type === "video")) return null;
  const tags = Object.fromEntries(Object.entries(p.format?.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  // iPhones keep local time in creationdate; creation_time is UTC. Some phones write 1970 or nothing.
  const when = new Date(tags["com.apple.quicktime.creationdate"] ?? tags.creation_time ?? p.streams.find((s) => s.tags?.creation_time)?.tags?.creation_time ?? "");
  const gps = parseIso6709(tags["com.apple.quicktime.location.iso6709"] ?? tags.location ?? tags["location-eng"]);
  return {
    seconds: Math.round(Number(p.format?.duration) || 0),
    ...(when.getFullYear() >= 2000 && { takenAt: when }),
    ...(gps && { gps }),
  };
}

export async function probe(path: string): Promise<VideoMeta | null> {
  const out = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path]).catch(() => null);
  if (!out) return null;
  try {
    return metaFromProbe(JSON.parse(out.toString("utf8")));
  } catch {
    return null;
  }
}

// One frame as a JPEG, the long side at most `max` px. ffmpeg turns phone videos upright by itself.
export const frameAt = (path: string, at: number, max: number) =>
  run("ffmpeg", ["-v", "error", "-ss", String(at), "-i", path, "-frames:v", "1", "-vf", `scale=w=${max}:h=${max}:force_original_aspect_ratio=decrease`, "-q:v", "3", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"]);

// The cover picture: a second in, past the shaky start
export const poster = (path: string, seconds: number) => frameAt(path, Math.min(1, seconds / 2), 1600);

// Frames spread over the whole clip, for the AI check
export const aiFrames = (path: string, seconds: number) => {
  const n = seconds >= 2 ? AI_FRAMES : 1;
  return Promise.all(Array.from({ length: n }, (_, i) => frameAt(path, (seconds * (i + 0.5)) / n, 768)));
};

// Phone videos are often HEVC (iPhone) that most browsers cannot play, and 100 MB a minute.
// 720p H.264 plays everywhere and is about a tenth of the size; the voice track is kept (managers talk over walk-rounds).
export const toMp4 = (src: string, dst: string) =>
  run("ffmpeg", [
    "-v", "error", "-y", "-i", src, "-t", String(MAX_SECONDS),
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale=w=1280:h=1280:force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "64k", "-ac", "1",
    "-movflags", "+faststart", dst,
  ], 10 * 60_000);
