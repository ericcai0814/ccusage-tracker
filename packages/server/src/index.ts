import { createApp } from "./app";

const dbPath = process.env.DB_PATH || "data.db";
console.log(`[db] resolved path: ${dbPath}`);

const app = createApp();

const server = Bun.serve({
  fetch: app.fetch,
  port: Number(process.env.PORT) || 3000,
});

console.log(`Server running on port ${server.port}`);
