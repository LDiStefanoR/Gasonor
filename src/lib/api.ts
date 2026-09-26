import type { APIContext } from "astro";
import { all, count, one, run } from "./db";
import {
  clearSession,
  hashPassword,
  puede,
  puedeConceptos,
  ROLES,
  ROLES_INFO,
  setSession,
  usuarioSesion,
  verifyPassword,
  type Usuario,
} from "./auth";
import { ensureSchema } from "./schema";
import { ensureCaja, handleCaja } from "./caja";

const ESTADOS = ["vacio", "en_planta", "cargado", "en_cliente"] as const;
const CAMPOS_REPARTO = ["direccion", "telefono", "localidad", "tubos"] as const;
const TAREAS = ["recarga_propios", "recambio_gn", "retiro_equipo", "entrega_equipo", "tarea"];
const TRANS: Record<string, [string, string, string]> = {
  "enviar-planta": ["vacio", "en_planta", "PLANSALI"],
  "recibir-planta": ["en_planta", "cargado", "PLANENTR"],
  "cargar-empresa": ["vacio", "cargado", "CARGA"],
  "enviar-cliente": ["cargado", "en_cliente", "TRANSALI"],
  "recibir-cliente": ["en_cliente", "vacio", "TRANSENT"],
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function err(mensaje: string, codigo = 400) {
  return json({ ok: false, error: mensaje }, codigo);
}

function ahora() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function hoy() {
  return ahora().slice(0, 10);
}

function parseFecha(valor?: string | null) {
  if (!valor) return hoy();
  const v = String(valor).trim();
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (dmy) {
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${y}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return hoy();
}

async function body(ctx: APIContext) {
  try {
    return (await ctx.request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function fetchTubos(extra = "", args: (string | number | null)[] = []) {
  return all(
    `SELECT t.*, a.codigo AS articulo_codigo, a.descripcion AS articulo_descripcion,
            a.es_tubo AS articulo_es_tubo, a.codigo_proveedor AS articulo_codigo_proveedor,
            a.grupo, a.capacidad, IFNULL(a.retener, 0) AS articulo_retener,
            c.nombre AS cliente_nombre, p.nombre AS proveedor_nombre,
            COALESCE(NULLIF(TRIM(IFNULL(t.codigo_proveedor,'')), ''), a.codigo_proveedor) AS codigo_proveedor_mostrar,
            (SELECT COALESCE(m.creado_en, m.fecha) FROM movimientos m
             WHERE m.tubo_id=t.id ORDER BY m.id DESC LIMIT 1) AS ultimo_movimiento,
            (SELECT m.tipo FROM movimientos m
             WHERE m.tubo_id=t.id ORDER BY m.id DESC LIMIT 1) AS ultimo_movimiento_tipo,
            (SELECT m.fecha FROM movimientos m
             WHERE m.tubo_id=t.id AND m.tipo='PLANSALI' ORDER BY m.id DESC LIMIT 1) AS fecha_envio_planta
     FROM tubos t
     JOIN articulos a ON a.id = t.articulo_id
     LEFT JOIN clientes c ON c.id = t.cliente_id
     LEFT JOIN proveedores p ON p.id = t.proveedor_id
     ${extra}`,
    args,
  );
}

async function registrarMovimiento(
  tubo: Record<string, unknown>,
  tipo: string,
  estadoDesde: string | null,
  estadoHasta: string | null,
  fecha: string,
  extra: {
    cliente_id?: number | null;
    lote?: string;
    fecha_vto?: string;
    observaciones?: string;
    usuario_id?: number | null;
  } = {},
) {
  await run(
    `INSERT INTO movimientos (
      tubo_id, fecha, tipo, estado_desde, estado_hasta, cliente_id,
      articulo_id, numero, lote, fecha_vto, observaciones, creado_en, usuario_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      Number(tubo.id),
      fecha,
      tipo,
      estadoDesde,
      estadoHasta,
      extra.cliente_id ?? null,
      Number(tubo.articulo_id),
      String(tubo.numero),
      extra.lote ?? (tubo.lote as string) ?? null,
      extra.fecha_vto ?? (tubo.fecha_vto as string) ?? null,
      extra.observaciones || "",
      ahora(),
      extra.usuario_id ?? null,
    ],
  );
}

async function buscarTubo(codigo: string, modo?: string, proveedorId?: unknown) {
  codigo = codigo.trim().toUpperCase();
  if (!codigo) return null;
  const sin0 = codigo.replace(/^0+/, "") || codigo;
  let rows = await all(
    `SELECT t.id, t.estado, t.proveedor_id FROM tubos t
     WHERE t.activo=1 AND (
       UPPER(TRIM(IFNULL(t.codigo_proveedor,'')))=? OR UPPER(TRIM(t.numero))=?
       OR LTRIM(UPPER(TRIM(IFNULL(t.codigo_proveedor,''))), '0')=?
       OR LTRIM(UPPER(TRIM(t.numero)), '0')=?
     )`,
    [codigo, codigo, sin0, sin0],
  );
  if (!rows.length) {
    const row = await one(
      `SELECT t.id, t.estado, t.proveedor_id FROM documento_items i
       JOIN documentos_planta d ON d.id=i.documento_id JOIN tubos t ON t.id=i.tubo_id
       WHERE t.activo=1 AND d.tipo='despacho' AND (
         UPPER(TRIM(IFNULL(i.codigo_leido,'')))=?
         OR LTRIM(UPPER(TRIM(IFNULL(i.codigo_leido,''))), '0')=?
       )
       ORDER BY i.id DESC LIMIT 1`,
      [codigo, sin0],
    );
    rows = row ? [row] : [];
  }
  if (!rows.length) return null;
  let row = rows[0];
  if (modo === "recepcion") {
    const enPlanta = rows.filter((r) => String(r.estado) === "en_planta");
    if (enPlanta.length) {
      if (proveedorId) {
        const mismo = enPlanta.filter(
          (r) => r.proveedor_id != null && Number(r.proveedor_id) === Number(proveedorId),
        );
        row = (mismo[0] || enPlanta[0]) as typeof row;
      } else {
        row = enPlanta[0] as typeof row;
      }
    }
  }
  const tubos = await fetchTubos("WHERE t.id=?", [Number(row.id)]);
  return tubos[0] || null;
}

function idsFrom(data: Record<string, unknown>) {
  const raw = (data.tubo_ids || data.ids || []) as unknown[];
  return raw.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

export async function handleApi(ctx: APIContext) {
  try {
    return await handleApiInner(ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api]", ctx.request.method, ctx.url.pathname, msg);
    if (/TURSO_|Faltan TURSO/i.test(msg)) {
      return err("Base de datos no configurada en el servidor. Faltan variables Turso.", 503);
    }
    return err("Error interno del servidor.", 500);
  }
}

async function handleApiInner(ctx: APIContext) {
  await ensureSchema();
  await ensureCaja();
  const method = ctx.request.method.toUpperCase();
  const path = ctx.url.pathname.replace(/\/$/, "") || "/";
  const q = ctx.url.searchParams;
  const u = await usuarioSesion(ctx);

  const publicos = new Set(["POST /api/login", "GET /api/sesion"]);
  const key = `${method} ${path}`;
  if (!publicos.has(key) && path.startsWith("/api/") && method !== "OPTIONS") {
    if (!u) return err("Debe iniciar sesión.", 401);
  }

  if (method === "OPTIONS") return new Response(null, { status: 204 });

  if (u && path.startsWith("/api/caja/")) {
    return handleCaja(ctx, u, method, path);
  }

  if (key === "POST /api/login") {
    const data = await body(ctx);
    const user = String(data.usuario || "").trim().toLowerCase();
    const clave = String(data.clave || "");
    const row = await one("SELECT * FROM usuarios WHERE lower(usuario)=? AND activo=1", [user]);
    if (!row || !verifyPassword(String(row.clave), clave)) return err("Usuario o contraseña incorrectos.", 401);
    const stored = String(row.clave || "");
    if (stored.startsWith("scrypt:") || stored.startsWith("pbkdf2:")) {
      try {
        await run("UPDATE usuarios SET clave=? WHERE id=?", [hashPassword(clave), Number(row.id)]);
      } catch {
        /* si falla el upgrade, igual deja entrar */
      }
    }
    setSession(ctx, Number(row.id));
    return json({
      ok: true,
      usuario: { id: row.id, usuario: row.usuario, nombre: row.nombre, rol: row.rol },
    });
  }

  if (key === "POST /api/logout") {
    clearSession(ctx);
    return json({ ok: true });
  }

  if (key === "GET /api/sesion") {
    return json({ ok: true, usuario: u });
  }

  if (!u) return err("Debe iniciar sesión.", 401);

  if (key === "GET /api/config") {
    const rows = await all("SELECT clave, valor FROM config");
    const config: Record<string, string> = {};
    for (const r of rows) config[String(r.clave)] = String(r.valor ?? "");
    return json({ ok: true, config });
  }

  if (key === "PUT /api/config") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    for (const clave of ["empresa", "titulo_informe", "codigo_informe"]) {
      if (clave in data) {
        await run(
          "INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor",
          [clave, String(data[clave]).trim()],
        );
      }
    }
    const rows = await all("SELECT clave, valor FROM config");
    const config: Record<string, string> = {};
    for (const r of rows) config[String(r.clave)] = String(r.valor ?? "");
    return json({ ok: true, config });
  }

  if (key === "GET /api/resumen") {
    const counts: Record<string, number> = { vacio: 0, en_planta: 0, cargado: 0, en_cliente: 0 };
    for (const r of await all(
      `SELECT t.estado, COUNT(*) AS n FROM tubos t JOIN articulos a ON a.id=t.articulo_id
       WHERE t.activo=1 AND IFNULL(a.es_tubo,1)=1 GROUP BY t.estado`,
    )) {
      counts[String(r.estado)] = Number(r.n);
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const genericos = await count("SELECT COUNT(*) AS n FROM articulos WHERE activo=1 AND IFNULL(es_tubo,0)=0");
    const tubos_empresa = await count(
      `SELECT COUNT(*) AS n FROM tubos t JOIN articulos a ON a.id=t.articulo_id
       WHERE t.activo=1 AND IFNULL(a.es_tubo,1)=1 AND t.propiedad='empresa'`,
    );
    const tubos_cliente = await count(
      `SELECT COUNT(*) AS n FROM tubos t JOIN articulos a ON a.id=t.articulo_id
       WHERE t.activo=1 AND IFNULL(a.es_tubo,1)=1 AND t.propiedad='cliente'`,
    );
    const por_cliente = await all(
      `SELECT c.id, c.nombre, COUNT(t.id) AS cantidad FROM clientes c
       JOIN tubos t ON t.cliente_id=c.id AND t.estado='en_cliente' AND t.activo=1
       GROUP BY c.id ORDER BY cantidad DESC, c.nombre`,
    );
    const recientes = await all(
      `SELECT m.*, a.codigo AS articulo_codigo, a.descripcion AS articulo_descripcion, c.nombre AS cliente_nombre
       FROM movimientos m LEFT JOIN articulos a ON a.id=m.articulo_id LEFT JOIN clientes c ON c.id=m.cliente_id
       ORDER BY m.id DESC LIMIT 12`,
    );
    const proximos_vto = await fetchTubos(
      `WHERE t.activo=1 AND t.estado IN ('cargado','en_cliente') AND t.fecha_vto IS NOT NULL AND t.fecha_vto != ''
       ORDER BY t.fecha_vto ASC LIMIT 8`,
    );
    const gn_en_cliente = await count(
      `SELECT COUNT(*) AS n FROM tubos t JOIN articulos a ON a.id=t.articulo_id
       WHERE t.activo=1 AND IFNULL(a.es_tubo,1)=1 AND t.propiedad='empresa' AND t.estado='en_cliente'`,
    );
    return json({
      ok: true,
      totales: { ...counts, total, genericos, prop_empresa: tubos_empresa, prop_cliente: tubos_cliente, gn_en_cliente },
      por_cliente,
      recientes,
      proximos_vto,
    });
  }

  if (key === "GET /api/articulos") {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.get("todos") !== "1") where.push("a.activo=1");
    if (q.get("tipo") === "tubo") where.push("IFNULL(a.es_tubo,0)=1");
    if (q.get("tipo") === "generico") where.push("IFNULL(a.es_tubo,0)=0");
    const qq = (q.get("q") || "").trim();
    if (qq) {
      where.push("(a.codigo LIKE ? OR a.descripcion LIKE ? OR IFNULL(a.grupo,'') LIKE ? OR IFNULL(a.codigo_proveedor,'') LIKE ?)");
      const like = `%${qq}%`;
      args.push(like, like, like, like);
    }
    const sql = `SELECT a.*, (SELECT COUNT(*) FROM tubos t WHERE t.articulo_id=a.id AND t.activo=1) AS tubos
      FROM articulos a ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY a.es_tubo DESC, a.codigo LIMIT 500`;
    return json({ ok: true, articulos: await all(sql, args) });
  }

  if (key === "POST /api/articulos") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    const codigo = String(data.codigo || "").trim();
    const descripcion = String(data.descripcion || "").trim().toUpperCase();
    if (!codigo || !descripcion) return err("El código y la descripción son obligatorios.");
    const es_tubo = [1, true, "1", "true", "tubo"].includes(data.es_tubo as never) ? 1 : 0;
    const propiedad = String(data.propiedad_default || "empresa") === "cliente" ? "cliente" : "empresa";
    try {
      const r = await run(
        `INSERT INTO articulos (codigo, descripcion, activo, creado_en, es_tubo, grupo, capacidad, propiedad_default, codigo_proveedor)
         VALUES (?,?,1,?,?,?,?,?,?)`,
        [
          codigo,
          descripcion,
          ahora(),
          es_tubo,
          String(data.grupo || "").trim(),
          String(data.capacidad || "").trim(),
          propiedad,
          String(data.codigo_proveedor || codigo).trim(),
        ],
      );
      const art = await one("SELECT * FROM articulos WHERE id=?", [Number(r.lastInsertRowid)]);
      return json({ ok: true, articulo: art });
    } catch {
      return err("Ya existe un artículo con ese código.");
    }
  }

  const artPut = path.match(/^\/api\/articulos\/(\d+)$/);
  if (method === "PUT" && artPut) {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const aid = Number(artPut[1]);
    const row = await one("SELECT * FROM articulos WHERE id=?", [aid]);
    if (!row) return err("Artículo no encontrado.", 404);
    const data = await body(ctx);
    const codigo = String(data.codigo ?? row.codigo).trim();
    const descripcion = String(data.descripcion ?? row.descripcion).trim().toUpperCase();
    const activo = data.activo === undefined ? row.activo : data.activo ? 1 : 0;
    const es_tubo =
      data.es_tubo === undefined ? row.es_tubo : [1, true, "1", "true", "tubo"].includes(data.es_tubo as never) ? 1 : 0;
    let propiedad = String(data.propiedad_default ?? row.propiedad_default ?? "empresa");
    if (propiedad !== "cliente") propiedad = "empresa";
    try {
      await run(
        `UPDATE articulos SET codigo=?, descripcion=?, activo=?, es_tubo=?, grupo=?, capacidad=?, propiedad_default=?, codigo_proveedor=? WHERE id=?`,
        [
          codigo,
          descripcion,
          Number(activo),
          Number(es_tubo),
          String(data.grupo ?? row.grupo ?? "").trim(),
          String(data.capacidad ?? row.capacidad ?? "").trim(),
          propiedad,
          String(data.codigo_proveedor ?? row.codigo_proveedor ?? codigo).trim(),
          aid,
        ],
      );
    } catch {
      return err("Ya existe un artículo con ese código.");
    }
    return json({ ok: true, articulo: await one("SELECT * FROM articulos WHERE id=?", [aid]) });
  }

  if (key === "GET /api/clientes") {
    const where: string[] = [];
    const args: string[] = [];
    if (q.get("todos") !== "1") where.push("c.activo=1");
    const qq = (q.get("q") || "").trim();
    if (qq) {
      where.push(
        "(c.nombre LIKE ? OR IFNULL(c.codigo,'') LIKE ? OR IFNULL(c.localidad,'') LIKE ? OR IFNULL(c.cuit,'') LIKE ? OR IFNULL(c.direccion,'') LIKE ?)",
      );
      const like = `%${qq}%`;
      args.push(like, like, like, like, like);
    }
    const cuitQ = (q.get("cuit") || "").trim();
    if (cuitQ) {
      where.push("REPLACE(REPLACE(IFNULL(c.cuit,''),'-',''),' ','') LIKE ?");
      args.push(`%${cuitQ.replace(/-/g, "").replace(/ /g, "")}%`);
    }
    const dirQ = (q.get("direccion") || "").trim();
    if (dirQ) {
      where.push("IFNULL(c.direccion,'') LIKE ?");
      args.push(`%${dirQ}%`);
    }
    if (q.get("con_tubos") === "1") {
      where.push(
        `EXISTS (
          SELECT 1 FROM tubos t JOIN articulos a ON a.id=t.articulo_id
          WHERE t.cliente_id=c.id AND t.activo=1 AND IFNULL(a.es_tubo,1)=1
            AND (t.estado='en_cliente' OR t.propiedad='cliente')
        )`,
      );
    }
    if (q.get("en_cliente") === "1") {
      where.push(
        `EXISTS (
          SELECT 1 FROM tubos t JOIN articulos a ON a.id=t.articulo_id
          WHERE t.cliente_id=c.id AND t.activo=1 AND IFNULL(a.es_tubo,1)=1
            AND t.estado='en_cliente'
        )`,
      );
    }
    const sql = `SELECT c.*, (SELECT COUNT(*) FROM tubos t WHERE t.cliente_id=c.id AND t.estado='en_cliente' AND t.activo=1) AS tubos
      FROM clientes c ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY c.nombre LIMIT 200`;
    return json({ ok: true, clientes: await all(sql, args) });
  }

  if (key === "POST /api/clientes") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    const nombre = String(data.nombre || "").trim().toUpperCase();
    if (!nombre) return err("El nombre del cliente es obligatorio.");
    const r = await run(
      "INSERT INTO clientes (nombre, direccion, telefono, activo, creado_en) VALUES (?,?,?,1,?)",
      [nombre, String(data.direccion || "").trim(), String(data.telefono || "").trim(), ahora()],
    );
    return json({ ok: true, cliente: await one("SELECT * FROM clientes WHERE id=?", [Number(r.lastInsertRowid)]) });
  }

  const cliGet = path.match(/^\/api\/clientes\/(\d+)$/);
  if (method === "GET" && cliGet) {
    const cid = Number(cliGet[1]);
    const row = await one("SELECT * FROM clientes WHERE id=?", [cid]);
    if (!row) return err("Cliente no encontrado.", 404);
    const tubos_en_cliente = await fetchTubos(
      "WHERE t.activo=1 AND t.cliente_id=? AND t.estado='en_cliente' AND IFNULL(a.es_tubo,1)=1 ORDER BY t.propiedad, t.numero",
      [cid],
    );
    const tubos_gn = tubos_en_cliente.filter((t) => t.propiedad !== "cliente");
    const tubos_propios = await fetchTubos(
      "WHERE t.activo=1 AND t.propiedad='cliente' AND t.cliente_id=? AND IFNULL(a.es_tubo,1)=1 ORDER BY t.estado, t.numero",
      [cid],
    );
    const propios_en_poder = tubos_propios.filter((t) => String(t.estado) === "en_cliente");
    return json({
      ok: true,
      cliente: row,
      resumen: {
        en_cliente_total: tubos_en_cliente.length,
        en_cliente_gn: tubos_gn.length,
        en_cliente_propios: tubos_en_cliente.length - tubos_gn.length,
        registrados_propios: tubos_propios.length,
        propios_en_poder: propios_en_poder.length,
      },
      tubos_gn,
      tubos_en_cliente,
      tubos_propios,
      movimientos: [],
      ventas: [],
    });
  }

  const cliPut = path.match(/^\/api\/clientes\/(\d+)$/);
  if (method === "PUT" && cliPut) {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const cid = Number(cliPut[1]);
    const row = await one("SELECT * FROM clientes WHERE id=?", [cid]);
    if (!row) return err("Cliente no encontrado.", 404);
    const data = await body(ctx);
    const nombre = String(data.nombre ?? row.nombre).trim().toUpperCase();
    await run("UPDATE clientes SET nombre=?, direccion=?, telefono=?, activo=? WHERE id=?", [
      nombre,
      String(data.direccion ?? row.direccion ?? "").trim(),
      String(data.telefono ?? row.telefono ?? "").trim(),
      data.activo === undefined ? Number(row.activo) : data.activo ? 1 : 0,
      cid,
    ]);
    return json({ ok: true, cliente: await one("SELECT * FROM clientes WHERE id=?", [cid]) });
  }

  if (method === "DELETE" && cliPut) {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const cid = Number(cliPut[1]);
    const row = await one("SELECT * FROM clientes WHERE id=?", [cid]);
    if (!row) return err("Cliente no encontrado.", 404);
    const tubosRow = await one(
      "SELECT COUNT(*) AS n FROM tubos WHERE cliente_id=? AND estado='en_cliente' AND activo=1",
      [cid],
    );
    const enCliente = Number(tubosRow?.n || 0);
    // Baja lógica: el cliente deja de aparecer. Si tiene tubos, se permite igual
    // (p. ej. duplicados en reparto); los tubos siguen con ese cliente_id.
    await run("UPDATE clientes SET activo=0 WHERE id=?", [cid]);
    return json({
      ok: true,
      tubos_en_cliente: enCliente,
      aviso: enCliente
        ? `Cliente dado de baja. Quedan ${enCliente} tubo(s) marcados en ese cliente; revisalos si hace falta.`
        : undefined,
    });
  }

  const cliAsig = path.match(/^\/api\/clientes\/(\d+)\/asignar-tubos$/);
  if (method === "POST" && cliAsig) {
    if (!puede(u, "admin", "despacho")) return err("No tiene permiso para esta acción.", 403);
    const cid = Number(cliAsig[1]);
    const cli = await one("SELECT * FROM clientes WHERE id=? AND activo=1", [cid]);
    if (!cli) return err("Cliente no encontrado.", 404);
    const data = await body(ctx);
    const como = String(data.como || "gn").trim().toLowerCase();
    if (como !== "gn" && como !== "propio") return err("Indicá si es GN o propio.");
    let ids = idsFrom(data);
    if (!ids.length && data.numero) {
      const num = String(data.numero || "").trim();
      const row = await one(
        "SELECT id FROM tubos WHERE activo=1 AND (numero=? OR codigo_proveedor=?) LIMIT 1",
        [num, num],
      );
      if (!row) return err(`No está el tubo ${num} en la base.`);
      ids = [Number(row.id)];
    }
    if (!ids.length) return err("Indicá al menos un tubo.");
    let n = 0;
    for (const tid of ids) {
      const tubo = await one("SELECT * FROM tubos WHERE id=? AND activo=1", [tid]);
      if (!tubo) return err(`Tubo ${tid} no encontrado.`);
      if (como === "propio") {
        await run(
          "UPDATE tubos SET propiedad='cliente', cliente_id=?, actualizado_en=? WHERE id=?",
          [cid, ahora(), tid],
        );
        await registrarMovimiento(tubo, "EDICION", String(tubo.estado), String(tubo.estado), hoy(), {
          cliente_id: cid,
          observaciones: `Asignado como envase propio de ${cli.nombre}`,
        });
      } else {
        const est = String(tubo.estado || "");
        if (est !== "cargado" && est !== "en_cliente") {
          return err(`El tubo ${tubo.numero} debe estar cargado (o ya en cliente) para asignarlo como GN.`);
        }
        await run(
          "UPDATE tubos SET propiedad='empresa', cliente_id=?, estado='en_cliente', actualizado_en=? WHERE id=?",
          [cid, ahora(), tid],
        );
        await registrarMovimiento(tubo, "TRANSALI", est, "en_cliente", hoy(), {
          cliente_id: cid,
          observaciones: `Asignado / despacho a ${cli.nombre}`,
        });
      }
      n += 1;
    }
    return json({ ok: true, cantidad: n });
  }

  if (key === "GET /api/catalogo") {
    const tipo = q.get("tipo") || "";
    const qq = (q.get("q") || "").trim();
    const items: Record<string, unknown>[] = [];
    let estadoF = q.get("estado") || "";
    
    if (tipo !== "generico") {
      const where = ["t.activo=1", "IFNULL(a.es_tubo,1)=1"];
      const args: (string | number)[] = [];
      if (estadoF && ESTADOS.includes(estadoF as (typeof ESTADOS)[number])) {
        where.push("t.estado=?");
        args.push(estadoF);
      }
      const prop = q.get("propiedad");
      if (prop === "empresa" || prop === "cliente") {
        where.push("t.propiedad=?");
        args.push(prop);
      }
      if (q.get("cliente_id")) {
        where.push("t.cliente_id=?");
        args.push(Number(q.get("cliente_id")));
      }
      if (qq) {
        where.push(
          "(t.numero LIKE ? OR t.lote LIKE ? OR a.codigo LIKE ? OR a.descripcion LIKE ? OR IFNULL(c.nombre,'') LIKE ? OR IFNULL(t.codigo_proveedor,'') LIKE ? OR IFNULL(a.codigo_proveedor,'') LIKE ? OR IFNULL(a.grupo,'') LIKE ?)",
        );
        const like = `%${qq}%`;
        args.push(like, like, like, like, like, like, like, like);
      }
      for (const t of await fetchTubos(
        `WHERE ${where.join(" AND ")} ORDER BY t.actualizado_en DESC, t.numero LIMIT 200`,
        args,
      )) {
        items.push({ ...t, kind: "tubo" });
      }
    }
    // Si filtran por estado de tubo, no mezclar genéricos (no tienen estado).
    if (tipo !== "tubo" && !estadoF && u && puede(u, "admin", "despacho")) {
      const w = ["a.activo=1", "IFNULL(a.es_tubo,0)=0"];
      const args: string[] = [];
      if (qq) {
        w.push("(a.codigo LIKE ? OR a.descripcion LIKE ? OR IFNULL(a.grupo,'') LIKE ? OR IFNULL(a.codigo_proveedor,'') LIKE ?)");
        const like = `%${qq}%`;
        args.push(like, like, like, like);
      }
      for (const a of await all(
        `SELECT a.*,
           (SELECT COUNT(*) FROM tubos t WHERE t.articulo_id=a.id AND t.activo=1) AS tubos,
           (SELECT COALESCE(m.creado_en, m.fecha) FROM movimientos m
            WHERE m.articulo_id=a.id
            ORDER BY m.id DESC LIMIT 1) AS ultimo_movimiento,
           (SELECT m.tipo FROM movimientos m
            WHERE m.articulo_id=a.id
            ORDER BY m.id DESC LIMIT 1) AS ultimo_movimiento_tipo
         FROM articulos a WHERE ${w.join(" AND ")} ORDER BY a.codigo LIMIT 150`,
        args,
      )) {
        items.push({ ...a, kind: "generico" });
      }
    }
    return json({ ok: true, items });
  }

  if (key === "POST /api/catalogo/masivo") {
    if (!puede(u, "admin", "despacho")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    const raw = (data.ids as unknown[]) || [];
    const items: { kind: string; id: number }[] = [];
    for (const item of raw) {
      if (item && typeof item === "object" && "id" in item) {
        const o = item as { kind?: string; id: unknown };
        items.push({ kind: String(o.kind || "tubo"), id: Number(o.id) });
      }
    }
    if (!items.length) return err("No hay productos seleccionados.");
    const accion = String(data.accion || "actualizar");
    const campos = (data.campos || {}) as Record<string, unknown>;
    const tipoProducto = () => {
      const tp = String(campos.tipo_producto || "").trim().toLowerCase();
      if (tp === "tubo") return "tubo";
      if (tp === "generico") return "generico";
      return null;
    };
    const aplicarGenerico = async (artId: number) => {
      await run("UPDATE articulos SET es_tubo=0 WHERE id=?", [artId]);
      if (campos.propiedad === "empresa" || campos.propiedad === "cliente") {
        await run("UPDATE articulos SET propiedad_default=? WHERE id=?", [String(campos.propiedad), artId]);
      }
      const tubos = await all("SELECT * FROM tubos WHERE articulo_id=? AND activo=1", [artId]);
      for (const row of tubos) {
        await run("UPDATE tubos SET activo=0, actualizado_en=? WHERE id=?", [ahora(), Number(row.id)]);
        await registrarMovimiento(row as Record<string, unknown>, "BAJA", String(row.estado), String(row.estado), hoy(), {
          observaciones: "Pasó a artículo genérico (edición masiva)",
        });
      }
    };
    const aplicarTubo = async (artId: number) => {
      await run("UPDATE articulos SET es_tubo=1 WHERE id=?", [artId]);
      if (campos.propiedad === "empresa" || campos.propiedad === "cliente") {
        await run("UPDATE articulos SET propiedad_default=? WHERE id=?", [String(campos.propiedad), artId]);
      }
    };
    let n = 0;
    const artsGenerico = new Set<number>();
    for (const it of items) {
      if (it.kind === "generico") {
        const art = await one("SELECT * FROM articulos WHERE id=?", [it.id]);
        if (!art) continue;
        if (accion === "eliminar") {
          await run("UPDATE articulos SET activo=0 WHERE id=?", [it.id]);
          n++;
          continue;
        }
        const tp = tipoProducto();
        if (tp === "generico") {
          await aplicarGenerico(it.id);
          artsGenerico.add(it.id);
        } else if (tp === "tubo") {
          await aplicarTubo(it.id);
        }
        await run(
          "UPDATE articulos SET codigo=?, descripcion=?, grupo=?, capacidad=?, codigo_proveedor=? WHERE id=?",
          [
            campos.codigo ? String(campos.codigo).trim() : String(art.codigo),
            campos.descripcion ? String(campos.descripcion).trim().toUpperCase() : String(art.descripcion),
            campos.grupo ? String(campos.grupo).trim().toUpperCase() : String(art.grupo || ""),
            campos.capacidad ? String(campos.capacidad).trim() : String(art.capacidad || ""),
            campos.codigo_proveedor ? String(campos.codigo_proveedor).trim() : String(art.codigo_proveedor || ""),
            it.id,
          ],
        );
        n++;
      } else {
        const tubo = await one("SELECT * FROM tubos WHERE id=? AND activo=1", [it.id]);
        if (!tubo) continue;
        if (accion === "eliminar") {
          await run("UPDATE tubos SET activo=0, actualizado_en=? WHERE id=?", [ahora(), it.id]);
          await registrarMovimiento(tubo, "BAJA", String(tubo.estado), String(tubo.estado), hoy(), {
            observaciones: "Baja masiva",
          });
          n++;
          continue;
        }
        const artId = Number(tubo.articulo_id);
        const tp = tipoProducto();
        if (tp === "generico") {
          if (campos.codigo || campos.descripcion || campos.grupo || campos.capacidad || campos.codigo_proveedor) {
            const art = await one("SELECT * FROM articulos WHERE id=?", [artId]);
            if (art) {
              await run(
                "UPDATE articulos SET codigo=?, descripcion=?, grupo=?, capacidad=?, codigo_proveedor=? WHERE id=?",
                [
                  campos.codigo ? String(campos.codigo).trim() : String(art.codigo),
                  campos.descripcion ? String(campos.descripcion).trim().toUpperCase() : String(art.descripcion),
                  campos.grupo
                    ? String(campos.grupo).trim().toUpperCase()
                    : String(campos.descripcion || art.grupo || "").trim().toUpperCase(),
                  campos.capacidad ? String(campos.capacidad).trim() : String(art.capacidad || ""),
                  campos.codigo_proveedor ? String(campos.codigo_proveedor).trim() : String(art.codigo_proveedor || ""),
                  artId,
                ],
              );
            }
          }
          if (!artsGenerico.has(artId)) {
            await aplicarGenerico(artId);
            artsGenerico.add(artId);
          }
          n++;
          continue;
        }
        if (tp === "tubo") await aplicarTubo(artId);
        const lote = campos.lote ? String(campos.lote).trim().toUpperCase() : String(tubo.lote || "");
        const fecha_vto = campos.fecha_vto ? parseFecha(String(campos.fecha_vto)) : String(tubo.fecha_vto || "");
        await run(
          "UPDATE tubos SET numero=?, lote=?, fecha_vto=?, notas=?, propiedad=?, codigo_proveedor=?, actualizado_en=? WHERE id=?",
          [
            campos.numero ? String(campos.numero).trim() : String(tubo.numero),
            lote,
            fecha_vto,
            campos.notas ? String(campos.notas).trim() : String(tubo.notas || ""),
            campos.propiedad === "cliente" ? "cliente" : campos.propiedad === "empresa" ? "empresa" : String(tubo.propiedad),
            campos.codigo_proveedor ? String(campos.codigo_proveedor).trim() : String(tubo.codigo_proveedor || ""),
            ahora(),
            it.id,
          ],
        );
        if (campos.codigo || campos.descripcion || campos.grupo || campos.capacidad || campos.codigo_proveedor) {
          const art = await one("SELECT * FROM articulos WHERE id=?", [Number(tubo.articulo_id)]);
          if (art) {
            await run(
              "UPDATE articulos SET codigo=?, descripcion=?, grupo=?, capacidad=?, codigo_proveedor=? WHERE id=?",
              [
                campos.codigo ? String(campos.codigo).trim() : String(art.codigo),
                campos.descripcion ? String(campos.descripcion).trim().toUpperCase() : String(art.descripcion),
                campos.grupo ? String(campos.grupo).trim().toUpperCase() : String(art.grupo || ""),
                campos.capacidad ? String(campos.capacidad).trim() : String(art.capacidad || ""),
                campos.codigo_proveedor ? String(campos.codigo_proveedor).trim() : String(art.codigo_proveedor || ""),
                Number(art.id),
              ],
            );
          }
        }
        n++;
      }
    }
    return json({ ok: true, cantidad: n, genericos: artsGenerico.size });
  }

  if (key === "GET /api/tubos") {
    const where = ["t.activo=1", "IFNULL(a.es_tubo,1)=1"];
    const args: (string | number)[] = [];
    const estado = q.get("estado");
    if (estado) {
      const estados = estado.split(",").map((e) => e.trim()).filter((e) => ESTADOS.includes(e as (typeof ESTADOS)[number]));
      if (estados.length === 1) {
        where.push("t.estado=?");
        args.push(estados[0]);
      } else if (estados.length > 1) {
        where.push(`t.estado IN (${estados.map(() => "?").join(",")})`);
        args.push(...estados);
      }
    }
    if (q.get("cliente_id")) {
      where.push("t.cliente_id=?");
      args.push(Number(q.get("cliente_id")));
    }
    if (q.get("articulo_id")) {
      where.push("t.articulo_id=?");
      args.push(Number(q.get("articulo_id")));
    }
    const prop = q.get("propiedad");
    if (prop === "empresa" || prop === "cliente") {
      where.push("t.propiedad=?");
      args.push(prop);
    }
    const qq = (q.get("q") || "").trim();
    if (qq) {
      where.push(
        "(t.numero LIKE ? OR t.lote LIKE ? OR a.codigo LIKE ? OR a.descripcion LIKE ? OR IFNULL(c.nombre,'') LIKE ? OR IFNULL(t.codigo_proveedor,'') LIKE ? OR IFNULL(a.codigo_proveedor,'') LIKE ?)",
      );
      const like = `%${qq}%`;
      args.push(like, like, like, like, like, like, like);
    }
    const tubos = await fetchTubos(`WHERE ${where.join(" AND ")} ORDER BY t.actualizado_en DESC, t.numero LIMIT 200`, args);
    return json({ ok: true, tubos });
  }

  const tuboGet = path.match(/^\/api\/tubos\/(\d+)$/);
  if (method === "GET" && tuboGet) {
    const tid = Number(tuboGet[1]);
    const tubos = await fetchTubos("WHERE t.id=?", [tid]);
    if (!tubos.length) return err("Tubo no encontrado.", 404);
    const movimientos = await all(
      `SELECT m.*, c.nombre AS cliente_nombre, a.codigo AS articulo_codigo
       FROM movimientos m LEFT JOIN clientes c ON c.id=m.cliente_id LEFT JOIN articulos a ON a.id=m.articulo_id
       WHERE m.tubo_id=? ORDER BY m.id DESC`,
      [tid],
    );
    return json({ ok: true, tubo: tubos[0], movimientos });
  }

  if (key === "POST /api/tubos/vincular") {
    if (!puede(u, "admin", "despacho", "reparto")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    const codigo_proveedor = String(data.codigo_proveedor || data.codigo || "").trim();
    if (!codigo_proveedor) return err("Falta el código escaneado.");
    let tuboRow = null;
    if (data.tubo_id) {
      tuboRow = await one("SELECT * FROM tubos WHERE id=? AND activo=1", [Number(data.tubo_id)]);
    } else {
      const numero = String(data.numero || "").trim().toUpperCase();
      if (!numero) return err("Indicá el tubo a vincular.");
      tuboRow = await one(
        `SELECT * FROM tubos WHERE activo=1 AND propiedad='empresa'
         AND (UPPER(TRIM(numero))=? OR LTRIM(UPPER(TRIM(numero)),'0')=?)
         ORDER BY id DESC LIMIT 1`,
        [numero, numero.replace(/^0+/, "") || numero],
      );
    }
    if (!tuboRow) return err("No se encontró ese tubo de empresa (GN).", 404);
    if (String(tuboRow.propiedad || "") === "cliente") {
      return err("Solo se pueden vincular tubos de Gasonor (GN), no de cliente.", 403);
    }
    const contexto = String(data.contexto || "planta");
    const estado = String(tuboRow.estado || "");
    if (contexto === "cliente" && estado !== "cargado") {
      return err(`Ese tubo no está cargado en empresa (estado: ${estado}).`);
    }
    if (contexto === "planta" && estado !== "vacio" && estado !== "cargado") {
      return err(`Ese tubo no está disponible para despacho a planta (estado: ${estado}).`);
    }
    await run(
      "UPDATE tubos SET codigo_proveedor=?, actualizado_en=? WHERE id=?",
      [codigo_proveedor, ahora(), Number(tuboRow.id)],
    );
    const list = await fetchTubos("WHERE t.id=?", [Number(tuboRow.id)]);
    return json({ ok: true, tubo: list[0], codigo: codigo_proveedor });
  }

  if (key === "POST /api/tubos") {
    if (!puede(u, "admin", "despacho", "reparto")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    const numero = String(data.numero || "").trim();
    if (!numero) return err("El número de tubo es obligatorio.");
    let estado = String(data.estado || "vacio");
    if (estado !== "cargado" && estado !== "vacio") return err("El alta solo admite estado Cargado o Vacío.");
    const lote = String(data.lote || "").trim().toUpperCase();
    const fecha_vto = data.fecha_vto ? parseFecha(String(data.fecha_vto)) : "";
    if (estado === "cargado" && !lote) return err("Los tubos que llegan cargados deben tener lote.");
    let propiedad = String(data.propiedad || "empresa");
    if (propiedad !== "cliente") propiedad = "empresa";
    let cliente_id: number | null = null;
    if (propiedad === "cliente") {
      cliente_id = Number(data.cliente_id);
      if (!cliente_id) return err("Asigná el cliente propietario del tubo.");
    }
    let art = data.articulo_id ? await one("SELECT * FROM articulos WHERE id=? AND activo=1", [Number(data.articulo_id)]) : null;
    const codigo = String(data.codigo || "").trim();
    const grupo = String(data.grupo || data.tipo_gas || "").trim().toUpperCase();
    const capacidad = String(data.capacidad || "").trim();
    let descripcion = String(data.descripcion || grupo || "").trim().toUpperCase();
    const codprov = String(data.codigo_proveedor || codigo || numero).trim();
    if (!art) {
      if (!codigo) return err("El código del artículo es obligatorio.");
      if (!descripcion) descripcion = grupo || codigo;
      art = await one("SELECT * FROM articulos WHERE codigo=?", [codigo]);
      if (art) {
        await run(
          "UPDATE articulos SET es_tubo=1, grupo=?, capacidad=?, propiedad_default=?, codigo_proveedor=? WHERE id=?",
          [grupo || String(art.grupo || ""), capacidad || String(art.capacidad || ""), propiedad, codprov, Number(art.id)],
        );
        art = await one("SELECT * FROM articulos WHERE id=?", [Number(art.id)]);
      } else {
        const ins = await run(
          `INSERT INTO articulos (codigo, descripcion, activo, creado_en, es_tubo, grupo, capacidad, propiedad_default, codigo_proveedor)
           VALUES (?,?,1,?,1,?,?,?,?)`,
          [codigo, descripcion, ahora(), grupo, capacidad, propiedad, codprov],
        );
        art = await one("SELECT * FROM articulos WHERE id=?", [Number(ins.lastInsertRowid)]);
      }
    }
    if (!art!.es_tubo) await run("UPDATE articulos SET es_tubo=1 WHERE id=?", [Number(art!.id)]);
    try {
      const r = await run(
        `INSERT INTO tubos (numero, articulo_id, lote, fecha_vto, estado, cliente_id, notas, activo, creado_en, actualizado_en, propiedad, codigo_proveedor)
         VALUES (?,?,?,?,?,?,?,1,?,?,?,?)`,
        [
          numero,
          Number(art!.id),
          lote,
          fecha_vto,
          estado,
          cliente_id,
          String(data.notas || "").trim(),
          ahora(),
          ahora(),
          propiedad,
          codprov,
        ],
      );
      const tubo = await one("SELECT * FROM tubos WHERE id=?", [Number(r.lastInsertRowid)]);
      await registrarMovimiento(tubo!, "ALTA", null, estado, parseFecha(data.fecha as string), {
        lote,
        fecha_vto,
        cliente_id,
        observaciones: String(data.notas || "").trim(),
      });
      const list = await fetchTubos("WHERE t.id=?", [Number(r.lastInsertRowid)]);
      return json({ ok: true, tubo: list[0] });
    } catch {
      return err("Ya existe un tubo con ese número de trazabilidad.");
    }
  }

  if (method === "PUT" && tuboGet) {
    if (!puede(u, "admin", "despacho")) return err("No tiene permiso para esta acción.", 403);
    const tid = Number(tuboGet[1]);
    const tubo = await one("SELECT * FROM tubos WHERE id=?", [tid]);
    if (!tubo) return err("Tubo no encontrado.", 404);
    const data = await body(ctx);
    const numero = String(data.numero ?? tubo.numero).trim();
    const lote = String(data.lote ?? tubo.lote ?? "").trim().toUpperCase();
    const fecha_vto = data.fecha_vto ? parseFecha(String(data.fecha_vto)) : String(tubo.fecha_vto || "");
    const notas = String(data.notas ?? tubo.notas ?? "").trim();
    const activo = data.activo === undefined ? Number(tubo.activo) : data.activo ? 1 : 0;
    const articulo_id = Number(data.articulo_id ?? tubo.articulo_id);
    let propiedad = String(data.propiedad ?? tubo.propiedad ?? "empresa");
    if (propiedad !== "cliente") propiedad = "empresa";
    const estadoAntes = String(tubo.estado || "");
    let estado = String(data.estado ?? estadoAntes).trim();
    if (!ESTADOS.includes(estado as (typeof ESTADOS)[number])) return err("Estado inválido.");
    let cliente_id = data.cliente_id !== undefined
      ? (data.cliente_id ? Number(data.cliente_id) : null)
      : (tubo.cliente_id != null ? Number(tubo.cliente_id) : null);
    let proveedor_id = data.proveedor_id !== undefined
      ? (data.proveedor_id ? Number(data.proveedor_id) : null)
      : (tubo.proveedor_id != null ? Number(tubo.proveedor_id) : null);
    // Propiedad cliente: cliente_id = dueño (siempre). GN: cliente_id solo si está físicamente en_cliente.
    if (propiedad === "cliente") {
      if (!cliente_id) return err("Asigná el cliente propietario del tubo.");
      const cli = await one("SELECT id FROM clientes WHERE id=? AND activo=1", [cliente_id]);
      if (!cli) return err("Cliente propietario inválido.");
    } else if (estado !== "en_cliente") {
      cliente_id = null;
    }
    if (estado === "en_planta") {
      if (!proveedor_id) return err("Elegí la planta / proveedor donde está el tubo.");
      const prov = await one("SELECT id, nombre FROM proveedores WHERE id=? AND activo=1", [proveedor_id]);
      if (!prov) return err("Planta / proveedor inválido.");
    } else {
      proveedor_id = null;
    }
    const codigo_proveedor = data.codigo_proveedor !== undefined
      ? String(data.codigo_proveedor || "").trim()
      : String(tubo.codigo_proveedor || "");
    const retener = data.retener !== undefined
      ? (data.retener === 1 || data.retener === true || data.retener === "1" ? 1 : 0)
      : Number(tubo.retener || 0);
    try {
      await run(
        `UPDATE tubos SET numero=?, articulo_id=?, lote=?, fecha_vto=?, notas=?, activo=?, propiedad=?,
          cliente_id=?, proveedor_id=?, codigo_proveedor=?, retener=?, estado=?, actualizado_en=? WHERE id=?`,
        [numero, articulo_id, lote, fecha_vto, notas, activo, propiedad, cliente_id, proveedor_id, codigo_proveedor, retener, estado, ahora(), tid],
      );
    } catch {
      return err("Ya existe un tubo con ese número de trazabilidad.");
    }
    if (!activo && tubo.activo) {
      await registrarMovimiento(tubo, "BAJA", estadoAntes, estadoAntes, hoy(), {
        observaciones: "Baja de circulación",
      });
    } else if (estado !== estadoAntes) {
      const tipoMov =
        estado === "en_planta" && estadoAntes !== "en_planta"
          ? "PLANSALI"
          : estadoAntes === "en_planta" && estado === "cargado"
            ? "PLANENTR"
            : "EDICION";
      const obs =
        tipoMov === "PLANSALI"
          ? `Asignado a planta (corrección manual)`
          : tipoMov === "PLANENTR"
            ? `Retorno de planta (corrección manual)`
            : `Corrección de estado: ${estadoAntes || "—"} → ${estado}`;
      await registrarMovimiento(
        { ...tubo, lote, fecha_vto, numero, articulo_id, estado, cliente_id, proveedor_id },
        tipoMov,
        estadoAntes,
        estado,
        hoy(),
        {
          cliente_id,
          observaciones: obs,
        },
      );
    }
    const list = await fetchTubos("WHERE t.id=?", [tid]);
    return json({ ok: true, tubo: list[0] });
  }

  const op = path.match(/^\/api\/operaciones\/(enviar-planta|recibir-planta|cargar-empresa|enviar-cliente|recibir-cliente)$/);
  if (method === "POST" && op) {
    const accion = op[1];
    if (accion === "enviar-cliente" || accion === "recibir-cliente") {
      if (!puede(u, "admin", "despacho", "reparto")) return err("No tiene permiso para esta acción.", 403);
    } else if (!puede(u, "admin", "despacho")) {
      return err("No tiene permiso para esta acción.", 403);
    }
    return operar(accion, await body(ctx), Number(u?.id) || null);
  }

  if (key === "GET /api/movimientos") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const where = ["1=1"];
    const args: (string | number)[] = [];
    if (q.get("desde")) {
      where.push("m.fecha >= ?");
      args.push(parseFecha(q.get("desde")));
    }
    if (q.get("hasta")) {
      where.push("m.fecha <= ?");
      args.push(parseFecha(q.get("hasta")));
    }
    if (q.get("tipo")) {
      where.push("m.tipo=?");
      args.push(q.get("tipo")!);
    }
    if (q.get("cliente_id")) {
      where.push("m.cliente_id=?");
      args.push(Number(q.get("cliente_id")));
    }
    const qq = (q.get("q") || "").trim();
    if (qq) {
      where.push(
        "(m.numero LIKE ? OR m.lote LIKE ? OR IFNULL(c.nombre,'') LIKE ? OR a.codigo LIKE ? OR IFNULL(u.nombre,'') LIKE ?)",
      );
      const like = `%${qq}%`;
      args.push(like, like, like, like, like);
    }
    const movimientos = await all(
      `SELECT m.*, a.codigo AS articulo_codigo, a.descripcion AS articulo_descripcion,
              c.nombre AS cliente_nombre, u.nombre AS usuario_nombre
       FROM movimientos m
       LEFT JOIN articulos a ON a.id=m.articulo_id
       LEFT JOIN clientes c ON c.id=m.cliente_id
       LEFT JOIN usuarios u ON u.id=m.usuario_id
       WHERE ${where.join(" AND ")} ORDER BY m.fecha DESC, m.id DESC LIMIT 800`,
      args,
    );
    return json({ ok: true, movimientos });
  }

  if (key === "GET /api/informe/expedicion") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const desde = parseFecha(q.get("desde") || `${hoy().slice(0, 8)}01`);
    const hasta = parseFecha(q.get("hasta") || hoy());
    const tipo = q.get("tipo") || "TODOS";
    const labels: Record<string, string> = {
      PLANSALI: "Salida",
      PLANENTR: "Entrada",
      TRANSALI: "SalidaCL",
      TRANSENT: "EntradaCL",
    };
    const where = ["m.fecha >= ?", "m.fecha <= ?", "m.tipo IN ('PLANSALI','PLANENTR','TRANSALI','TRANSENT')"];
    const args: string[] = [desde, hasta];
    if (tipo in labels) {
      where.push("m.tipo=?");
      args.push(tipo);
    }
    const filas = await all(
      `SELECT m.fecha, m.tipo, m.numero, m.lote, m.fecha_vto, m.observaciones, m.creado_en,
              a.codigo AS articulo_codigo, a.descripcion AS articulo_descripcion,
              COALESCE(NULLIF(TRIM(IFNULL(t.codigo_proveedor,'')), ''), a.codigo_proveedor) AS codigo_proveedor,
              c.nombre AS cliente_nombre, u.nombre AS usuario_nombre,
              substr(IFNULL(m.creado_en, m.fecha), 12, 5) AS hora
       FROM movimientos m
       LEFT JOIN articulos a ON a.id=m.articulo_id
       LEFT JOIN tubos t ON t.id=m.tubo_id
       LEFT JOIN clientes c ON c.id=m.cliente_id
       LEFT JOIN usuarios u ON u.id=m.usuario_id
       WHERE ${where.join(" AND ")} ORDER BY m.fecha, m.id`,
      args,
    );
    for (const r of filas) {
      (r as Record<string, unknown>).movimiento = labels[String(r.tipo)] || r.tipo;
      (r as Record<string, unknown>).nombre =
        r.tipo === "TRANSALI" || r.tipo === "TRANSENT" ? r.cliente_nombre || "" : r.observaciones || "";
    }
    const cfgRows = await all("SELECT clave, valor FROM config");
    const config: Record<string, string> = {};
    for (const r of cfgRows) config[String(r.clave)] = String(r.valor ?? "");
    return json({ ok: true, desde, hasta, tipo, config, generado: ahora(), filas });
  }

  if (key === "GET /api/usuarios") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const usuarios = await all("SELECT id, usuario, nombre, rol, activo, creado_en FROM usuarios ORDER BY usuario");
    return json({ ok: true, usuarios, roles: [...ROLES], roles_info: ROLES_INFO });
  }

  if (key === "POST /api/usuarios") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    const usuario = String(data.usuario || "").trim().toLowerCase();
    const nombre = String(data.nombre || "").trim();
    const rol = String(data.rol || "").trim();
    const clave = String(data.clave || "");
    if (!usuario || !nombre || !ROLES.includes(rol as never) || clave.length < 4) {
      return err("Usuario, nombre, rol y clave (mín. 4) son obligatorios.");
    }
    try {
      const r = await run(
        "INSERT INTO usuarios (usuario, clave, nombre, rol, activo, creado_en) VALUES (?,?,?,?,1,?)",
        [usuario, hashPassword(clave), nombre, rol, ahora()],
      );
      const row = await one("SELECT id, usuario, nombre, rol, activo FROM usuarios WHERE id=?", [
        Number(r.lastInsertRowid),
      ]);
      return json({ ok: true, usuario: row });
    } catch {
      return err("Ese nombre de usuario ya existe.");
    }
  }

  const usrPut = path.match(/^\/api\/usuarios\/(\d+)$/);
  if (method === "PUT" && usrPut) {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const uid = Number(usrPut[1]);
    const row = await one("SELECT * FROM usuarios WHERE id=?", [uid]);
    if (!row) return err("Usuario no encontrado.", 404);
    const data = await body(ctx);
    const nombre = String(data.nombre ?? row.nombre).trim();
    const rol = String(data.rol ?? row.rol);
    if (!ROLES.includes(rol as never)) return err("Rol inválido.");
    const activo = data.activo === undefined ? Number(row.activo) : data.activo ? 1 : 0;
    await run("UPDATE usuarios SET nombre=?, rol=?, activo=? WHERE id=?", [nombre, rol, activo, uid]);
    if (data.clave) {
      const clave = String(data.clave);
      if (clave.length < 4) return err("La contraseña debe tener al menos 4 caracteres.");
      await run("UPDATE usuarios SET clave=? WHERE id=?", [hashPassword(clave), uid]);
    }
    return json({ ok: true });
  }

  if (method === "DELETE" && usrPut) {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const uid = Number(usrPut[1]);
    if (uid === u.id) return err("No puede eliminarse a sí mismo.");
    const row = await one("SELECT * FROM usuarios WHERE id=?", [uid]);
    if (!row) return err("Usuario no encontrado.", 404);
    if (String(row.rol) === "admin") {
      const nAdmin = await count("SELECT COUNT(*) AS n FROM usuarios WHERE activo=1 AND rol='admin'");
      if (nAdmin <= 1) return err("No se puede eliminar el último administrador.");
    }
    await run("DELETE FROM usuarios WHERE id=?", [uid]);
    return json({ ok: true });
  }

  if (key === "GET /api/proveedores") {
    const rows = await all(
      `SELECT p.*,
        (SELECT COUNT(*) FROM tubos t WHERE t.proveedor_id=p.id AND t.activo=1 AND t.estado='en_planta') AS tubos_en_planta,
        (SELECT COUNT(*) FROM documentos_planta d WHERE d.proveedor_id=p.id AND d.tipo='despacho') AS despachos,
        (SELECT COUNT(*) FROM documentos_planta d WHERE d.proveedor_id=p.id AND d.tipo='recepcion' AND IFNULL(d.estado,'cerrado')!='borrador') AS recepciones
       FROM proveedores p WHERE p.activo=1 ORDER BY p.nombre`,
    );
    return json({ ok: true, proveedores: rows });
  }

  if (key === "POST /api/proveedores") {
    if (!puede(u, "admin", "despacho")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    const nombre = String(data.nombre || "").trim().toUpperCase();
    if (!nombre) return err("El nombre del proveedor es obligatorio.");
    try {
      const r = await run(
        "INSERT INTO proveedores (nombre, direccion, telefono, cuit, activo, creado_en) VALUES (?,?,?,?,1,?)",
        [
          nombre,
          String(data.direccion || "").trim(),
          String(data.telefono || "").trim(),
          String(data.cuit || "").trim(),
          ahora(),
        ],
      );
      return json({
        ok: true,
        proveedor: await one("SELECT * FROM proveedores WHERE id=?", [Number(r.lastInsertRowid)]),
      });
    } catch {
      return err("Ya existe ese proveedor.");
    }
  }

  const prv = path.match(/^\/api\/proveedores\/(\d+)$/);
  if (method === "GET" && prv) {
    const pid = Number(prv[1]);
    const row = await one("SELECT * FROM proveedores WHERE id=?", [pid]);
    if (!row) return err("Proveedor no encontrado.", 404);
    const tubos = await fetchTubos(
      "WHERE t.activo=1 AND t.estado='en_planta' AND t.proveedor_id=? AND IFNULL(a.es_tubo,1)=1 ORDER BY t.numero",
      [pid],
    );
    const itemsDesp = await one(
      `SELECT COUNT(*) AS n FROM documento_items i
       JOIN documentos_planta d ON d.id=i.documento_id
       WHERE d.proveedor_id=? AND d.tipo='despacho'`,
      [pid],
    );
    const itemsRec = await one(
      `SELECT COUNT(*) AS n FROM documento_items i
       JOIN documentos_planta d ON d.id=i.documento_id
       WHERE d.proveedor_id=? AND d.tipo='recepcion' AND IFNULL(d.estado,'cerrado')!='borrador'`,
      [pid],
    );
    const docsDesp = await one(
      "SELECT COUNT(*) AS n FROM documentos_planta WHERE proveedor_id=? AND tipo='despacho'",
      [pid],
    );
    const docsRec = await one(
      `SELECT COUNT(*) AS n FROM documentos_planta
       WHERE proveedor_id=? AND tipo='recepcion' AND IFNULL(estado,'cerrado')!='borrador'`,
      [pid],
    );
    const movEnviados = await one(
      "SELECT COUNT(*) AS n FROM movimientos WHERE tipo='PLANSALI' AND IFNULL(observaciones,'') LIKE ?",
      [`%${String(row.nombre || "")}%`],
    );
    const movRecibidos = await one(
      "SELECT COUNT(*) AS n FROM movimientos WHERE tipo='PLANENTR' AND IFNULL(observaciones,'') LIKE ?",
      [`%${String(row.nombre || "")}%`],
    );
    const documentos = await all(
      `SELECT d.*, u.nombre AS usuario_nombre,
              (SELECT COUNT(*) FROM documento_items i WHERE i.documento_id=d.id) AS cantidad
       FROM documentos_planta d
       LEFT JOIN usuarios u ON u.id=d.usuario_id
       WHERE d.proveedor_id=?
       ORDER BY d.id DESC LIMIT 40`,
      [pid],
    );
    const movimientos = await all(
      `SELECT m.*, t.numero AS tubo_numero, a.codigo AS articulo_codigo
       FROM movimientos m
       LEFT JOIN tubos t ON t.id=m.tubo_id
       LEFT JOIN articulos a ON a.id=m.articulo_id
       WHERE m.tipo IN ('PLANSALI','PLANENTR') AND IFNULL(m.observaciones,'') LIKE ?
       ORDER BY m.id DESC LIMIT 50`,
      [`%${String(row.nombre || "")}%`],
    );
    return json({
      ok: true,
      proveedor: row,
      tubos,
      resumen: {
        en_posesion: tubos.length,
        tubos_enviados: Math.max(Number(itemsDesp?.n || 0), Number(movEnviados?.n || 0)),
        tubos_recibidos: Math.max(Number(itemsRec?.n || 0), Number(movRecibidos?.n || 0)),
        documentos_despacho: Number(docsDesp?.n || 0),
        documentos_recepcion: Number(docsRec?.n || 0),
      },
      documentos,
      movimientos,
    });
  }

  if (method === "PUT" && prv) {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const pid = Number(prv[1]);
    const row = await one("SELECT * FROM proveedores WHERE id=?", [pid]);
    if (!row) return err("Proveedor no encontrado.", 404);
    const data = await body(ctx);
    await run("UPDATE proveedores SET nombre=?, direccion=?, telefono=?, cuit=?, activo=? WHERE id=?", [
      String(data.nombre ?? row.nombre).trim().toUpperCase(),
      String(data.direccion ?? row.direccion ?? "").trim(),
      String(data.telefono ?? row.telefono ?? "").trim(),
      String(data.cuit ?? row.cuit ?? "").trim(),
      data.activo === undefined ? Number(row.activo) : data.activo ? 1 : 0,
      pid,
    ]);
    return json({ ok: true, proveedor: await one("SELECT * FROM proveedores WHERE id=?", [pid]) });
  }

  if (key === "POST /api/planta/identificar") {
    if (!puede(u, "admin", "despacho")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    const codigo = String(data.codigo || "").trim();
    const modo = String(data.modo || "despacho");
    const tubo = await buscarTubo(codigo, modo, data.proveedor_id);
    if (!tubo) {
      if (modo === "despacho") {
        return json({
          ok: true,
          resultado: "nuevo",
          codigo,
          tubo: {
            id: null,
            nuevo: true,
            numero: codigo,
            codigo_proveedor: codigo,
            articulo_descripcion: "Envase de cliente (no registrado)",
            estado: "vacio",
            propiedad: "cliente",
          },
        });
      }
      return json({ ok: true, resultado: "no_encontrado", codigo });
    }
    if (modo === "despacho") {
      const estado = String(tubo.estado || "");
      const avisos: string[] = [];
      const lab: Record<string, string> = {
        vacio: "vacío",
        en_planta: "en planta",
        cargado: "cargado",
        en_cliente: "en cliente",
      };
      const num = String(tubo.numero || tubo.codigo_proveedor || codigo);
      if (estado !== "vacio") {
        avisos.push(`El tubo ${num} no está en depósito vacíos (estado: ${lab[estado] || estado}).`);
      }
      if (tubo.cliente_id) {
        const quien = String(tubo.cliente_nombre || `cliente #${tubo.cliente_id}`);
        if (String(tubo.propiedad || "") === "cliente") avisos.push(`Es propiedad de ${quien}.`);
        else avisos.push(`Figura asignado / en poder de ${quien}.`);
      }
      if (avisos.length) {
        return json({
          ok: true,
          resultado: "ok",
          tubo,
          codigo,
          avisos,
          mensaje: avisos.join(" ") + " ¿Proseguir igual?",
          requiere_confirmacion: true,
        });
      }
      return json({ ok: true, resultado: "ok", tubo, codigo });
    }
    if (tubo.estado !== "en_planta") return json({ ok: true, resultado: "no_en_planta", tubo, codigo });
    if (data.proveedor_id && tubo.proveedor_id && Number(tubo.proveedor_id) !== Number(data.proveedor_id)) {
      return json({ ok: true, resultado: "otro_proveedor", tubo, codigo });
    }
    return json({ ok: true, resultado: "ok", tubo, codigo });
  }

  if (key === "POST /api/cliente/identificar") {
    if (!puede(u, "admin", "despacho", "reparto")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    const codigo = String(data.codigo || "").trim();
    const modo = String(data.modo || "despacho");
    const clienteId = data.cliente_id ? Number(data.cliente_id) : NaN;
    if (!codigo) return err("Falta el código.");
    if (Number.isFinite(clienteId)) {
      const cli = await one("SELECT * FROM clientes WHERE id=? AND activo=1", [clienteId]);
      if (!cli) return err("Cliente inválido.");
    } else if (modo !== "recepcion") {
      return err("Elegí el cliente.");
    }
    const tubo = await buscarTubo(codigo);
    if (!tubo) return json({ ok: true, resultado: "no_encontrado", codigo });
    if (modo === "despacho") {
      const estado = String(tubo.estado || "");
      const avisos: string[] = [];
      const lab: Record<string, string> = {
        vacio: "vacío",
        en_planta: "en planta",
        cargado: "cargado",
        en_cliente: "en cliente",
      };
      const num = String(tubo.numero || tubo.codigo_proveedor || codigo);
      if (estado !== "cargado") {
        avisos.push(`El tubo ${num} no está cargado en depósito (estado: ${lab[estado] || estado}).`);
      }
      if (Number.isFinite(clienteId) && tubo.cliente_id != null && Number(tubo.cliente_id) !== clienteId) {
        const otro = String(tubo.cliente_nombre || "otro cliente");
        avisos.push(`Está asignado / en poder de ${otro}.`);
      } else if (estado === "en_cliente" && Number.isFinite(clienteId) && Number(tubo.cliente_id) === clienteId) {
        avisos.push(`El tubo ${num} ya figura en este cliente.`);
      }
      if (avisos.length) {
        return json({
          ok: true,
          resultado: "ok",
          tubo,
          codigo,
          avisos,
          mensaje: avisos.join(" ") + " ¿Proseguir igual?",
          requiere_confirmacion: true,
        });
      }
      return json({ ok: true, resultado: "ok", tubo, codigo });
    }
    if (tubo.estado !== "en_cliente") return json({ ok: true, resultado: "no_en_cliente", tubo, codigo });
    if (Number.isFinite(clienteId) && tubo.cliente_id != null && Number(tubo.cliente_id) !== clienteId) {
      return json({ ok: true, resultado: "otro_cliente", tubo, codigo });
    }
    return json({ ok: true, resultado: "ok", tubo, codigo });
  }

  if (key === "GET /api/cliente/deuda") {
    if (!puede(u, "admin", "despacho", "reparto")) return err("No tiene permiso para esta acción.", 403);
    const clienteId = Number(q.get("cliente_id"));
    if (!Number.isFinite(clienteId)) return err("Elegí el cliente.");
    const tubos = await fetchTubos(
      "WHERE t.activo=1 AND t.estado='en_cliente' AND t.cliente_id=? AND IFNULL(a.es_tubo,1)=1 ORDER BY t.numero LIMIT 500",
      [clienteId],
    );
    return json({ ok: true, tubos, cantidad: tubos.length });
  }

  if (key === "GET /api/planta/deuda") {
    if (!puede(u, "admin", "despacho")) return err("No tiene permiso para esta acción.", 403);
    let extra = "WHERE t.activo=1 AND t.estado='en_planta'";
    const args: number[] = [];
    if (q.get("proveedor_id")) {
      extra += " AND t.proveedor_id=?";
      args.push(Number(q.get("proveedor_id")));
    }
    extra += " ORDER BY t.numero";
    return json({ ok: true, tubos: await fetchTubos(extra, args) });
  }

  if (key === "GET /api/planta/resumen") {
    if (!puede(u, "admin", "despacho")) return err("No tiene permiso para esta acción.", 403);
    const totalRow = await one(
      `SELECT COUNT(*) AS n FROM tubos t JOIN articulos a ON a.id=t.articulo_id
       WHERE t.activo=1 AND IFNULL(a.es_tubo,1)=1 AND t.estado='en_planta'`,
    );
    const sinRow = await one(
      `SELECT COUNT(*) AS n FROM tubos t JOIN articulos a ON a.id=t.articulo_id
       WHERE t.activo=1 AND IFNULL(a.es_tubo,1)=1 AND t.estado='en_planta' AND t.proveedor_id IS NULL`,
    );
    const plantas = await all(
      `SELECT p.id, p.nombre, p.telefono, COUNT(t.id) AS cantidad
       FROM proveedores p
       LEFT JOIN tubos t ON t.proveedor_id=p.id AND t.activo=1 AND t.estado='en_planta'
       WHERE p.activo=1
       GROUP BY p.id
       ORDER BY cantidad DESC, p.nombre`,
    );
    return json({
      ok: true,
      total: Number(totalRow?.n || 0),
      sin_planta: Number(sinRow?.n || 0),
      plantas,
    });
  }

  if (key === "POST /api/planta/despacho" || key === "POST /api/planta/recepcion") {
    if (!puede(u, "admin", "despacho")) return err("No tiene permiso para esta acción.", 403);
    return guardarDocumento(u, key.endsWith("despacho") ? "despacho" : "recepcion", await body(ctx));
  }

  if (key === "GET /api/planta/documentos") {
    if (!puede(u, "admin", "despacho")) return err("No tiene permiso para esta acción.", 403);
    const documentos = await all(
      `SELECT d.*, p.nombre AS proveedor_nombre, u.nombre AS usuario_nombre,
              (SELECT COUNT(*) FROM documento_items i WHERE i.documento_id=d.id) AS cantidad
       FROM documentos_planta d JOIN proveedores p ON p.id=d.proveedor_id
       LEFT JOIN usuarios u ON u.id=d.usuario_id ORDER BY d.id DESC LIMIT 80`,
    );
    return json({ ok: true, documentos });
  }

  if (key === "GET /api/reparto/campos") {
    const raw = await one("SELECT valor FROM config WHERE clave='reparto_campos'");
    const campos = raw?.valor ? JSON.parse(String(raw.valor)) : Object.fromEntries(CAMPOS_REPARTO.map((c) => [c, true]));
    return json({ ok: true, campos });
  }

  if (key === "PUT /api/reparto/campos") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    const campos = Object.fromEntries(CAMPOS_REPARTO.map((c) => [c, Boolean(data[c] ?? true)]));
    await run(
      "INSERT INTO config (clave, valor) VALUES ('reparto_campos', ?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor",
      [JSON.stringify(campos)],
    );
    return json({ ok: true, campos });
  }

  if (key === "GET /api/repartos") {
    let sql = `SELECT r.*, u.nombre AS chofer,
      (SELECT COUNT(*) FROM reparto_paradas rp WHERE rp.reparto_id=r.id) AS paradas_total,
      (SELECT COUNT(*) FROM reparto_paradas rp WHERE rp.reparto_id=r.id AND IFNULL(rp.completada,0)=1) AS paradas_hechas
      FROM repartos r LEFT JOIN usuarios u ON u.id=r.usuario_id`;
    const args: number[] = [];
    if (u.rol === "reparto") {
      sql += " WHERE r.usuario_id=? OR r.usuario_id IS NULL";
      args.push(u.id);
    }
    sql += " ORDER BY r.fecha DESC, r.id DESC LIMIT 60";
    return json({ ok: true, repartos: await all(sql, args) });
  }

  const rParadaPut = path.match(/^\/api\/repartos\/(\d+)\/paradas\/(\d+)$/);
  if (method === "PUT" && rParadaPut) {
    if (!puede(u, "admin", "reparto")) return err("No tiene permiso para esta acción.", 403);
    const rid = Number(rParadaPut[1]);
    const pid = Number(rParadaPut[2]);
    const row = await one("SELECT * FROM reparto_paradas WHERE id=? AND reparto_id=?", [pid, rid]);
    if (!row) return err("Parada no encontrada.", 404);
    const rep = await one("SELECT * FROM repartos WHERE id=?", [rid]);
    if (!rep) return err("Reparto no encontrado.", 404);
    if (u.rol === "reparto" && rep.usuario_id != null && Number(rep.usuario_id) !== Number(u.id)) {
      return err("Este reparto no está asignado a tu usuario.", 403);
    }
    const data = await body(ctx);
    if ("comentario" in data) {
      let comentario = String(data.comentario || "").trim();
      if (comentario.length > 800) comentario = comentario.slice(0, 800);
      await run("UPDATE reparto_paradas SET comentario=? WHERE id=?", [comentario || null, pid]);
    }
    if ("completada" in data || !("comentario" in data)) {
      const hecha = "completada" in data ? Boolean(data.completada) : !Number(row.completada);
      if (hecha) {
        await run(
          "UPDATE reparto_paradas SET completada=1, completada_en=?, completada_por=? WHERE id=?",
          [ahora(), u.id, pid],
        );
      } else {
        await run(
          "UPDATE reparto_paradas SET completada=0, completada_en=NULL, completada_por=NULL WHERE id=?",
          [pid],
        );
      }
    }
    const tot = await one(
      "SELECT COUNT(*) AS n, SUM(CASE WHEN completada=1 THEN 1 ELSE 0 END) AS hechas FROM reparto_paradas WHERE reparto_id=?",
      [rid],
    );
    const n = Number(tot?.n || 0);
    const hechas = Number(tot?.hechas || 0);
    const estado = n && hechas >= n ? "completado" : hechas > 0 ? "en_curso" : "abierto";
    await run("UPDATE repartos SET estado=? WHERE id=?", [estado, rid]);
    const raw = await one("SELECT valor FROM config WHERE clave='reparto_campos'");
    const campos = raw?.valor ? JSON.parse(String(raw.valor)) : {};
    const paradas = await paradasDe(rid, campos, String(u.rol));
    const parada = paradas.find((x) => Number(x.id) === pid) || null;
    return json({ ok: true, parada, estado, hechas, total: n });
  }

  const rGet = path.match(/^\/api\/repartos\/(\d+)$/);
  if (method === "GET" && rGet) {
    const rid = Number(rGet[1]);
    const r = await one(
      "SELECT r.*, u.nombre AS chofer FROM repartos r LEFT JOIN usuarios u ON u.id=r.usuario_id WHERE r.id=?",
      [rid],
    );
    if (!r) return err("Reparto no encontrado.", 404);
    const raw = await one("SELECT valor FROM config WHERE clave='reparto_campos'");
    const campos = raw?.valor ? JSON.parse(String(raw.valor)) : {};
    return json({ ok: true, reparto: r, paradas: await paradasDe(rid, campos, u.rol) });
  }

  if (key === "POST /api/repartos") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const data = await body(ctx);
    const fecha = parseFecha(data.fecha as string);
    const usuario_id = data.usuario_id ? Number(data.usuario_id) : null;
    const r = await run(
      "INSERT INTO repartos (fecha, usuario_id, creado_por, estado, observaciones, creado_en) VALUES (?,?,?,'abierto',?,?)",
      [fecha, usuario_id, u.id, String(data.observaciones || "").trim(), ahora()],
    );
    const rid = Number(r.lastInsertRowid);
    const paradas = (data.paradas || []) as Record<string, unknown>[];
    let i = 1;
    for (const parada of paradas) {
      const cid = Number(parada.cliente_id);
      if (!cid) continue;
      const pc = await run("INSERT INTO reparto_paradas (reparto_id, cliente_id, orden) VALUES (?,?,?)", [
        rid,
        cid,
        Number(parada.orden || i),
      ]);
      const pid = Number(pc.lastInsertRowid);
      for (const tar of (parada.tareas || []) as Record<string, unknown>[]) {
        const tipo = TAREAS.includes(String(tar.tipo)) ? String(tar.tipo) : "tarea";
        await run("INSERT INTO reparto_tareas (parada_id, tipo, detalle) VALUES (?,?,?)", [
          pid,
          tipo,
          String(tar.detalle || "").trim(),
        ]);
      }
      i += 1;
    }
    return json({ ok: true, id: rid });
  }

  return err("Ruta no encontrada.", 404);
}

async function operar(accion: string, data: Record<string, unknown>, usuarioId: number | null = null) {
  const [origen, destino, tipo] = TRANS[accion];
  const fecha = parseFecha(data.fecha as string);
  const observaciones = String(data.observaciones || "").trim();
  const uid = { usuario_id: usuarioId };

  if (accion === "recibir-planta") {
    let items = (data.items || []) as { id: number; lote?: string; fecha_vto?: string; numero?: string }[];
    if (!items.length) {
      const lote_comun = String(data.lote || "").trim().toUpperCase();
      const vto_comun = data.fecha_vto ? parseFecha(String(data.fecha_vto)) : "";
      items = idsFrom(data).map((id) => ({ id, lote: lote_comun, fecha_vto: vto_comun }));
    }
    if (!items.length) return err("Seleccione al menos un tubo.");
    for (const item of items) {
      const tubo = await one("SELECT * FROM tubos WHERE id=? AND activo=1", [Number(item.id)]);
      if (!tubo) return err(`Tubo ${item.id} no encontrado.`);
      if (tubo.estado !== origen) return err(`El tubo ${tubo.numero} no está en planta.`);
      const lote = String(item.lote || data.lote || "").trim().toUpperCase();
      const fecha_vto = item.fecha_vto || data.fecha_vto ? parseFecha(String(item.fecha_vto || data.fecha_vto)) : "";
      if (!lote) return err(`El tubo ${tubo.numero} necesita lote al volver de planta.`);
      let nuevo_numero = String(item.numero || "").trim();
      if (!nuevo_numero) {
        return err(`El número de trazabilidad es obligatorio (tubo ${tubo.codigo_proveedor || tubo.numero || item.id}).`);
      }
      if (nuevo_numero !== String(tubo.numero || "")) {
        const existe = await one("SELECT id FROM tubos WHERE activo=1 AND numero=? AND id!=?", [
          nuevo_numero,
          Number(item.id),
        ]);
        if (existe) return err(`Ya existe otro tubo con el número ${nuevo_numero}.`);
      }
      await run("UPDATE tubos SET numero=?, estado=?, lote=?, fecha_vto=?, cliente_id=NULL, actualizado_en=? WHERE id=?", [
        nuevo_numero,
        destino,
        lote,
        fecha_vto,
        ahora(),
        Number(item.id),
      ]);
      await registrarMovimiento({ ...tubo, numero: nuevo_numero, lote }, tipo, origen, destino, fecha, {
        lote,
        fecha_vto,
        observaciones: String(data.observaciones || "").trim() || "Retorno de planta (ciclo)",
        ...uid,
      });
    }
    return json({ ok: true, cantidad: items.length });
  }

  const ids = idsFrom(data);
  if (!ids.length) return err("Seleccione al menos un tubo.");
  let cliente_id: number | null = null;
  if (accion === "enviar-cliente") {
    cliente_id = Number(data.cliente_id);
    if (!cliente_id) return err("Debe elegir el cliente destino.");
    const cli = await one("SELECT * FROM clientes WHERE id=? AND activo=1", [cliente_id]);
    if (!cli) return err("Cliente inválido.");
  }
  let proveedor_id: number | null = null;
  let proveedor_nombre = "";
  if (accion === "enviar-planta") {
    const raw = data.proveedor_id;
    if (raw != null && raw !== "" && raw !== 0 && raw !== "0") {
      proveedor_id = Number(raw);
      if (!Number.isFinite(proveedor_id)) return err("Proveedor / planta inválido.");
      const prov = await one("SELECT id, nombre FROM proveedores WHERE id=? AND activo=1", [proveedor_id]);
      if (!prov) return err("Proveedor / planta inválido.");
      proveedor_nombre = String(prov.nombre || "");
    } else {
      return err("Debe elegir la planta destino.");
    }
  }
  const remito = String(data.remito || "").trim();
  for (const tid of ids) {
    const tubo = await one("SELECT * FROM tubos WHERE id=? AND activo=1", [tid]);
    if (!tubo) return err(`Tubo ${tid} no encontrado.`);
    if (accion === "enviar-planta") {
      // Cualquier estado (UI ya advertó si no estaba vacío).
    } else if (accion === "enviar-cliente") {
      // Cualquier estado (UI ya advertó si no estaba cargado / otro cliente).
    } else if (tubo.estado !== origen) {
      return err(`El tubo ${tubo.numero} no está en el estado esperado.`);
    }
    if (accion === "enviar-cliente") {
      let obsCli = observaciones;
      if (remito) obsCli = (`Remito ${remito}` + (observaciones ? ` · ${observaciones}` : "")).trim();
      await run("UPDATE tubos SET estado=?, cliente_id=?, actualizado_en=? WHERE id=?", [
        destino,
        cliente_id,
        ahora(),
        tid,
      ]);
      await registrarMovimiento(tubo, tipo, String(tubo.estado), destino, fecha, {
        cliente_id,
        lote: String(tubo.lote || ""),
        fecha_vto: String(tubo.fecha_vto || ""),
        observaciones: obsCli,
        ...uid,
      });
    } else if (accion === "enviar-planta") {
      const partes: string[] = [];
      if (remito) partes.push(`Remito ${remito}`);
      if (proveedor_nombre) partes.push(proveedor_nombre);
      if (observaciones) partes.push(observaciones);
      if (String(tubo.estado) !== "vacio") partes.push(`Salía de ${tubo.estado}`);
      if (String(tubo.propiedad || "empresa") === "cliente") {
        await run("UPDATE tubos SET estado=?, proveedor_id=?, actualizado_en=? WHERE id=?", [
          destino,
          proveedor_id,
          ahora(),
          tid,
        ]);
      } else {
        await run("UPDATE tubos SET estado=?, proveedor_id=?, cliente_id=NULL, actualizado_en=? WHERE id=?", [
          destino,
          proveedor_id,
          ahora(),
          tid,
        ]);
      }
      await registrarMovimiento(tubo, tipo, String(tubo.estado), destino, fecha, {
        observaciones: partes.join(" · ") || "Envío a planta",
        ...uid,
      });
    } else if (accion === "cargar-empresa") {
      const lote = String(data.lote || tubo.lote || "").trim().toUpperCase();
      const fecha_vto = data.fecha_vto ? parseFecha(String(data.fecha_vto)) : String(tubo.fecha_vto || "");
      await run("UPDATE tubos SET estado=?, lote=?, fecha_vto=?, cliente_id=NULL, actualizado_en=? WHERE id=?", [
        destino,
        lote,
        fecha_vto,
        ahora(),
        tid,
      ]);
      await registrarMovimiento(tubo, tipo, origen, destino, fecha, { lote, fecha_vto, observaciones, ...uid });
    } else {
      await run("UPDATE tubos SET estado=?, cliente_id=NULL, actualizado_en=? WHERE id=?", [destino, ahora(), tid]);
      await registrarMovimiento(tubo, tipo, origen, destino, fecha, {
        cliente_id: accion === "recibir-cliente" ? Number(tubo.cliente_id) : null,
        observaciones,
        ...uid,
      });
    }
  }
  return json({ ok: true, cantidad: ids.length });
}

async function asegurarNoreg() {
  const row = await one("SELECT * FROM articulos WHERE codigo='NOREG'");
  if (row) {
    // Debe ser tubo (entra en rotación / inicio / filtro estado). Si quedó como genérico, lo corregimos.
    if (!Number(row.es_tubo || 0)) {
      await run(
        `UPDATE articulos SET es_tubo=1,
           grupo=COALESCE(NULLIF(grupo,''),'CLIENTES'),
           propiedad_default=COALESCE(NULLIF(propiedad_default,''),'cliente'),
           codigo_proveedor=COALESCE(NULLIF(codigo_proveedor,''),'NOREG')
         WHERE id=?`,
        [Number(row.id)],
      );
      return one("SELECT * FROM articulos WHERE id=?", [Number(row.id)]);
    }
    return row;
  }
  const r = await run(
    `INSERT INTO articulos (codigo, descripcion, activo, creado_en, es_tubo, grupo, propiedad_default, codigo_proveedor)
     VALUES ('NOREG', 'ENVASE CLIENTE NO REGISTRADO', 1, ?, 1, 'CLIENTES', 'cliente', 'NOREG')`,
    [ahora()],
  );
  return one("SELECT * FROM articulos WHERE id=?", [Number(r.lastInsertRowid)]);
}

async function guardarDocumento(u: Usuario, tipo: string, data: Record<string, unknown>) {
  const proveedor_id = Number(data.proveedor_id);
  if (!proveedor_id) return err("Debe elegir el proveedor.");
  const ids = idsFrom(data).filter((n) => n > 0);
  const nuevos = ((data.codigos_nuevos as unknown[]) || [])
    .map((c) => String(c || "").trim())
    .filter(Boolean);
  if (tipo === "despacho") {
    if (!ids.length && !nuevos.length) return err("La lista de tubos está vacía.");
  } else if (!ids.length) {
    return err("La lista de tubos está vacía.");
  }
  const prov = await one("SELECT * FROM proveedores WHERE id=? AND activo=1", [proveedor_id]);
  if (!prov) return err("Proveedor inválido.");
  const remito = String(data.remito || "").trim();
  const obs = String(data.observaciones || "").trim();
  let fecha = parseFecha(data.fecha as string);
  let hora = String(data.hora || ahora().slice(11, 16));
  const lote = String(data.lote || "").trim().toUpperCase();
  const fecha_vto = data.fecha_vto ? parseFecha(String(data.fecha_vto)) : "";
  if (!puedeConceptos(u)) {
    fecha = parseFecha(ahora().slice(0, 10));
    hora = ahora().slice(11, 16);
  }
  const lotesRaw = (data.lotes && typeof data.lotes === "object" ? data.lotes : {}) as Record<string, unknown>;
  if (tipo === "despacho" && nuevos.length) {
    const art = await asegurarNoreg();
    const tnow = ahora();
    for (const codigo of nuevos) {
      const existe = await buscarTubo(codigo);
      if (existe) {
        ids.push(Number(existe.id));
        continue;
      }
      const ins = await run(
        `INSERT INTO tubos (numero, articulo_id, lote, fecha_vto, estado, cliente_id, notas, activo, creado_en, actualizado_en, propiedad, codigo_proveedor)
         VALUES (?, ?, '', '', 'vacio', NULL, 'Alta al despachar a planta (no estaba registrado)', 1, ?, ?, 'cliente', ?)`,
        [codigo, Number(art!.id), tnow, tnow, codigo],
      );
      const tuboAlta = await one("SELECT * FROM tubos WHERE id=?", [Number(ins.lastInsertRowid)]);
      await registrarMovimiento(tuboAlta!, "ALTA", null, "vacio", fecha, {
        observaciones: "Envase de cliente no registrado, alta en despacho a planta",
      });
      ids.push(Number(ins.lastInsertRowid));
    }
  }
  const doc = await run(
    `INSERT INTO documentos_planta (tipo, proveedor_id, usuario_id, remito, fecha, hora, observaciones, creado_en)
     VALUES (?,?,?,?,?,?,?,?)`,
    [tipo, proveedor_id, u.id, remito, fecha, hora, obs, ahora()],
  );
  const doc_id = Number(doc.lastInsertRowid);
  const vistos = new Set<number>();
  let cantidad = 0;
  for (const tid of ids) {
    if (vistos.has(tid)) continue;
    vistos.add(tid);
    const tubo = await one("SELECT * FROM tubos WHERE id=? AND activo=1", [tid]);
    if (!tubo) return err(`Tubo ${tid} no encontrado.`);
    if (tipo === "despacho") {
      // Cualquier estado: la UI ya pidió confirmación si no estaba vacío.
      if (String(tubo.propiedad || "empresa") === "cliente") {
        await run("UPDATE tubos SET estado='en_planta', proveedor_id=?, actualizado_en=? WHERE id=?", [
          proveedor_id,
          ahora(),
          tid,
        ]);
      } else {
        await run("UPDATE tubos SET estado='en_planta', proveedor_id=?, cliente_id=NULL, actualizado_en=? WHERE id=?", [
          proveedor_id,
          ahora(),
          tid,
        ]);
      }
      await registrarMovimiento(tubo, "PLANSALI", String(tubo.estado), "en_planta", fecha, {
        observaciones:
          (remito ? `Remito ${remito}` : "Despacho a planta") +
          (String(tubo.estado) !== "vacio" ? ` · Salía de ${tubo.estado}` : ""),
      });
    } else {
      if (tubo.estado !== "en_planta") return err(`El tubo ${tubo.numero} no está en planta: primero hay que despacharlo.`);
      if (tubo.proveedor_id && Number(tubo.proveedor_id) !== Number(proveedor_id)) {
        return err(`El tubo ${tubo.numero} está en otra planta.`);
      }
      const loteTubo = String(lotesRaw[String(tid)] ?? lotesRaw[tid] ?? lote ?? "").trim().toUpperCase();
      if (!loteTubo) return err(`Falta el número de lote del tubo ${tubo.numero}.`);
      await run(
        "UPDATE tubos SET estado='cargado', proveedor_id=NULL, lote=?, fecha_vto=CASE WHEN ?!='' THEN ? ELSE fecha_vto END, actualizado_en=? WHERE id=?",
        [loteTubo, fecha_vto, fecha_vto, ahora(), tid],
      );
      await registrarMovimiento(tubo, "PLANENTR", "en_planta", "cargado", fecha, {
        lote: loteTubo,
        fecha_vto: fecha_vto || String(tubo.fecha_vto || ""),
        observaciones: `Remito ${remito}`,
      });
      await run("INSERT INTO documento_items (documento_id, tubo_id, codigo_leido, lote) VALUES (?,?,?,?)", [
        doc_id,
        tid,
        String(tubo.codigo_proveedor || tubo.numero),
        loteTubo,
      ]);
      cantidad += 1;
      continue;
    }
    await run("INSERT INTO documento_items (documento_id, tubo_id, codigo_leido) VALUES (?,?,?)", [
      doc_id,
      tid,
      String(tubo.codigo_proveedor || tubo.numero),
    ]);
    cantidad += 1;
  }
  return json({ ok: true, id: doc_id, cantidad });
}

async function paradasDe(rid: number, campos: Record<string, boolean>, rol: string) {
  const paradas = [];
  for (const p of await all(
    `SELECT rp.*, c.nombre, c.direccion, c.telefono, c.localidad, c.codigo
     FROM reparto_paradas rp JOIN clientes c ON c.id=rp.cliente_id
     WHERE rp.reparto_id=? ORDER BY rp.orden, rp.id`,
    [rid],
  )) {
    const item: Record<string, unknown> = { ...p };
    if (rol === "reparto") {
      if (!campos.direccion) item.direccion = "";
      if (!campos.telefono) item.telefono = "";
      if (!campos.localidad) item.localidad = "";
    }
    item.tareas = await all("SELECT * FROM reparto_tareas WHERE parada_id=? ORDER BY id", [Number(p.id)]);
    if (rol !== "reparto" || campos.tubos) {
      item.tubos = await all(
        `SELECT t.numero, t.codigo_proveedor, a.descripcion FROM tubos t JOIN articulos a ON a.id=t.articulo_id
         WHERE t.cliente_id=? AND t.estado='en_cliente' AND t.activo=1`,
        [Number(p.cliente_id)],
      );
    } else item.tubos = [];
    paradas.push(item);
  }
  return paradas;
}
