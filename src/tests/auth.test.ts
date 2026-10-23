import { expect, test } from "vitest";
import { ADMIN_COOKIE, cookie, hashPassword, passwordProblem, readCookie, tooMany, USER_COOKIE, verifyPassword } from "../auth.js";

test("passwords are salted scrypt hashes, and only the right password matches", async () => {
  const a = await hashPassword("site-team-123");
  const b = await hashPassword("site-team-123");
  expect(a).toMatch(/^scrypt\$32768\$8\$3\$/);
  expect(a).not.toBe(b); // a fresh salt each time: equal passwords do not give equal hashes
  expect(a).not.toContain("site-team-123");
  expect(await verifyPassword("site-team-123", a)).toBe(true);
  expect(await verifyPassword("site-team-124", a)).toBe(false);
  expect(await verifyPassword("x", "not-a-hash")).toBe(false);
});

test("weak passwords are refused", () => {
  expect(passwordProblem("short", "a@b.c")).toMatch(/10 characters/);
  expect(passwordProblem("ravikumar-2026", "ravikumar@gmail.com")).toMatch(/email/);
  expect(passwordProblem("aaaaaaaaaaaa", "a@b.c")).toMatch(/easy/);
  expect(passwordProblem("green-villa-tiles-9", "ravi@gmail.com")).toBeNull();
});

test("cookies: HttpOnly, SameSite=Strict, admin cookie limited to /api/admin", () => {
  expect(cookie(USER_COOKIE, "t", 60, true)).toBe("ss_session=t; HttpOnly; SameSite=Strict; Path=/; Max-Age=60; Secure");
  expect(cookie(ADMIN_COOKIE, "t", 60, false)).toContain("Path=/api/admin");
  expect(readCookie("a=1; ss_session=abc; b=2", USER_COOKIE)).toBe("abc");
});

test("rate limit counts within the window only", () => {
  expect([1, 2, 3].map((i) => tooMany("k", 2, 1000, i))).toEqual([false, false, true]);
  expect(tooMany("k", 2, 1000, 5000)).toBe(false);
});
