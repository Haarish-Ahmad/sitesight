import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { pool } from "./db.js";

// ---------- passwords: scrypt with a random salt per password (OWASP: N=2^15, r=8, p=3)

const N = 2 ** 15, R = 8, P = 3, KEY = 64;
const derive = (pw: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((ok, bad) => scrypt(pw.normalize("NFKC"), salt, KEY, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? bad(e) : ok(k))));

// The stored string carries its own settings, so they can be raised later without breaking old passwords.
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${(await derive(pw, salt, N, R, P)).toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await derive(pw, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  return got.length === want.length && timingSafeEqual(got, want);
}
// Checked against when the email is unknown, so a wrong email takes as long as a wrong password.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString("hex"));

export function passwordProblem(pw: string, email: string) {
  if (pw.length < 10) return "Use at least 10 characters";
  if (pw.length > 200) return "Use at most 200 characters";
  const user = email.split("@")[0].toLowerCase();
  if (user.length >= 4 && pw.toLowerCase().includes(user)) return "Do not put your email name in the password";
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password|qwerty)/i.test(pw)) return "That password is too easy to guess";
  return null;
}

// ---------- sessions: random token in an HttpOnly cookie; the database keeps only its sha256

export const USER_COOKIE = "ss_session";
export const ADMIN_COOKIE = "ss_admin";
export const USER_DAYS = 7;
export const ADMIN_HOURS = 2;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function newSession(accountId: string, admin: boolean) {
  const token = randomBytes(32).toString("base64url");
  const ms = admin ? ADMIN_HOURS * 3600_000 : USER_DAYS * 86_400_000;
  await pool.query("insert into sessions (token_hash, account_id, admin, expires_at) values ($1, $2, $3, $4)", [hashToken(token), accountId, admin, new Date(Date.now() + ms)]);
  await pool.query("delete from sessions where expires_at < now()"); // tidy up old ones
  return { token, maxAge: ms / 1000 };
}

export type Account = { id: string; company: string; name: string; email: string };
export async function sessionAccount(token: string | undefined, admin: boolean): Promise<Account | null> {
  if (!token || token.length > 100) return null;
  const r = await pool.query<Account>(
    "select a.id, a.company, a.name, a.email from sessions s join accounts a on a.id = s.account_id where s.token_hash = $1 and s.admin = $2 and a.is_admin = $2 and s.expires_at > now()",
    [hashToken(token), admin],
  );
  return r.rows[0] ?? null;
}
export const endSession = (token: string | undefined) => (token ? pool.query("delete from sessions where token_hash = $1", [hashToken(token)]) : null);
export const endAllSessions = (accountId: string, except?: string) => pool.query("delete from sessions where account_id = $1 and token_hash <> $2", [accountId, except ? hashToken(except) : ""]);

export const readCookie = (header: string | undefined, name: string) =>
  header?.split(";").map((c) => c.trim().split("=")).find(([k]) => k === name)?.[1];
// admin cookie only travels to /api/admin, so the rest of the app never sees it
export const cookie = (name: string, token: string, maxAge: number, secure: boolean) =>
  `${name}=${token}; HttpOnly; SameSite=Strict; Path=${name === ADMIN_COOKIE ? "/api/admin" : "/"}; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
export const clearCookie = (name: string) => cookie(name, "", 0, false);

// ---------- lockout and rate limits

export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;

// ponytail: in memory, per process; fine for one API container, Redis if there are several.
const hits = new Map<string, number[]>();
export function tooMany(key: string, max: number, windowMs: number, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 50_000) for (const [k, v] of hits) if (now - v[v.length - 1] > windowMs) hits.delete(k);
  return recent.length > max;
}
