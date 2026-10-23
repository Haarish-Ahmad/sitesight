import { createHmac, timingSafeEqual } from "node:crypto";
import { progressAlerts } from "./alerts.js";
import { answerQuestion } from "./chat.js";
import { askEta } from "./eta.js";
import { enoughHistory, MIN_HISTORY_DAYS } from "./finish.js";
import * as db from "./projects.js";
import { buildReport, periodRange, type Period } from "./report.js";
import { needsReview, summarise } from "./summary.js";
import type { Issue, Project, Update, WhatsApp } from "./types.js";

// WhatsApp Cloud API (Meta). Without WHATSAPP_TOKEN + WHATSAPP_PHONE_ID nothing is sent.
const GRAPH = "https://graph.facebook.com/v23.0";
// Both templates are created once with `npm run whatsapp-setup` (category Utility, language en).
// Meta refuses a template body that starts or ends with a variable, hence the fixed words around them.
export const REPORT_TEMPLATE = "sitesight_report";
export const ALERT_TEMPLATE = "sitesight_alert";
export const TEMPLATES = [
  {
    name: REPORT_TEMPLATE,
    body: "Site update for {{1}} · {{2}}\n\n{{3}}\n\nTap a button below to ask about this site.",
    example: ["Green Villa", "Monthly report · October 2026", "Overall progress went from 40% to 55%."],
    buttons: true,
  },
  { name: ALERT_TEMPLATE, body: "SiteSight alert for {{1}}: {{2}}. Reply here to ask about it.", example: ["Green Villa", "Block A, Floor 2: no update for 12 days"], buttons: false },
];
const SEND_HOUR = 9; // reports and alerts go out from 9 am local time, not at midnight
const MAX_ALERTS = 3; // per project per check: each one is a paid message

// The three questions on every report. Reply-button titles are at most 20 characters.
export const QUESTIONS = { delayed: "What's delayed?", finish: "When will it finish?", problems: "Any problems?" } as const;
export type QuestionId = keyof typeof QUESTIONS;
const isQuestion = (q: string): q is QuestionId => q in QUESTIONS;

export const phoneDigits = (s: string) => s.replace(/\D/g, "");
// template parameters may not hold newlines, tabs or long runs of spaces
const param = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const periodOf = (w: WhatsApp): Period | null => (w.frequency === "weekly" ? "week" : w.frequency === "monthly" ? "month" : null);

// ---------- what to send, and when

// The period that has just ended (last week, last month). key: its start date, stored once sent.
export function lastPeriod(period: Period, now: Date) {
  const { from } = periodRange(period, now);
  const date = new Date(+from - 1);
  return { date, key: localDay(periodRange(period, date).from) };
}

export function reportDue(w: WhatsApp, now: Date) {
  const period = periodOf(w);
  if (!period || !w.managers.length || now.getHours() < SEND_HOUR) return null;
  const last = lastPeriod(period, now);
  return last.key === w.lastReport ? null : { period, ...last };
}

export function shareUrl(p: Project) {
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "");
  return base && p.shareToken ? `${base}/#/share/${p.shareToken}/reports` : null;
}

// Template sitesight_report (TEMPLATES above) with three quick-reply buttons.
export function reportMessage(to: string, p: Project, ups: Update[], iss: Issue[], period: Period, date: Date) {
  const r = buildReport(p.rooms, ups, iss, period, date);
  const link = shareUrl(p);
  const text = param(r.narrative.join(" "), link ? 850 - link.length : 850) + (link ? ` Full report with photos: ${link}` : "");
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: REPORT_TEMPLATE,
      language: { code: "en" },
      components: [
        { type: "body", parameters: [param(p.name, 80), r.title, text].map((t) => ({ type: "text", text: t })) },
        // the payload carries the project, so a tap answers about the right site even for a manager of several
        ...Object.keys(QUESTIONS).map((q, i) => ({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload: `${p.id}:${q}` }] })),
      ],
    },
  };
}

// Template: "SiteSight alert for {{1}}: {{2}}. Reply here to ask about it."
export const alertMessage = (to: string, p: Project, text: string) => ({
  messaging_product: "whatsapp",
  to,
  type: "template",
  template: { name: ALERT_TEMPLATE, language: { code: "en" }, components: [{ type: "body", parameters: [param(p.name, 80), param(text, 300)].map((t) => ({ type: "text", text: t })) }] },
});

