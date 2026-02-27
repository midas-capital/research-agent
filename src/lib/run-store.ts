import fs from "node:fs/promises";
import path from "node:path";
import { getRunStatePath } from "../config.js";
import type { RunState } from "../types.js";

export async function readRunState(runId: string): Promise<RunState | null> {
  try {
    const p = getRunStatePath(runId);
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as RunState;
  } catch {
    return null;
  }
}

export async function writeRunState(state: RunState): Promise<void> {
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
