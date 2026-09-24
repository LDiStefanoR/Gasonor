import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { DatabaseSync } from "node:sqlite";

const root = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(root, "..", ".env");
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const schemaTs = readFileSync(resolve(root, "..", "src", "lib", "schema.ts"), "utf8");
const ddlMatch = schemaTs.match(/const DDL = `([\s\S]*?)`;/);
if (!ddlMatch) {
  console.error("No se pudo leer el esquema.");
  process.exit(1);
}

const sqlitePath = resolve(root, "..", "..", "..", "data", "gaschor.db");
if (!existsSync(sqlitePath)) {
  console.error("No está data/gaschor.db. Abrí primero el sistema local (start.bat) para generar la base.");
  process.exit(1);
}

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error("Faltan TURSO_DATABASE_URL o TURSO_AUTH_TOKEN en .env");
  process.exit(1);
}

const TABLES = [
  "config",
  "articulos",
  "clientes",
  "proveedores",
  "usuarios",
  "tubos",
  "movimientos",
  "documentos_planta",
  "documento_items",
  "repartos",
  "reparto_paradas",
  "reparto_tareas",
];

const sqlite = new DatabaseSync(sqlitePath);
const turso = createClient({ url, authToken });

function colsOf(table) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

async function batchInsert(table, cols, rows) {
  const placeholders = cols.map(() => "?").join(",");
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`;
  const chunk = 80;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    await turso.batch(
      slice.map((row) => ({
        sql,
        args: cols.map((c) => (row[c] === undefined ? null : row[c])),
      })),
      "write",
    );
    process.stdout.write(`  ${table}: ${Math.min(i + chunk, rows.length)}/${rows.length}\r`);
  }
  console.log(`  ${table}: ${rows.length} filas`);
}

const nArt = sqlite.prepare("SELECT COUNT(*) AS n FROM articulos").get().n;
console.log(`SQLite: ${sqlitePath}`);
console.log(`Artículos en origen: ${nArt}`);
console.log("Subiendo a Turso…");

for (const stmt of ddlMatch[1].split(";").map((s) => s.trim()).filter(Boolean)) {
  await turso.execute(stmt);
}

await turso.execute("PRAGMA foreign_keys = OFF");
for (const table of [...TABLES].reverse()) {
  try {
    await turso.execute(`DELETE FROM ${table}`);
  } catch {
    /* tabla aún no existe en Turso: se crea en el primer login */
  }
}

for (const table of TABLES) {
  try {
    sqlite.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  } catch {
    console.log(`  ${table}: no está en SQLite, se omite`);
    continue;
  }
  const cols = colsOf(table);
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  if (!rows.length) {
    console.log(`  ${table}: 0 filas`);
    continue;
  }
  await batchInsert(table, cols, rows);
}

await turso.execute("PRAGMA foreign_keys = ON");
console.log("Listo. Los usuarios y el catálogo ya están en Turso.");
