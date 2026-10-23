import { createHmac } from "node:crypto";
import { expect, test } from "vitest";
import { buildRooms } from "../structure.js";
import type { Project, WhatsApp } from "../types.js";
import { parseWebhook, problemsAnswer, replyMessage, reportDue, reportMessage, validSignature } from "../whatsapp.js";
import { day, issue, upd } from "./helpers.js";

const rooms = buildRooms({ type: "house", levels: [{ floor: 0, rooms: ["Kitchen", "Bathroom"] }], outside: [] });
const project: Project = { id: "ab12cd34", name: "Green Villa", location: "", createdAt: day(0), spec: { type: "house", levels: [], outside: [] }, rooms, shareToken: null };
const wa = (w: Partial<WhatsApp> = {}): WhatsApp => ({ managers: [{ name: "Ravi", phone: "919876543210" }], frequency: "monthly", alerts: true, lastReport: null, sentAlerts: [], ...w });

test("monthly report is due once, after 9 am, for the month just ended", () => {
  const morning = new Date(2026, 10, 1, 9, 30); // 1 Nov
  expect(reportDue(wa(), new Date(2026, 10, 1, 8))).toBeNull();
  const due = reportDue(wa(), morning)!;
  expect(due.key).toBe("2026-10-01");
  expect(due.date.getMonth()).toBe(9); // October
  expect(reportDue(wa({ lastReport: "2026-10-01" }), morning)).toBeNull();
  expect(reportDue(wa({ frequency: "off" }), morning)).toBeNull();
  expect(reportDue(wa({ frequency: "weekly" }), new Date(2026, 10, 4, 10))!.key).toBe("2026-10-26"); // Wed -> last Monday's week
});

test("report template: three params with no newlines, and buttons that carry the project", () => {
  const msg = reportMessage("919876543210", project, [upd(["r1"], "plumbing", day(2))], [], "month", new Date(day(2)));
  const [body, ...buttons] = msg.template.components as any[];
  expect(body.parameters).toHaveLength(3);
  expect(body.parameters.every((x: { text: string }) => !/\n/.test(x.text))).toBe(true);
  expect(body.parameters[1].text).toBe("Monthly report · January 2026");
  expect(buttons.map((b) => b.parameters[0].payload)).toEqual(["ab12cd34:delayed", "ab12cd34:finish", "ab12cd34:problems"]);
});

test("webhook: template button, reply button and typed text", () => {
  const msgs = parseWebhook({ entry: [{ changes: [{ value: { statuses: [{}], messages: [
    { from: "919876543210", type: "button", button: { payload: "ab12cd34:finish", text: "When will it finish?" } },
    { from: "919876543210", type: "interactive", interactive: { button_reply: { id: "ab12cd34:problems" } } },
    { from: "919876543210", type: "text", text: { body: " how is the kitchen? " } },
    { from: "919876543210", type: "button", button: { payload: "ab12cd34:hack" } },
  ] } }] }] });
  expect(msgs.map((m) => m.question)).toEqual(["finish", "problems", null, null]);
  expect(msgs[2]).toMatchObject({ projectId: null, text: "how is the kitchen?" });
  expect(parseWebhook("junk")).toEqual([]);
});

test("signature must match the app secret", () => {
  const raw = Buffer.from('{"entry":[]}');
  const sig = `sha256=${createHmac("sha256", "s3cret").update(raw).digest("hex")}`;
  expect(validSignature(raw, sig, "s3cret")).toBe(true);
  expect(validSignature(raw, sig, "other")).toBe(false);
  expect(validSignature(raw, undefined, "s3cret")).toBe(false);
});

test("problems answer lists open issues, high first", () => {
  const out = problemsAnswer(project, [], [issue({ title: "Paint drip", severity: "low" }), issue({ title: "Leak", severity: "high" }), issue({ title: "Old", status: "resolved" })]);
  expect(out).toMatch(/2 open issues:\n• Leak \(r1, high\)\n• Paint drip/);
  expect(problemsAnswer(project, [], [])).toBe("Green Villa: no open issues.");
});

test("long answers drop the buttons (WhatsApp caps button messages at 1024 characters)", () => {
  expect(replyMessage("1", "ab12cd34", "short").type).toBe("interactive");
  expect(replyMessage("1", "ab12cd34", "x".repeat(1200)).type).toBe("text");
});
