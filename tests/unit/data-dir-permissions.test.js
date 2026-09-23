import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeAll(async () => {
  tempDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "9router-perms-")), "data");
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(path.dirname(tempDir), { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe.skipIf(process.platform === "win32")("data directory permissions", () => {
  it("keeps the token database readable by its owner only", () => {
    const mode = (p) => fs.statSync(p).mode & 0o777;
    expect(mode(path.join(tempDir, "db"))).toBe(0o700);
    expect(mode(path.join(tempDir, "db", "data.sqlite"))).toBe(0o600);
  });
});
