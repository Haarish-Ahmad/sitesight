import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "web",
  plugins: [react()],
  test: { root: "." },
  // trycloudflare: a quick public tunnel for testing WhatsApp links (cloudflared tunnel --url http://localhost:5173)
  server: { allowedHosts: [".trycloudflare.com"], proxy: { "/api": process.env.API_URL ?? "http://localhost:3001" } },
});
