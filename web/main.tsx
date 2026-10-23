import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import { api, useOnline, useRoute } from "./lib";
import { NewProject } from "./NewProject";
import { ProjectPage } from "./Project";
import { FeedbackProvider, Icon } from "./ui";
import { Admin } from "./Admin";

// Viewfinder mark around a house: the app is about photos of the site.
const Mark = () => (
  <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="#ff385c" />
    <path d="M9 13V10.5A1.5 1.5 0 0 1 10.5 9H13M19 9h2.5A1.5 1.5 0 0 1 23 10.5V13M23 19v2.5a1.5 1.5 0 0 1-1.5 1.5H19M13 23h-2.5A1.5 1.5 0 0 1 9 21.5V19" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    <path d="M12.5 19.5v-4l3.5-2.6 3.5 2.6v4" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);
import "./style.css";

type Session = { signedIn: boolean; account: { company: string; name: string; email: string } | null; signupCode: boolean };

function AuthPage({ session, onDone }: { session: Session; onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [f, setF] = useState({ company: "", name: "", email: "", password: "", confirm: "", code: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => (setF({ ...f, [k]: e.target.value }), setErr(""));
  const signup = mode === "signup";

  async function go() {
    if (signup && f.password !== f.confirm) return setErr("The two passwords are not the same");
    setBusy(true);
    try {
      if (signup) await api("/api/signup", { method: "POST", json: { company: f.company, name: f.name, email: f.email, password: f.password, ...(session.signupCode && { code: f.code }) } });
      else await api("/api/login", { method: "POST", json: { email: f.email, password: f.password } });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <form className="card login stack" onSubmit={(e) => (e.preventDefault(), go())}>
      <h1>{signup ? "Create your company account" : "Log in"}</h1>
      <p className="muted">{signup ? "One account per company. Only people who log in to it can see its projects." : "Log in to see your company's projects."}</p>
      {signup && (
        <>
          <label className="field"><span>Company name</span><input value={f.company} onChange={set("company")} maxLength={80} required autoComplete="organization" /></label>
          <label className="field"><span>Your name</span><input value={f.name} onChange={set("name")} maxLength={60} required autoComplete="name" /></label>
        </>
      )}
      <label className="field"><span>Email</span><input type="email" value={f.email} onChange={set("email")} maxLength={200} required autoFocus autoComplete="email" /></label>
      <label className="field">
        <span>Password</span>
        <input type="password" value={f.password} onChange={set("password")} maxLength={200} required minLength={signup ? 10 : undefined} autoComplete={signup ? "new-password" : "current-password"} />
        {signup && <small className="muted">At least 10 characters. A few unrelated words works well.</small>}
      </label>
      {signup && <label className="field"><span>Password again</span><input type="password" value={f.confirm} onChange={set("confirm")} maxLength={200} required autoComplete="new-password" /></label>}
      {signup && session.signupCode && <label className="field"><span>Sign-up code</span><input value={f.code} onChange={set("code")} maxLength={100} required /></label>}
      {err && <p className="callout warn" role="alert">{err}</p>}
      <button className="btn primary big" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Log in"}</button>
      <button type="button" className="btn ghost" onClick={() => (setMode(signup ? "login" : "signup"), setErr(""))}>{signup ? "I already have an account" : "New company? Create an account"}</button>
    </form>
  );
}

function AccountPage({ session, onChange }: { session: Session; onChange: () => void }) {
  const a = session.account!;
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => (setF({ ...f, [k]: e.target.value }), setMsg(null));
  async function change() {
    if (f.next !== f.confirm) return setMsg({ text: "The two new passwords are not the same", ok: false });
    try {
      await api("/api/account/password", { method: "POST", json: { current: f.current, next: f.next } });
      setF({ current: "", next: "", confirm: "" });
      setMsg({ text: "Password changed. Other devices have been signed out.", ok: true });
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    }
  }
  return (
    <div className="page narrow stack">
      <h1>Account</h1>
      <section className="card stack">
        <h2>{a.company}</h2>
        <p className="muted">{a.name} · {a.email}</p>
      </section>
      <form className="card stack" onSubmit={(e) => (e.preventDefault(), change())}>
        <h2>Change password</h2>
        <label className="field"><span>Current password</span><input type="password" value={f.current} onChange={set("current")} required autoComplete="current-password" /></label>
        <label className="field"><span>New password</span><input type="password" value={f.next} onChange={set("next")} required minLength={10} maxLength={200} autoComplete="new-password" /></label>
        <label className="field"><span>New password again</span><input type="password" value={f.confirm} onChange={set("confirm")} required autoComplete="new-password" /></label>
        {msg && <p className={`callout ${msg.ok ? "" : "warn"}`} role="status">{msg.text}</p>}
        <div className="row-actions"><button className="btn primary">Change password</button></div>
      </form>
      <section className="card stack">
        <h2>Signed-in devices</h2>
        <p className="muted">Lost a phone, or logged in on someone else's computer? This signs out every device, including this one.</p>
        <div className="row-actions"><button className="btn ghost danger-text" onClick={() => api("/api/account/logout-everywhere", { method: "POST" }).then(onChange)}>Log out everywhere</button></div>
      </section>
    </div>
  );
}

function App() {
  const [page, a, b] = useRoute();
  const shared = page === "share";
  const [session, setSession] = useState<Session | null>(null);
  const check = () => api<Session>("/api/session").then(setSession, () => setSession({ signedIn: false, account: null, signupCode: false }));
  useEffect(() => {
    void check();
    const on = () => setSession((x) => (x ? { ...x, signedIn: false, account: null } : x));
    addEventListener("sitesight:login", on);
    return () => removeEventListener("sitesight:login", on);
  }, []);
  const online = useOnline();
  const locked = !shared && session && !session.signedIn;
  const logout = () => api("/api/logout", { method: "POST" }).then(check);
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), document.getElementById("main")?.focus())}>Skip to content</a>
      <header className="topbar">
        <a className="brand" href={shared ? location.hash : "#/"}>
          <Mark /> <span>site<b>sight</b></span>
        </a>
        {shared && <span className="chip info"><Icon name="eye" size={14} /> Read-only view</span>}
        <span className="spacer" />
        {!shared && session?.signedIn && page !== "new" && <a className="btn ghost small hide-phone" href="#/new"><Icon name="plus" size={16} /> New project</a>}
        {!shared && session?.account && <a className="btn ghost small account-btn" href="#/account" aria-label={`Account: ${session.account.company}`}><Icon name="user" size={16} /> <span>{session.account.company}</span></a>}
        {!shared && session?.signedIn && <button className="icon-btn" onClick={logout} aria-label="Log out" title="Log out"><Icon name="logout" size={18} /></button>}
      </header>
      {!online && <p className="offline-bar" role="status"><Icon name="wifiOff" size={16} /> No signal. Updates you save stay on this phone and are sent when the signal is back.</p>}
      <main id="main" tabIndex={-1}>
        {!session && !shared ? null : locked ? <div className="page"><AuthPage session={session!} onDone={check} /></div> : page === "account" && session?.account ? <AccountPage session={session} onChange={check} /> : page === "new" ? <NewProject /> : page === "p" && a ? <ProjectPage key={a} id={a} tab={b} /> : shared && a ? <ProjectPage key={a} token={a} tab={b} /> : <Dashboard />}
      </main>
    </>
  );
}

// /suhayb opens the admin page; nothing in the app links to it, and it needs its own admin login
const isAdmin = location.pathname.replace(/\/+$/, "") === "/suhayb";

// Cards light up softly where the pointer is (CSS reads --mx/--my); mouse only, cheap.
addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  const c = (e.target as Element).closest?.<HTMLElement>(".card, .project-card");
  if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty("--mx", `${e.clientX - r.left}px`);
  c.style.setProperty("--my", `${e.clientY - r.top}px`);
});

createRoot(document.getElementById("root")!).render(
  <FeedbackProvider>
    {isAdmin ? <Admin /> : <App />}
  </FeedbackProvider>,
);
