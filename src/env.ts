// Import first: loads sitesight/.env (GEMINI_API_KEY etc.). Variables already set in the shell win.
try {
  process.loadEnvFile();
} catch {} // no .env file: fine
