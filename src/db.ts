import pg from "pg";

// Postgres (DATABASE_URL). Photos and documents stay on disk under DATA_DIR; the database holds their file names.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

// Run at every start: creates what is missing, never drops anything.
// ponytail: "if not exists" only; a real migration tool once columns start changing.
const SCHEMA = `
create table if not exists accounts (
  id text primary key,
  company text not null,
  name text not null,
  email text not null unique, -- stored lower-case
  password text not null, -- scrypt$N$r$p$salt$hash, never the password itself
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  failed_logins int not null default 0,
  locked_until timestamptz
);
create table if not exists sessions (
  token_hash text primary key, -- sha256 of the cookie: a copy of this table cannot log anyone in
  account_id text not null references accounts(id) on delete cascade,
  admin boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_account on sessions(account_id);
create table if not exists projects (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  name text not null,
  location text not null,
  created_at timestamptz not null default now(),
  spec jsonb not null,
  rooms jsonb not null,
  share_token text unique,
  whatsapp jsonb
);
create index if not exists projects_account on projects(account_id);
create table if not exists updates (project_id text not null references projects(id) on delete cascade, id int not null, data jsonb not null, primary key (project_id, id));
create table if not exists issues (project_id text not null references projects(id) on delete cascade, id int not null, data jsonb not null, primary key (project_id, id));
create table if not exists documents (project_id text not null references projects(id) on delete cascade, id int not null, data jsonb not null, primary key (project_id, id));
create table if not exists security_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  account_id text references accounts(id) on delete set null,
  event text not null, -- signup, login, login_failed, locked, password_changed, admin_created, admin_login, admin_login_failed
  ip text
);
create index if not exists security_events_at on security_events(at);
`;

export async function migrate() {
  await pool.query(SCHEMA);
}

export const logEvent = (event: string, accountId: string | null, ip: string | null) =>
  pool.query("insert into security_events (event, account_id, ip) values ($1, $2, $3)", [event, accountId, ip]).catch((e) => console.error("Could not log security event:", e.message));
