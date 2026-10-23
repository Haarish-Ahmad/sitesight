import { useState } from "react";
import { describeRooms } from "../../src/structure";
import { Layout } from "./Layout";
import { api, go, shareLink, whatsapp } from "../lib";
import { Icon, useFeedback } from "../ui";
import { useProject } from "./common";

export function Settings() {
  const ctx = useProject();
  const { toast, confirm } = useFeedback();
  const p = ctx.data.project;
  const [name, setName] = useState(p.name);
  const [location, setLocation] = useState(p.location);
  const link = shareLink(p.shareToken);

  const call = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      await ctx.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  async function revoke() {
    if (await confirm({ title: "Turn off the share link?", body: "Anyone using the current link will lose access straight away.", confirm: "Turn off link", danger: true }))
      call(() => api(`${ctx.base}/share`, { method: "DELETE" }), "Share link turned off");
  }
  async function remove() {
    const ok = await confirm({ title: "Delete this project?", body: <>This permanently deletes <b>{p.name}</b> with every update, photo, issue and document. It cannot be undone.</>, confirm: "Delete project", danger: true, typeToConfirm: p.name });
    if (!ok) return;
    try {
      await api(ctx.base, { method: "DELETE" });
      toast(`${p.name} deleted`);
      go("/");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div className="settings">
      <section className="card">
        <h2><Icon name="link" /> Read-only share link</h2>
        <p className="muted">Anyone with the link can see the overview, timeline, issues, reports and documents. They cannot upload, approve, change or delete anything, and cannot use the AI chat.</p>
        {link ? (
          <>
            <div className="share-row">
              <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Share link" />
              <button className="btn primary" onClick={() => navigator.clipboard.writeText(link).then(() => toast("Link copied"), () => toast("Copy failed: select the link and copy it", "error"))}><Icon name="copy" size={16} /> Copy</button>
            </div>
            <div className="row-actions">
              <a className="btn ghost small" href={link} target="_blank" rel="noreferrer"><Icon name="eye" size={14} /> Preview as viewer</a>
              <a className="btn ghost small" href={whatsapp(`Progress and photos for ${p.name}: ${link}`)} target="_blank" rel="noreferrer"><Icon name="chat" size={14} /> Send on WhatsApp</a>
              <button className="btn ghost small" onClick={() => call(() => api(`${ctx.base}/share`, { method: "POST" }), "New link created; the old one no longer works")}>Make a new link</button>
              <button className="btn ghost small danger-text" onClick={revoke}>Turn off link</button>
            </div>
          </>
        ) : (
          <button className="btn primary" onClick={() => call(() => api(`${ctx.base}/share`, { method: "POST" }), "Share link created")}><Icon name="link" size={16} /> Create share link</button>
        )}
      </section>

      <WhatsAppCard />

      <section className="card">
        <h2><Icon name="qr" /> Room QR stickers</h2>
        <p className="muted">Print a sticker for each {ctx.apartment ? "flat" : "room"}. Scanning it with a phone camera opens the upload form for that place, so the site team never picks block, floor and flat by hand.</p>
        <a className="btn ghost" href={ctx.href("qr")}><Icon name="printer" size={16} /> Open sticker sheet</a>
      </section>

      <section className="card">
        <h2>Project details</h2>
        <form className="stack" onSubmit={(e) => (e.preventDefault(), call(() => api(ctx.base, { method: "PATCH", json: { name, location } }), "Saved"))}>
          <div className="two">
            <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></label>
            <label className="field"><span>Location</span><input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} /></label>
          </div>
          <p className="muted small">Building: {describeRooms(p.spec.type, p.rooms)}. Change rooms under “Rooms and layout” below.</p>
          <div className="row-actions"><button className="btn primary" disabled={!name.trim() || (name === p.name && location === p.location)}>Save changes</button></div>
        </form>
      </section>

      <Layout />

      <section className="card danger-zone">
        <h2>Delete project</h2>
        <p className="muted">Removes everything for this project, including photos and documents.</p>
        <button className="btn danger" onClick={remove}><Icon name="trash" size={16} /> Delete project…</button>
      </section>
    </div>
  );
}

// Automatic reports and alerts on WhatsApp (src/whatsapp.ts). Each report has three question buttons.
function WhatsAppCard() {
  const ctx = useProject();
  const { toast } = useFeedback();
  const w = ctx.data.project.whatsapp;
  const [managers, setManagers] = useState(w?.managers.length ? w.managers : [{ name: "", phone: "" }]);
  const [frequency, setFrequency] = useState(w?.frequency ?? "monthly");
  const [alerts, setAlerts] = useState(w?.alerts ?? true);
  const set = (i: number, k: "name" | "phone", v: string) => setManagers(managers.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`${ctx.base}/whatsapp`, { method: "PUT", json: { managers: managers.filter((m) => m.phone.trim()), frequency, alerts } });
      toast("WhatsApp settings saved");
      await ctx.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function test() {
    try {
      const r = await api<{ sent: number }>(`${ctx.base}/whatsapp/test`, { method: "POST" });
      toast(`Report sent to ${r.sent} on WhatsApp`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <section className="card">
      <h2><Icon name="chat" /> WhatsApp reports</h2>
      <p className="muted">Managers get the report on WhatsApp with three buttons: what's delayed, when it will finish, and any problems. They can also type a question. Only add people who agreed to get these messages.</p>
      <form className="stack" onSubmit={save}>
        {managers.map((m, i) => (
          <div className="two" key={i}>
            <label className="field"><span>Name</span><input value={m.name} onChange={(e) => set(i, "name", e.target.value)} maxLength={60} /></label>
            <label className="field"><span>WhatsApp number, with country code</span><input type="tel" value={m.phone} onChange={(e) => set(i, "phone", e.target.value)} placeholder="91 98765 43210" /></label>
          </div>
        ))}
        <div className="row-actions">
          {managers.length < 10 && <button type="button" className="btn ghost small" onClick={() => setManagers([...managers, { name: "", phone: "" }])}>Add manager</button>}
          {managers.length > 1 && <button type="button" className="btn ghost small" onClick={() => setManagers(managers.slice(0, -1))}>Remove last</button>}
        </div>
        <div className="two">
          <label className="field"><span>Send the report</span>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
              <option value="monthly">Monthly (on the 1st)</option>
              <option value="weekly">Weekly (on Monday)</option>
              <option value="off">Never</option>
            </select>
          </label>
          <label className="toggle"><input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} /> Also message when an area stalls or falls far behind</label>
        </div>
        <div className="row-actions">
          <button className="btn primary">Save</button>
          {!!w?.managers.length && <button type="button" className="btn ghost" onClick={test}>Send a report now</button>}
        </div>
      </form>
    </section>
  );
}
