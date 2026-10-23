import "../src/env.js";
import { createInterface } from "node:readline";
import { AccountError, setAdmin } from "../src/accounts.js";
import { migrate, pool } from "../src/db.js";

// usage: npm run create-admin   (in Docker: docker compose exec -it api npm run create-admin)
// Creates the admin for /suhayb, or gives the existing admin a new password (and signs it out everywhere).
// line by line, so it also works when both answers are piped in at once
const rl = createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q: string) => (process.stdout.write(q), String((await lines.next()).value ?? "").trim());
const email = await ask("Admin email: ");
const pw = await ask("Admin password (at least 10 characters): ");
rl.close();
await migrate();
try {
  await setAdmin(email, pw);
  console.log(`Admin ${email} is ready. Open /suhayb to log in.`);
} catch (e) {
  console.error(e instanceof AccountError ? e.message : e);
  process.exitCode = 1;
}
await pool.end();
