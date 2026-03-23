import fs from "node:fs/promises";
import path from "node:path";
import { getRunStatePath, config } from "../config.js";
import type { RunState } from "../types.js";
import {
  initRunStatesTable,
  readRunStateFromDb,
  writeRunStateToDb,
  getLatestRunIdFromDb,
} from "./db.js";

const useDb = (): boolean => !!process.env.DATABASE_URL?.trim();

export async function readRunState(runId: string): Promise<RunState | null> {
  if (useDb()) {
    return readRunStateFromDb(runId);
  }
  try {
    const p = getRunStatePath(runId);
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as RunState;
  } catch {
    return null;
  }
}

export async function writeRunState(state: RunState): Promise<void> {
  if (useDb()) {
    return writeRunStateToDb(state);
  }
  const p = getRunStatePath(state.runId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(state, null, 2), "utf-8");
}

export async function updateRunState(
  runId: string,
  patch: Partial<Omit<RunState, "runId" | "query" | "createdAt">>
): Promise<void> {
  const current = await readRunState(runId);
  if (!current) return;
  await writeRunState({ ...current, ...patch });
}

/** 直近の runId を取得（DB またはファイル。clientId 指定時はその利用者の Run のみ） */
export async function getLatestRunId(clientId?: string): Promise<string | null> {
  if (useDb()) {
    return getLatestRunIdFromDb(clientId);
  }
  const runsDir = path.join(config.dataDir, "runs");
  try {
    const files = await fs.readdir(runsDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    if (jsonFiles.length === 0) return null;
    const trimmed = clientId?.trim();
    const entries = await Promise.all(
      jsonFiles.map(async (f) => {
        const runId = f.replace(/\.json$/, "");
        const raw = await fs.readFile(path.join(runsDir, f), "utf-8");
        const state = JSON.parse(raw) as RunState;
        return { runId, createdAt: state.createdAt ?? "", ownerClientId: state.ownerClientId };
      })
    );
    let filtered = entries;
    if (trimmed) {
      filtered = entries.filter((e) => e.ownerClientId === trimmed);
    }
    if (filtered.length === 0) return null;
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return filtered[0].runId;
  } catch {
    return null;
  }
}
