import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

// Needs Postgres: DATABASE_URL=postgres://... npx vitest run (skipped without it)
const live = !!process.env.DATABASE_URL;
vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "sitesight-")));
const { migrate, pool } = await import("../db.js");
const db = await import("../projects.js");
const acc = await import("../accounts.js");
const auth = await import("../auth.js");

const email = () => `t${randomBytes(4).toString("hex")}@example.com`;
const spec: import("../structure.js").StructureSpec = { type: "house", levels: [], outside: [] };
beforeAll(async () => live && (await migrate()));
afterAll(() => pool.end());

test.skipIf(!live)("each account sees only its own projects", async () => {
  const a = await acc.createAccount({ company: "A Builders", name: "Ravi", email: email(), password: "green-villa-tiles-9" }, null);
  const b = await acc.createAccount({ company: "B Builders", name: "Asha", email: email(), password: "blue-tower-floors-7" }, null);
  const p = await db.createProject(a, { name: "Villa", location: "", spec, rooms: [] });
  expect((await db.listProjects(a)).map((x) => x.id)).toEqual([p.id]);
  expect(await db.listProjects(b)).toEqual([]);
  expect((await db.ownedProject(p.id, a))?.name).toBe("Villa");
  expect(await db.ownedProject(p.id, b)).toBeNull(); // B cannot open, change or delete A's project
  expect(await db.ownedProject("../etc", a)).toBeNull();

  const ids = [];
  for (const _ of [1, 2]) ids.push(await db.issues.mutate(p.id, (list, next) => (list.push({ id: next } as never), next)));
  expect(ids).toEqual([1, 2]);
  await db.issues.mutate(p.id, (list) => list.splice(0, 1));
  expect((await db.issues.load(p.id)).map((x) => x.id)).toEqual([2]);

  await db.updateProject(p.id, (x) => (x.shareToken = `tok_${randomBytes(6).toString("hex")}`));
  const shared = await db.getProject(p.id);
  expect((await db.findByShareToken(shared!.shareToken!))?.id).toBe(p.id);

  await db.deleteProject(p.id);
  expect(await db.getProject(p.id)).toBeNull();
  expect(await db.issues.load(p.id)).toEqual([]);
});

test.skipIf(!live)("login: same error for unknown email and wrong password; lock after 5 tries", async () => {
  const e = email();
  await acc.createAccount({ company: "C", name: "C", email: e, password: "green-villa-tiles-9" }, null);
  await expect(acc.login("nobody@example.com", "x", false, null)).rejects.toThrow("Wrong email or password");
  await expect(acc.createAccount({ company: "C", name: "C", email: e.toUpperCase(), password: "green-villa-tiles-9" }, null)).rejects.toThrow(/already exists/);
  expect(await acc.login(` ${e.toUpperCase()} `, "green-villa-tiles-9", false, null)).toBeTruthy();
  await expect(acc.login(e, "green-villa-tiles-9", true, null)).rejects.toThrow("Wrong email or password"); // not an admin
  for (let i = 0; i < 4; i++) await expect(acc.login(e, "wrong", false, null)).rejects.toThrow("Wrong email or password");
  await expect(acc.login(e, "wrong", false, null)).rejects.toThrow(/Too many/);
  await expect(acc.login(e, "green-villa-tiles-9", false, null)).rejects.toThrow(/Too many/); // locked even with the right one
});

test.skipIf(!live)("sessions: stored hashed, admin and user sessions do not mix, sign out ends them", async () => {
  const id = await acc.createAccount({ company: "D", name: "D", email: email(), password: "green-villa-tiles-9" }, null);
  const s = await auth.newSession(id, false);
  expect((await auth.sessionAccount(s.token, false))?.id).toBe(id);
  expect(await auth.sessionAccount(s.token, true)).toBeNull();
  const stored = await pool.query("select token_hash from sessions where account_id = $1", [id]);
  expect(stored.rows[0].token_hash).not.toBe(s.token);
  await acc.changePassword(id, "green-villa-tiles-9", "new-green-villa-8", undefined, null);
  expect(await auth.sessionAccount(s.token, false)).toBeNull(); // a new password signs out every device
});

test.skipIf(!live)("admin overview: counts, names and emails, never passwords or content", async () => {
  const e = email();
  const id = await acc.createAccount({ company: "E Homes", name: "Esha", email: e, password: "green-villa-tiles-9" }, null);
  await db.createProject(id, { name: "E Tower", location: "12 Secret Street", spec, rooms: [] });
  const o = await acc.adminOverview();
  const mine = o.accounts.find((a) => a.company === "E Homes")!;
  expect(mine.projects.map((p) => p.name)).toEqual(["E Tower"]);
  expect(mine.email).toBe(e);
  const text = JSON.stringify(o);
  expect(text).not.toContain("scrypt$");
  expect(text).not.toContain("Secret Street");
});
