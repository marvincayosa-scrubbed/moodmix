import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quotaScript } from "../lib/server";
const exec = promisify(execFile);
test("real Redis: atomic concurrency, read-only usage and rolling expiry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "moodmix-quota-"));
  const socket = join(dir, "redis.sock");
  const server = spawn(
    process.env.REDIS_SERVER || "redis-server",
    ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"],
    { stdio: "ignore" },
  );
  let startupError: Error | undefined;
  server.on("error", (error) => {
    startupError = error;
  });
  const command = async (...args: string[]) =>
    JSON.parse(
      (
        await exec(process.env.REDIS_CLI || "redis-cli", [
          "-s",
          socket,
          "--json",
          ...args,
        ])
      ).stdout,
    );
  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      if (startupError) throw startupError;
      try {
        await command("PING");
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    assert.ok(ready, "Redis must start");
    const now = Date.now();
    const reserve = (key: string, time: number, id: string, write = true) =>
      command(
        "EVAL",
        quotaScript,
        "1",
        key,
        String(time),
        write ? "1" : "0",
        id,
      ) as Promise<number[]>;
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        reserve("concurrent", now, String(i)),
      ),
    );
    assert.equal(results.filter((r) => r[0] === 1).length, 5);
    assert.equal(await command("ZCARD", "concurrent"), 5);
    assert.deepEqual(await reserve("concurrent", now, "read", false), [
      0,
      0,
      now + 86400000,
    ]);
    assert.equal(await command("ZCARD", "concurrent"), 5);
    for (let i = 0; i < 5; i++)
      await reserve("rolling", now + i * 1000, String(i));
    const afterFirstExpiry = await reserve("rolling", now + 86400001, "new");
    assert.deepEqual(afterFirstExpiry, [1, 0, now + 1000 + 86400000]);
    assert.equal((await reserve("rolling", now + 86400001, "blocked"))[0], 0);
    assert.deepEqual(
      await reserve("rolling", now + 3 * 86400000, "read", false),
      [0, 5, 0],
    );
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("close", r));
    await rm(dir, { recursive: true, force: true });
  }
});
