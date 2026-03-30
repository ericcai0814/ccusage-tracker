import { describe, expect, it } from "bun:test";
import { createApp } from "./app";
import { createDatabase } from "./db";

describe("Server", () => {
  it("should respond to health check", async () => {
    const db = createDatabase(":memory:");
    const app = createApp(db);

    const res = await app.request("/api/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ ok: true, version: "0.1.0" });

    db.close();
  });
});
