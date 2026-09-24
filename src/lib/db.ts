import { createClient, type Client, type InValue } from "@libsql/client";

let client: Client | null = null;

export function getClient(): Client {
  if (client) return client;
  const url = import.meta.env.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
  const authToken = import.meta.env.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error("Faltan TURSO_DATABASE_URL o TURSO_AUTH_TOKEN.");
  }
  client = createClient({ url, authToken });
  return client;
}

export type Row = Record<string, unknown>;

export async function all(sql: string, args: InValue[] = []): Promise<Row[]> {
  const rs = await getClient().execute({ sql, args });
  return rs.rows.map((r) => ({ ...r })) as Row[];
}

export async function one(sql: string, args: InValue[] = []): Promise<Row | null> {
  const rows = await all(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InValue[] = []) {
  return getClient().execute({ sql, args });
}

export async function count(sql: string, args: InValue[] = []): Promise<number> {
  const row = await one(sql, args);
  const v = row ? Object.values(row)[0] : 0;
  return Number(v || 0);
}
