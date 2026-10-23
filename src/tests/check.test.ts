import sharp from "sharp";
import { expect, test } from "vitest";
import { photoFlags, readMeta } from "../check.js";

const now = new Date("2026-03-10T12:00:00Z");
const h = (n: number) => new Date(+now - n * 3_600_000);

test("photoFlags: duplicate, old photo, far from site", () => {
  const site = { lat: 51.5, lon: -0.12 };
  const prior = [{ hash: "a", gps: site }];
  expect(photoFlags({ hash: "b", takenAt: h(5), gps: { lat: 51.5005, lon: -0.12 } }, now, prior)).toEqual([]);
  expect(photoFlags({ hash: "a" }, now, prior)[0]).toMatch(/uploaded before/);
  expect(photoFlags({ hash: "b", takenAt: h(24 * 5) }, now, prior)[0]).toMatch(/5 days/);
  expect(photoFlags({ hash: "b", gps: { lat: 51.6, lon: -0.12 } }, now, prior)[0]).toMatch(/km from earlier/);
  expect(photoFlags({ hash: "b", gps: { lat: 10, lon: 10 } }, now, [])).toEqual([]); // no site yet
});

test("readMeta hashes the bytes and tolerates a photo with no EXIF", async () => {
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#888" } }).png().toBuffer();
  const m = await readMeta(png);
  expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
  expect(m.takenAt).toBeUndefined();
  expect(m.gps).toBeUndefined();
});
