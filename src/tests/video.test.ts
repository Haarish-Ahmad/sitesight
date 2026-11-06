import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { photoFlags } from "../check.js";
import { mediaLabel } from "../summary.js";
import { aiFrames, metaFromProbe, parseIso6709, poster, probe, toMp4 } from "../video.js";

test("parseIso6709 reads where a phone recorded the video", () => {
  expect(parseIso6709("+12.9716+077.5946+000.000/")).toEqual({ lat: 12.9716, lon: 77.5946 });
  expect(parseIso6709("-33.8688+151.2093/")).toEqual({ lat: -33.8688, lon: 151.2093 });
  expect(parseIso6709("+00.0000+000.0000/")).toBeNull(); // no fix
  expect(parseIso6709("nowhere")).toBeNull();
  expect(parseIso6709(undefined)).toBeNull();
});

describe("metaFromProbe", () => {
  const video = { codec_type: "video" };
  test("Android: UTC creation_time and a location tag", () => {
    const m = metaFromProbe({ format: { duration: "41.6", tags: { creation_time: "2026-10-20T09:02:11.000000Z", location: "+12.9716+077.5946/" } }, streams: [video] });
    expect(m).toEqual({ seconds: 42, takenAt: new Date("2026-10-20T09:02:11Z"), gps: { lat: 12.9716, lon: 77.5946 } });
  });
  test("iPhone: Apple's tags win, whatever their case", () => {
    const m = metaFromProbe({ format: { duration: "10", tags: { "com.apple.quicktime.creationdate": "2026-10-20T14:32:11+0530", "com.apple.quicktime.location.ISO6709": "+19.0760+072.8777+010.000/", creation_time: "2026-10-20T09:03:00Z" } }, streams: [video] });
    expect(m?.takenAt?.toISOString()).toBe("2026-10-20T09:02:11.000Z");
    expect(m?.gps).toEqual({ lat: 19.076, lon: 72.8777 });
  });
  test("a 1970 date or none is no date; audio alone is not a video", () => {
    expect(metaFromProbe({ format: { duration: "5", tags: { creation_time: "1970-01-01T00:00:00Z" } }, streams: [video] })).toEqual({ seconds: 5 });
    expect(metaFromProbe({ format: { duration: "5" }, streams: [{ codec_type: "audio" }] })).toBeNull();
    expect(metaFromProbe({})).toBeNull();
  });
});

test("flags say video for a video", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  expect(photoFlags({ hash: "a" }, now, [{ hash: "a" }], "video")[0]).toBe("This exact video was uploaded before");
  expect(photoFlags({ hash: "b", takenAt: new Date("2026-03-01T12:00:00Z") }, now, [], "video")[0]).toBe("Video was taken 9 days before it was uploaded");
});

test("mediaLabel", () => {
  const v = { video: { file: "1-1.mp4", seconds: 3 } };
  expect(mediaLabel([])).toBe("0 photos");
  expect(mediaLabel([{}])).toBe("1 photo");
  expect(mediaLabel([{}, {}, v])).toBe("2 photos, 1 video");
  expect(mediaLabel([v, v])).toBe("2 videos");
});

// Runs where ffmpeg is installed (the api container); skipped elsewhere.
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test.skipIf(!ffmpeg)("a phone-style video: probed, poster, AI frames, converted to mp4", async () => {
  const dir = mkdtempSync(join(tmpdir(), "video-"));
  try {
    const src = join(dir, "1-1.mov");
    // 6 s portrait clip with sound, like a phone held upright
    spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30:duration=6", "-f", "lavfi", "-i", "sine=duration=6", "-shortest", "-c:v", "libx264", "-c:a", "aac", "-metadata", "creation_time=2026-10-20T09:02:11Z", "-metadata", "location=+12.9716+077.5946/", src]);
    const m = await probe(src);
    expect(m).toEqual({ seconds: 6, takenAt: new Date("2026-10-20T09:02:11Z"), gps: { lat: 12.9716, lon: 77.5946 } });
    const cover = await sharp(await poster(src, 6)).metadata();
    expect([cover.format, cover.width, cover.height]).toEqual(["jpeg", 900, 1600]);
    const frames = await aiFrames(src, 6);
    expect(frames).toHaveLength(4);
    expect((await sharp(frames[0]).metadata()).height).toBe(768);
    const out = join(dir, "1-1.v.mp4");
    await toMp4(src, out);
    expect(statSync(out).size).toBeLessThan(statSync(src).size);
    const conv = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", out]).stdout.toString();
    expect(conv).toContain("h264,720,1280");
    expect(conv).toContain("aac");
    expect(await probe(join(dir, "nothing.mp4"))).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
