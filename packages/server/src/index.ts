import app from "./app";

const server = Bun.serve({
  fetch: app.fetch,
  port: Number(process.env.PORT) || 3000,
});

console.log(`Server running on port ${server.port}`);
