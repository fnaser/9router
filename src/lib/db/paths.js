import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "@/lib/dataDir.js";

export const DB_DIR = path.join(DATA_DIR, "db");
export const DATA_FILE = path.join(DB_DIR, "data.sqlite");
export const BACKUPS_DIR = path.join(DB_DIR, "backups");
export const LEGACY_FILES = {
  main: path.join(DATA_DIR, "db.json"),
  usage: path.join(DATA_DIR, "usage.json"),
  disabled: path.join(DATA_DIR, "disabledModels.json"),
  details: path.join(DATA_DIR, "request-details.json"),
};
// The data dir holds provider OAuth tokens and API keys, so keep it owner-only.
// chmod is a no-op on Windows, where the profile directory is already private.
export function ensureDirs() {
  for (const dir of [DATA_DIR, DB_DIR, BACKUPS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      try { fs.chmodSync(dir, 0o700); } catch { /* not ours to change (e.g. a mounted volume) */ }
    }
  }
}

export function restrictDataFile() {
  if (process.platform === "win32") return;
  for (const file of [DATA_FILE, `${DATA_FILE}-wal`, `${DATA_FILE}-shm`]) {
    try { fs.chmodSync(file, 0o600); } catch { /* missing until SQLite creates it */ }
  }
}
