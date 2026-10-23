import { randomBytes } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DUMMY_HASH, endAllSessions, hashPassword, LOCK_MINUTES, MAX_FAILED, passwordProblem, verifyPassword } from "./auth.js";
import { logEvent, pool } from "./db.js";
import { projectDir } from "./projects.js";

export class AccountError extends Error {}

const normEmail = (e: string) => e.trim().toLowerCase();

export async function createAccount(a: { company: string; name: string; email: string; password: string }, ip: string | null, admin = false) {
  const email = normEmail(a.email);
  const problem = passwordProblem(a.password, email);
  if (problem) throw new AccountError(problem);
  const id = randomBytes(8).toString("hex");
  try {
    await pool.query("insert into accounts (id, company, name, email, password, is_admin) values ($1, $2, $3, $4, $5, $6)", [id, a.company.trim(), a.name.trim(), email, await hashPassword(a.password), admin]);
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new AccountError("An account with this email already exists. Log in instead.");
    throw e;
  }
  await logEvent(admin ? "admin_created" : "signup", id, ip);
  return id;
}

type Row = { id: string; password: string; failed_logins: number; locked_until: Date | null };

// Same message for a wrong email and a wrong password, so nobody can test which emails have accounts.
export async function login(emailRaw: string, password: string, admin: boolean, ip: string | null) {
  const email = normEmail(emailRaw);
  const r = await pool.query<Row>("select id, password, failed_logins, locked_until from accounts where email = $1 and is_admin = $2", [email, admin]);
  const a = r.rows[0];
  if (!a) {
    await verifyPassword(password, DUMMY_HASH);
    await logEvent(admin ? "admin_login_failed" : "login_failed", null, ip);
    throw new AccountError("Wrong email or password");
  }
  if (a.locked_until && a.locked_until > new Date()) throw new AccountError(`Too many wrong passwords. Try again in ${Math.ceil((+a.locked_until - Date.now()) / 60_000)} minutes.`);
  if (!(await verifyPassword(password, a.password))) {
    const failed = a.failed_logins + 1;
    const lock = failed >= MAX_FAILED;
    await pool.query("update accounts set failed_logins = $2, locked_until = $3 where id = $1", [a.id, lock ? 0 : failed, lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null]);
    await logEvent(admin ? "admin_login_failed" : "login_failed", a.id, ip);
    if (lock) await logEvent("locked", a.id, ip);
    throw new AccountError(lock ? `Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes.` : "Wrong email or password");
  }
  await pool.query("update accounts set failed_logins = 0, locked_until = null, last_login_at = now() where id = $1", [a.id]);
  await logEvent(admin ? "admin_login" : "login", a.id, ip);
  return a.id;
}

// A new password signs out every other device.
export async function changePassword(accountId: string, current: string, next: string, keepToken: string | undefined, ip: string | null) {
  const r = await pool.query<{ email: string; password: string }>("select email, password from accounts where id = $1", [accountId]);
  if (!r.rows[0] || !(await verifyPassword(current, r.rows[0].password))) throw new AccountError("Your current password is wrong");
  const problem = passwordProblem(next, r.rows[0].email);
  if (problem) throw new AccountError(problem);
  await pool.query("update accounts set password = $2 where id = $1", [accountId, await hashPassword(next)]);
  await endAllSessions(accountId, keepToken);
  await logEvent("password_changed", accountId, ip);
}

// Admin script: create the admin, or give an existing admin a new password.
export async function setAdmin(email: string, password: string) {
  const r = await pool.query<{ id: string; is_admin: boolean }>("select id, is_admin from accounts where email = $1", [normEmail(email)]);
  if (r.rows[0] && !r.rows[0].is_admin) throw new AccountError("That email belongs to a company account. Use another email for the admin.");
  if (!r.rows[0]) return createAccount({ company: "SiteSight admin", name: "Admin", email, password }, null, true);
  const problem = passwordProblem(password, email);
  if (problem) throw new AccountError(problem);
  await pool.query("update accounts set password = $2, failed_logins = 0, locked_until = null where id = $1", [r.rows[0].id, await hashPassword(password)]);
  await endAllSessions(r.rows[0].id);
  return r.rows[0].id;
}

