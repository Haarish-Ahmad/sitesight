import { useEffect, useState } from "react";
import { api } from "./lib";
import { Icon } from "./ui";

// The admin page at /suhayb: who signed up and how much they use SiteSight.
// It shows names, emails and counts; the server never sends passwords, photos, notes or site addresses.
type Project = { name: string; type: string; createdAt: string; rooms: number; updates: number; photos: number; openIssues: number; documents: number; lastUpdate: string | null; shareLinkOn: boolean; storageMb: number };
type Account = { company: string; manager: string; email: string; createdAt: string; lastLoginAt: string | null; locked: boolean; failedLogins24h: number; projects: Project[] };
type Overview = {
  totals: { accounts: number; projects: number; updates: number; photos: number; storageMb: number; signups_7d: number; failed_24h: number; admin_failed_24h: number; locked_7d: number };
  accounts: Account[];
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "never");

function AdminLogin({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  async function go() {
    try {
      await api("/api/admin/login", { method: "POST", json: f });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <form className="card login stack" onSubmit={(e) => (e.preventDefault(), go())}>
      <h1>Admin</h1>
      <label className="field"><span>Admin email</span><input type="email" value={f.email} onChange={(e) => (setF({ ...f, email: e.target.value }), setErr(""))} required autoFocus autoComplete="username" /></label>
      <label className="field"><span>Password</span><input type="password" value={f.password} onChange={(e) => (setF({ ...f, password: e.target.value }), setErr(""))} required autoComplete="current-password" /></label>
      {err && <p className="callout warn" role="alert">{err}</p>}
      <button className="btn primary">Log in</button>
    </form>
  );
}

export function Admin() {
  const [data, setData] = useState<Overview | null | "login">(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => api<Overview>("/api/admin/overview").then(setData, () => setData("login"));
  useEffect(() => void load(), []);
  const logout = () => api("/api/admin/logout", { method: "POST" }).then(() => setData("login"));

  if (data === null)
    return (
      <main className="page wide" aria-busy="true" aria-label="Loading">
        <div className="skeleton line" />
        <div className="stats admin-stats">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton stat-sk" />)}</div>
        <div className="skeleton tall" />
      </main>
    );
  if (data === "login") return <main className="page"><AdminLogin onDone={load} /></main>;
  const t = data.totals;
  const stats: [string, number | string, string?][] = [
    ["Companies", t.accounts], ["Projects", t.projects], ["Updates", t.updates], ["Photos", t.photos], ["Storage", `${t.storageMb} MB`],
    ["New sign-ups, 7 days", t.signups_7d], ["Failed logins, 24 h", t.failed_24h, t.failed_24h > 20 ? "warn" : undefined],
    ["Failed admin logins, 24 h", t.admin_failed_24h, t.admin_failed_24h ? "bad" : undefined], ["Accounts locked, 7 days", t.locked_7d, t.locked_7d ? "warn" : undefined],
  ];
  return (
    <main className="page wide stack">
      <div className="page-head">
        <div>
          <h1>SiteSight admin</h1>
          <p className="muted">Usage only. Passwords, photos, notes and site addresses are never shown here.</p>
        </div>
        <div className="row-actions">
          <button className="btn ghost small" onClick={load}>Refresh</button>
          <button className="btn ghost small" onClick={logout}><Icon name="logout" size={16} /> Log out</button>
        </div>
      </div>
      <div className="stats admin-stats">
        {stats.map(([label, value, cls]) => (
          <div key={label} className={`card stat ${cls ?? ""}`}><small>{label}</small><b>{value}</b></div>
        ))}
      </div>
      <section className="card">
        <h2>Companies</h2>
        {!data.accounts.length ? <p className="muted">No company has signed up yet.</p> : (
          <div className="table-wrap">
            <table className="table cards-phone">
              <thead><tr><th>Company</th><th>Manager</th><th>Email</th><th>Joined</th><th>Last login</th><th className="num">Projects</th><th className="num">Photos</th><th>Status</th></tr></thead>
              <tbody>
                {data.accounts.map((a, i) => {
                  const key = `${i}`;
                  return [
                    <tr key={key} className={open === key ? "open" : ""}>
                      <td className="lead-cell">
                        <button className="plain-link expand" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                          <Icon name={open === key ? "minus" : "plus"} size={14} /> <b>{a.company}</b>
                        </button>
                      </td>
                      <td data-label="Manager">{a.manager}</td><td data-label="Email" className="email">{a.email}</td><td data-label="Joined">{day(a.createdAt)}</td><td data-label="Last login">{day(a.lastLoginAt)}</td>
                      <td data-label="Projects" className="num">{a.projects.length}</td><td data-label="Photos" className="num">{a.projects.reduce((n, p) => n + p.photos, 0)}</td>
                      <td data-label="Status">{a.locked ? <span className="chip bad">Locked</span> : a.failedLogins24h >= 3 ? <span className="chip warn">{a.failedLogins24h} failed logins</span> : <span className="chip good">OK</span>}</td>
                    </tr>,
                    open === key && (
                      <tr key={`${key}-p`} className="sub">
                        <td colSpan={8}>
                          {!a.projects.length ? <p className="muted">No projects yet.</p> : (
                            <table className="table cards-phone">
                              <thead><tr><th>Project</th><th>Type</th><th>Created</th><th className="num">Rooms</th><th className="num">Updates</th><th className="num">Photos</th><th className="num">Open issues</th><th className="num">Documents</th><th>Last update</th><th>Share link</th><th className="num">Storage</th></tr></thead>
                              <tbody>
                                {a.projects.map((p, j) => (
                                  <tr key={j}>
                                    <td className="lead-cell"><b>{p.name}</b></td><td data-label="Type">{p.type}</td><td data-label="Created">{day(p.createdAt)}</td><td data-label="Rooms" className="num">{p.rooms}</td><td data-label="Updates" className="num">{p.updates}</td><td data-label="Photos" className="num">{p.photos}</td>
                                    <td data-label="Open issues" className="num">{p.openIssues}</td><td data-label="Documents" className="num">{p.documents}</td><td data-label="Last update">{day(p.lastUpdate)}</td><td data-label="Share link">{p.shareLinkOn ? "On" : "Off"}</td><td data-label="Storage" className="num">{p.storageMb} MB</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
