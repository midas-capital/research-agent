/**
 * Postgres 接続と run_states テーブルの初期化・操作
 * DATABASE_URL が設定されているときのみ使用する
 */
import pg from "pg";
import type { RunState } from "../types.js";

const { Client } = pg;

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS run_states (
  run_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS run_states_created_at ON run_states ((payload->>'createdAt') DESC);
`;

let client: pg.Client | null = null;
let connected = false;

export function getDbClient(): pg.Client | null {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) return null;
  if (!client) {
    client = new Client({ connectionString: url });
  }
  return client;
}

export async function ensureDbConnected(): Promise<pg.Client | null> {
  const c = getDbClient();
  if (!c) return null;
  if (connected) return c;
  await c.connect();
  connected = true;
  return c;
}

export async function initRunStatesTable(): Promise<void> {
  const c = await ensureDbConnected();
  if (!c) return;
  await c.query(CREATE_TABLE_SQL);
}

export async function readRunStateFromDb(runId: string): Promise<RunState | null> {
  const c = await ensureDbConnected();
  if (!c) return null;
  const r = await c.query("SELECT payload FROM run_states WHERE run_id = $1", [runId]);
  if (r.rows.length === 0) return null;
  return r.rows[0].payload as RunState;
}

export async function writeRunStateToDb(state: RunState): Promise<void> {
  const c = await ensureDbConnected();
  if (!c) return;
  const payload = JSON.stringify(state);
  await c.query(
    `INSERT INTO run_states (run_id, payload) VALUES ($1, $2::jsonb)
     ON CONFLICT (run_id) DO UPDATE SET payload = EXCLUDED.payload`,
    [state.runId, payload]
  );
}

export async function getLatestRunIdFromDb(clientId?: string): Promise<string | null> {
  const c = await ensureDbConnected();
  if (!c) return null;
  const trimmed = clientId?.trim();
  if (trimmed) {
    const r = await c.query(
      `SELECT run_id FROM run_states
       WHERE payload->>'ownerClientId' = $1
       ORDER BY (payload->>'createdAt') DESC NULLS LAST
       LIMIT 1`,
      [trimmed]
    );
    if (r.rows.length === 0) return null;
    return r.rows[0].run_id as string;
  }
  const r = await c.query(
    `SELECT run_id FROM run_states ORDER BY (payload->>'createdAt') DESC NULLS LAST LIMIT 1`
  );
  if (r.rows.length === 0) return null;
  return r.rows[0].run_id as string;
}