// ---------- admin overview: who signed up and how much they use, without their content

function dirBytes(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).reduce((n, f) => n + (f.isDirectory() ? dirBytes(join(dir, f.name)) : statSync(join(dir, f.name)).size), 0);
  } catch {
    return 0;
  }
}

export async function adminOverview() {
  const accounts = (await pool.query<{ id: string; company: string; name: string; email: string; created_at: Date; last_login_at: Date | null; locked_until: Date | null; failed_24h: number }>(`
    select a.id, a.company, a.name, a.email, a.created_at, a.last_login_at, a.locked_until,
      (select count(*)::int from security_events e where e.account_id = a.id and e.event = 'login_failed' and e.at > now() - interval '24 hours') as failed_24h
    from accounts a where not a.is_admin order by a.created_at desc`)).rows;
  const projects = (await pool.query<{ id: string; account_id: string; name: string; type: string; created_at: Date; rooms: number; shared: boolean; updates: number; photos: number; open_issues: number; documents: number; last_update: string | null }>(`
    select p.id, p.account_id, p.name, p.spec->>'type' as type, p.created_at, jsonb_array_length(p.rooms) as rooms, p.share_token is not null as shared,
      (select count(*)::int from updates u where u.project_id = p.id) as updates,
      (select coalesce(sum(jsonb_array_length(u.data->'photos')), 0)::int from updates u where u.project_id = p.id) as photos,
      (select count(*)::int from issues i where i.project_id = p.id and i.data->>'status' = 'open') as open_issues,
      (select count(*)::int from documents d where d.project_id = p.id) as documents,
      (select max(u.data->>'at') from updates u where u.project_id = p.id) as last_update
    from projects p order by p.created_at desc`)).rows;
  const ev = (await pool.query<Record<string, number>>(`
    select count(*) filter (where event = 'signup' and at > now() - interval '7 days')::int as signups_7d,
      count(*) filter (where event = 'login_failed' and at > now() - interval '24 hours')::int as failed_24h,
      count(*) filter (where event = 'admin_login_failed' and at > now() - interval '24 hours')::int as admin_failed_24h,
      count(*) filter (where event = 'locked' and at > now() - interval '7 days')::int as locked_7d
    from security_events`)).rows[0];

  const withSize = projects.map((p) => ({ ...p, bytes: dirBytes(projectDir(p.id)) }));
  const now = new Date();
  return {
    totals: {
      accounts: accounts.length,
      projects: projects.length,
      updates: projects.reduce((n, p) => n + p.updates, 0),
      photos: projects.reduce((n, p) => n + p.photos, 0),
      storageMb: Math.round(withSize.reduce((n, p) => n + p.bytes, 0) / 1e5) / 10,
      ...ev,
    },
    // deliberately left out: passwords, sessions, photos, notes, issue text, documents, site addresses, phone numbers, share links
    // (the email is shown in full so the admin can contact the company)
    accounts: accounts.map((a) => ({
      company: a.company,
      manager: a.name,
      email: a.email,
      createdAt: a.created_at.toISOString(),
      lastLoginAt: a.last_login_at?.toISOString() ?? null,
      locked: !!a.locked_until && a.locked_until > now,
      failedLogins24h: a.failed_24h,
      projects: withSize.filter((p) => p.account_id === a.id).map((p) => ({
        name: p.name, type: p.type, createdAt: p.created_at.toISOString(), rooms: p.rooms, updates: p.updates, photos: p.photos,
        openIssues: p.open_issues, documents: p.documents, lastUpdate: p.last_update, shareLinkOn: p.shared, storageMb: Math.round(p.bytes / 1e5) / 10,
      })),
    })),
  };
}