// A reply inside the 24-hour window (free): the answer, with the three buttons again when it fits.
export function replyMessage(to: string, projectId: string, answer: string) {
  if (answer.length > 1000) return { messaging_product: "whatsapp", to, type: "text", text: { body: answer.slice(0, 4000) } };
  const buttons = Object.entries(QUESTIONS).map(([q, title]) => ({ type: "reply", reply: { id: `${projectId}:${q}`, title } }));
  return { messaging_product: "whatsapp", to, type: "interactive", interactive: { type: "button", body: { text: answer }, action: { buttons } } };
}

// ---------- answers to the three buttons: figures from code, so they are quick and exact

export function delayedAnswer(p: Project, ups: Update[], iss: Issue[], now = new Date()) {
  const { alerts, more } = progressAlerts(p.rooms, summarise(p.rooms, ups, iss), ups, now);
  if (!alerts.length) return `${p.name}: nothing is behind or stalled right now.`;
  return `${p.name}, needs attention:\n${alerts.slice(0, 5).map((a) => `• ${a.label}: ${a.detail}`).join("\n")}${alerts.length + more > 5 ? `\n…and ${alerts.length + more - 5} more in SiteSight.` : ""}`;
}

export function problemsAnswer(p: Project, ups: Update[], iss: Issue[]) {
  const rank = { high: 0, medium: 1, low: 2 };
  const open = iss.filter((i) => i.status === "open").sort((a, b) => rank[a.severity] - rank[b.severity]);
  const review = ups.filter(needsReview).length;
  const lines = open.slice(0, 5).map((i) => `• ${i.title} (${i.scopeLabel}${i.severity === "high" ? ", high" : ""})`);
  const head = open.length ? `${p.name}: ${plural(open.length, "open issue")}:\n${lines.join("\n")}${open.length > 5 ? `\n…and ${open.length - 5} more.` : ""}` : `${p.name}: no open issues.`;
  return review ? `${head}\n${plural(review, "update")} ${review === 1 ? "waits" : "wait"} for review in SiteSight.` : head;
}

export async function finishAnswer(p: Project, ups: Update[], iss: Issue[]) {
  const s = summarise(p.rooms, ups, iss);
  const head = `${p.name} is ${s.progressPct}% complete.`;
  // same rule as the app: no date until about a week of real progress
  if (!enoughHistory(s) && s.roomsDone < s.roomsTotal) return `${head} Not enough history yet for a finish date: it needs about ${MIN_HISTORY_DAYS} days of updates showing rooms moving forward.`;
  const eta = await askEta(p.rooms, s).catch(() => null);
  if (eta) return `${head} About ${plural(eta.etaDays, "day")} left (${eta.confidence} confidence). ${eta.reason}`;
  return `${head} About ${plural(s.etaDays!, "day")} left at the current pace.`;
}

// ---------- incoming (webhook)

