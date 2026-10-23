import "../src/env.js";
import { pool } from "../src/db.js";
import * as db from "../src/projects.js";
import { createTemplates, lastPeriod, phoneDigits, sendReport, waReady } from "../src/whatsapp.js";

// usage (in Docker: docker compose exec api npm run whatsapp-setup -- [number]):
//   npm run whatsapp-setup                 creates the two message templates (once; Meta approves them, usually in minutes)
//   npm run whatsapp-setup -- 919876543210  demo: that number becomes the manager of EVERY project (weekly report + alerts),
//                                           and each project's report is sent to it now
const phone = phoneDigits(process.argv[2] ?? "");
for (const line of await createTemplates()) console.log(line);
if (phone) {
  if (!/^\d{11,15}$/.test(phone)) throw new Error("Give the number with its country code, e.g. 919876543210");
  if (!waReady()) throw new Error("Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID in sitesight/.env first");
  for (const p of await db.listProjects()) {
    const q = await db.updateProject(p.id, (x) => {
      const managers = x.whatsapp?.managers.filter((m) => m.phone !== phone) ?? [];
      x.whatsapp = { managers: [...managers, { name: "Demo", phone }], frequency: "weekly", alerts: true, lastReport: lastPeriod("week", new Date()).key, sentAlerts: x.whatsapp?.sentAlerts ?? [] };
    });
    try {
      await sendReport({ ...q, whatsapp: { ...q.whatsapp!, managers: [{ name: "Demo", phone }] } }, "week", new Date());
      console.log(`${p.name}: report sent`);
    } catch (e) {
      console.log(`${p.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
await pool.end();
