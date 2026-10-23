import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pool, tx } from "./db.js";
import type { Doc, Issue, Project, Update } from "./types.js";

// Projects, updates, issues and documents in Postgres; photo and document files on disk.
const root = () => join(process.env.DATA_DIR ?? "data", "projects");
export const projectDir = (id: string) => join(root(), id);
export const photoPath = (id: string, file: string) => join(projectDir(id), "photos", file);
export const docPath = (id: string, file: string) => join(projectDir(id), "docs", file);

const VALID_ID = /^[a-f0-9]{8}$/;
export const isProjectId = (id: string) => VALID_ID.test(id);

type Row = { id: string; name: string; location: string; created_at: Date; spec: Project["spec"]; rooms: Project["rooms"]; share_token: string | null; whatsapp: Project["whatsapp"] | null };
const COLS = "id, name, location, created_at, spec, rooms, share_token, whatsapp";
const toProject = (r: Row): Project => ({
  id: r.id, name: r.name, location: r.location, createdAt: r.created_at.toISOString(), spec: r.spec, rooms: r.rooms, shareToken: r.share_token, ...(r.whatsapp && { whatsapp: r.whatsapp }),
});

// accountId given: only that account's projects. Without it (background jobs only): every project.
export async function listProjects(accountId?: string): Promise<Project[]> {
  const r = accountId
    ? await pool.query<Row>(`select ${COLS} from projects where account_id = $1 order by created_at desc`, [accountId])
    : await pool.query<Row>(`select ${COLS} from projects order by created_at desc`);
  return r.rows.map(toProject);
}
export async function getProject(id: string): Promise<Project | null> {
  if (!isProjectId(id)) return null;
  const r = await pool.query<Row>(`select ${COLS} from projects where id = $1`, [id]);
  return r.rows[0] ? toProject(r.rows[0]) : null;
}
// The project, only if this account owns it. Every signed-in project route goes through here.
export async function ownedProject(id: string, accountId: string): Promise<Project | null> {
  if (!isProjectId(id)) return null;
  const r = await pool.query<Row>(`select ${COLS} from projects where id = $1 and account_id = $2`, [id, accountId]);
  return r.rows[0] ? toProject(r.rows[0]) : null;
}

export async function createProject(accountId: string, p: Omit<Project, "id" | "createdAt" | "shareToken">): Promise<Project> {
  const id = randomBytes(4).toString("hex");
  const r = await pool.query<Row>(`insert into projects (id, account_id, name, location, spec, rooms) values ($1, $2, $3, $4, $5, $6) returning ${COLS}`, [id, accountId, p.name, p.location, JSON.stringify(p.spec), JSON.stringify(p.rooms)]);
  for (const d of ["photos", "docs"]) mkdirSync(join(projectDir(id), d), { recursive: true });
  return toProject(r.rows[0]);
}

// Load, change in place, save, with the project row locked so two requests cannot overwrite each other.
export async function updateProject(id: string, fn: (p: Project) => void): Promise<Project> {
  return tx(async (c) => {
    const r = await c.query<Row>(`select ${COLS} from projects where id = $1 for update`, [id]);
    if (!r.rows[0]) throw new Error(`No project ${id}`);
    const p = toProject(r.rows[0]);
    fn(p);
    await c.query("update projects set name = $2, location = $3, spec = $4, rooms = $5, share_token = $6, whatsapp = $7 where id = $1", [id, p.name, p.location, JSON.stringify(p.spec), JSON.stringify(p.rooms), p.shareToken, p.whatsapp ? JSON.stringify(p.whatsapp) : null]);
    return p;
  });
}
export async function deleteProject(id: string) {
  await pool.query("delete from projects where id = $1", [id]); // updates, issues and documents go with it
  rmSync(projectDir(id), { recursive: true, force: true });
}
export async function findByShareToken(token: string): Promise<Project | null> {
  const r = await pool.query<Row>(`select ${COLS} from projects where share_token = $1`, [token]);
  return r.rows[0] ? toProject(r.rows[0]) : null;
}

// The three lists share one shape: load, change in place, save. Returns whatever fn returns.
// One row per item; only rows that changed are written.
function mutator<T extends { id: number }>(table: "updates" | "issues" | "documents") {
  const load = async (id: string, c: { query: typeof pool.query } = pool) => (await c.query<{ data: T }>(`select data from ${table} where project_id = $1 order by id`, [id])).rows.map((r) => r.data);
  return {
    load: (id: string) => load(id),
    mutate<R>(id: string, fn: (list: T[], nextId: number) => R): Promise<R> {
      return tx(async (c) => {
        await c.query("select 1 from projects where id = $1 for update", [id]);
        const list = await load(id, c as never);
        const before = new Map(list.map((x) => [x.id, JSON.stringify(x)]));
        const out = fn(list, Math.max(0, ...list.map((x) => x.id)) + 1);
        const kept = new Set(list.map((x) => x.id));
        const gone = [...before.keys()].filter((k) => !kept.has(k));
        if (gone.length) await c.query(`delete from ${table} where project_id = $1 and id = any($2)`, [id, gone]);
        for (const x of list) {
          const json = JSON.stringify(x);
          if (before.get(x.id) !== json) await c.query(`insert into ${table} (project_id, id, data) values ($1, $2, $3) on conflict (project_id, id) do update set data = excluded.data`, [id, x.id, json]);
        }
        return out;
      });
    },
  };
}
export const updates = mutator<Update>("updates");
export const issues = mutator<Issue>("issues");
export const docs = mutator<Doc>("documents");