export function validSignature(raw: Buffer, header: string | undefined, secret: string) {
  const want = Buffer.from(`sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

export type Incoming = { from: string; projectId: string | null; question: QuestionId | null; text: string };

// Meta posts batches: entry[].changes[].value.messages[]. Delivery receipts (statuses) are ignored.
export function parseWebhook(body: unknown): Incoming[] {
  const out: Incoming[] = [];
  const entries = (body as { entry?: { changes?: { value?: { messages?: any[] } }[] }[] })?.entry ?? [];
  for (const m of entries.flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? [])) {
    if (typeof m?.from !== "string") continue;
    const tap: string | undefined = m.button?.payload ?? m.interactive?.button_reply?.id; // template button / reply button
    const [pid, q] = tap?.split(":") ?? [];
    out.push({ from: phoneDigits(m.from), projectId: tap ? pid : null, question: q && isQuestion(q) ? q : null, text: m.type === "text" ? String(m.text?.body ?? "").trim().slice(0, 500) : "" });
  }
  return out;
}

// phone -> the project it last heard about, so a typed follow-up goes to the same site.
// ponytail: in memory, so after a restart a manager of several projects taps a button once more.
const lastProject = new Map<string, string>();

export async function handleIncoming(m: Incoming) {
  const mine = (await db.listProjects()).filter((p) => p.whatsapp?.managers.some((x) => x.phone === m.from));
  if (!mine.length) return; // not a manager of any project: say nothing, give nothing away
  const p = mine.find((x) => x.id === m.projectId) ?? mine.find((x) => x.id === lastProject.get(m.from)) ?? (mine.length === 1 ? mine[0] : null);
  if (!p) return waSend({ messaging_product: "whatsapp", to: m.from, type: "text", text: { body: `You manage ${mine.map((x) => x.name).join(", ")}. Tap a button on one of their reports first, then ask.` } });
  lastProject.set(m.from, p.id);
  const ups = await db.updates.load(p.id), iss = await db.issues.load(p.id);
  let answer: string;
  if (m.question === "delayed") answer = delayedAnswer(p, ups, iss);
  else if (m.question === "problems") answer = problemsAnswer(p, ups, iss);
  else if (m.question === "finish") answer = await finishAnswer(p, ups, iss);
  else if (m.text) answer = (await answerQuestion(p, ups, iss, m.text)).answer.replace(/\s*\[[UI]\d+\]/g, ""); // record ids mean nothing on a phone
  else answer = "I can only answer typed questions for now. Photos still go in through the SiteSight app.";
  await waSend(replyMessage(m.from, p.id, answer.slice(0, 4000)));
}

// ---------- sending

export const waReady = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

export async function waSend(msg: object) {
  const { WHATSAPP_TOKEN: token, WHATSAPP_PHONE_ID: phone } = process.env;
  if (!token || !phone) return;
  const res = await fetch(`${GRAPH}/${phone}/messages`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(msg) });
  if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

// Creates the two templates in the WhatsApp Business account; ones that already exist are left alone.
export async function createTemplates() {
  const { WHATSAPP_TOKEN: token, WHATSAPP_WABA_ID: waba } = process.env;
  if (!token || !waba) throw new Error("Set WHATSAPP_TOKEN and WHATSAPP_WABA_ID in sitesight/.env first");
  const out: string[] = [];
  for (const t of TEMPLATES) {
    const components: object[] = [{ type: "BODY", text: t.body, example: { body_text: [t.example] } }];
    if (t.buttons) components.push({ type: "BUTTONS", buttons: Object.values(QUESTIONS).map((text) => ({ type: "QUICK_REPLY", text })) });
    const res = await fetch(`${GRAPH}/${waba}/message_templates`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: t.name, language: "en", category: "UTILITY", components }) });
    const r = (await res.json()) as { status?: string; error?: { message?: string; error_user_msg?: string; code?: number } };
    out.push(res.ok ? `${t.name}: ${r.status ?? "submitted"}` : /already exists|duplicate/i.test(JSON.stringify(r.error)) ? `${t.name}: already exists` : `${t.name}: failed (${r.error?.error_user_msg ?? r.error?.message})`);
  }
  return out;
}

export async function sendReport(p: Project, period: Period, date: Date) {
  const ups = await db.updates.load(p.id), iss = await db.issues.load(p.id);
  for (const m of p.whatsapp?.managers ?? []) {
    await waSend(reportMessage(m.phone, p, ups, iss, period, date));
    lastProject.set(m.phone, p.id);
  }
}

// Run every hour by the server: due reports, then new high-severity alerts.
export async function tick(now = new Date()) {
  if (!waReady()) return; // not connected: leave lastReport alone, so the report goes once it is
  for (const p of await db.listProjects()) {
    const w = p.whatsapp;
    if (!w?.managers.length) continue;
    try {
      const due = reportDue(w, now);
      if (due) {
        await sendReport(p, due.period, due.date);
        await db.updateProject(p.id, (x) => (x.whatsapp!.lastReport = due.key));
      }
      if (!w.alerts || now.getHours() < SEND_HOUR) continue;
      const ups = await db.updates.load(p.id);
      const active = progressAlerts(p.rooms, summarise(p.rooms, ups, await db.issues.load(p.id)), ups, now).alerts.filter((a) => a.severity === "high");
      const key = (a: { kind: string; key: string }) => `${a.kind}:${a.key}`;
      const fresh = active.filter((a) => !w.sentAlerts.includes(key(a))).slice(0, MAX_ALERTS);
      for (const a of fresh) for (const m of w.managers) await waSend(alertMessage(m.phone, p, `${a.label}: ${a.detail}`));
      // only alerts still active are remembered, so one that clears and comes back is sent again
      await db.updateProject(p.id, (x) => (x.whatsapp!.sentAlerts = active.filter((a) => fresh.includes(a) || w.sentAlerts.includes(key(a))).map(key)));
    } catch (e) {
      console.error(`WhatsApp for ${p.name} failed:`, e instanceof Error ? e.message : e);
    }
  }
}
