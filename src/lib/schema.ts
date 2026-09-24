import { count, run } from "./db";
import { hashPassword } from "./auth";

const DDL = `
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT
);
CREATE TABLE IF NOT EXISTS articulos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  descripcion TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL,
  es_tubo INTEGER NOT NULL DEFAULT 0,
  grupo TEXT,
  capacidad TEXT,
  propiedad_default TEXT,
  codigo_proveedor TEXT
);
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE,
  nombre TEXT NOT NULL,
  direccion TEXT,
  telefono TEXT,
  localidad TEXT,
  provincia TEXT,
  cuit TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proveedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  direccion TEXT,
  telefono TEXT,
  cuit TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  clave TEXT NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tubos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  articulo_id INTEGER NOT NULL,
  lote TEXT,
  fecha_vto TEXT,
  estado TEXT NOT NULL,
  cliente_id INTEGER,
  notas TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL,
  actualizado_en TEXT NOT NULL,
  propiedad TEXT NOT NULL DEFAULT 'empresa',
  propietario_cliente_id INTEGER,
  codigo_proveedor TEXT,
  proveedor_id INTEGER
);
CREATE TABLE IF NOT EXISTS movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tubo_id INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL,
  estado_desde TEXT,
  estado_hasta TEXT,
  cliente_id INTEGER,
  articulo_id INTEGER,
  numero TEXT,
  lote TEXT,
  fecha_vto TEXT,
  observaciones TEXT,
  creado_en TEXT NOT NULL,
  usuario_id INTEGER
);
CREATE TABLE IF NOT EXISTS documentos_planta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  proveedor_id INTEGER NOT NULL,
  usuario_id INTEGER,
  remito TEXT,
  fecha TEXT NOT NULL,
  hora TEXT,
  observaciones TEXT,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documento_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  documento_id INTEGER NOT NULL,
  tubo_id INTEGER NOT NULL,
  codigo_leido TEXT,
  lote TEXT
);
CREATE TABLE IF NOT EXISTS repartos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  usuario_id INTEGER,
  creado_por INTEGER,
  estado TEXT NOT NULL DEFAULT 'abierto',
  observaciones TEXT,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reparto_paradas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reparto_id INTEGER NOT NULL,
  cliente_id INTEGER NOT NULL,
  orden INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS reparto_tareas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parada_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  detalle TEXT
);
CREATE INDEX IF NOT EXISTS idx_tubos_estado ON tubos(estado);
CREATE INDEX IF NOT EXISTS idx_tubos_numero ON tubos(numero);
CREATE INDEX IF NOT EXISTS idx_tubos_codprov ON tubos(codigo_proveedor);
CREATE INDEX IF NOT EXISTS idx_art_codprov ON articulos(codigo_proveedor);
CREATE INDEX IF NOT EXISTS idx_mov_fecha ON movimientos(fecha);
`;

let ready = false;

function ahora() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function ensureSchema() {
  if (ready) return;
  for (const stmt of DDL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await run(stmt);
  }
  await run(
    "INSERT INTO config (clave, valor) VALUES ('empresa', 'Gasonor SRL') ON CONFLICT(clave) DO UPDATE SET valor='Gasonor SRL'",
  );
  await run(
    "INSERT OR IGNORE INTO config (clave, valor) VALUES ('titulo_informe', 'Informe de expedición de cilindros')",
  );
  await run("INSERT OR IGNORE INTO config (clave, valor) VALUES ('codigo_informe', 'InfTubo5')");
  await run(
    `INSERT OR IGNORE INTO config (clave, valor) VALUES ('reparto_campos', '{"direccion":true,"telefono":true,"localidad":true,"tubos":true}')`,
  );
  for (const col of [
    "ALTER TABLE articulos ADD COLUMN retener INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE tubos ADD COLUMN retener INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE documento_items ADD COLUMN lote TEXT",
    "ALTER TABLE movimientos ADD COLUMN usuario_id INTEGER",
    "ALTER TABLE reparto_paradas ADD COLUMN completada INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE reparto_paradas ADD COLUMN completada_en TEXT",
    "ALTER TABLE reparto_paradas ADD COLUMN completada_por INTEGER",
    "ALTER TABLE reparto_paradas ADD COLUMN comentario TEXT",
    "ALTER TABLE proveedores ADD COLUMN cuit TEXT",
  ]) {
    try {
      await run(col);
    } catch {
      /* columna ya existe */
    }
  }
  await run("UPDATE usuarios SET rol='despacho' WHERE rol IN ('despacho_total','despacho_general','despacho')");
  const nUsers = await count("SELECT COUNT(*) AS n FROM usuarios");
  if (!nUsers) {
    const t = ahora();
    await run(
      "INSERT INTO usuarios (usuario, clave, nombre, rol, activo, creado_en) VALUES (?,?,?,?,1,?)",
      ["admin", hashPassword("gasonor"), "Administrador", "admin", t],
    );
    await run(
      "INSERT INTO usuarios (usuario, clave, nombre, rol, activo, creado_en) VALUES (?,?,?,?,1,?)",
      ["despacho", hashPassword("despacho"), "Despacho", "despacho", t],
    );
    await run(
      "INSERT INTO usuarios (usuario, clave, nombre, rol, activo, creado_en) VALUES (?,?,?,?,1,?)",
      ["reparto", hashPassword("reparto"), "Reparto", "reparto", t],
    );
    await run(
      "INSERT INTO usuarios (usuario, clave, nombre, rol, activo, creado_en) VALUES (?,?,?,?,1,?)",
      ["cobrador", hashPassword("cobrador"), "Cobrador", "cobrador", t],
    );
  } else {
    const cob = await count("SELECT COUNT(*) AS n FROM usuarios WHERE lower(usuario)='cobrador'");
    if (!cob) {
      await run(
        "INSERT INTO usuarios (usuario, clave, nombre, rol, activo, creado_en) VALUES (?,?,?,?,1,?)",
        ["cobrador", hashPassword("cobrador"), "Cobrador", "cobrador", ahora()],
      );
    }
  }
  const nProv = await count("SELECT COUNT(*) AS n FROM proveedores");
  if (!nProv) {
    await run(
      "INSERT INTO proveedores (nombre, direccion, telefono, activo, creado_en) VALUES (?,?,?,1,?)",
      ["PLANTA PRINCIPAL", "", "", ahora()],
    );
  }
  ready = true;
}
