import type { APIContext } from "astro";
import { all, one, run } from "./db";
import { puede, type Usuario } from "./auth";

const DIAS_FRIO = 21;

function ahora() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function hoy() {
  return ahora().slice(0, 10);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function err(mensaje: string, codigo = 400) {
  return json({ ok: false, error: mensaje }, codigo);
}

function diasEntre(desde: string | null | undefined, hoyTxt: string): number | null {
  if (!desde) return null;
  try {
    const a = new Date(String(desde).slice(0, 10) + "T12:00:00");
    const b = new Date(hoyTxt + "T12:00:00");
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  } catch {
    return null;
  }
}

function marcar(ultimo: string | null | undefined, hoyTxt: string) {
  const dias = diasEntre(ultimo || "", hoyTxt);
  if (dias == null) return { dias: null, frio: true, ultimo: null as string | null };
  return { dias, frio: dias >= DIAS_FRIO, ultimo: String(ultimo).slice(0, 10) };
}

let ready = false;

export async function ensureProspeccion() {
  if (ready) return;
  await run(`CREATE TABLE IF NOT EXISTS prospectos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    codigo TEXT,
    cuit TEXT,
    telefono TEXT,
    direccion TEXT,
    localidad TEXT,
    lugar TEXT,
    rubro TEXT,
    notas TEXT,
    estado TEXT NOT NULL DEFAULT 'activo',
    cliente_id INTEGER,
    creado_en TEXT NOT NULL,
    actualizado_en TEXT NOT NULL
  )`);
  await run(`CREATE TABLE IF NOT EXISTS seguimiento (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prospecto_id INTEGER,
    cliente_id INTEGER,
    fecha TEXT NOT NULL,
    hora TEXT,
    clase TEXT NOT NULL,
    detalle TEXT NOT NULL,
    lugar TEXT,
    titulo TEXT,
    proxima_fecha TEXT,
    proxima_hora TEXT,
    proxima_detalle TEXT,
    tarea_estado TEXT,
    usuario_id INTEGER,
    creado_en TEXT NOT NULL
  )`);
  try {
    await run("CREATE INDEX IF NOT EXISTS idx_seg_pros ON seguimiento(prospecto_id)");
  } catch { /* ok */ }
  try {
    await run("CREATE INDEX IF NOT EXISTS idx_seg_cli ON seguimiento(cliente_id)");
  } catch { /* ok */ }
  try {
    await run("CREATE INDEX IF NOT EXISTS idx_seg_prox ON seguimiento(proxima_fecha)");
  } catch { /* ok */ }
  try {
    await run("ALTER TABLE clientes ADD COLUMN seguimiento_activo INTEGER NOT NULL DEFAULT 0");
  } catch { /* ok */ }
  try {
    await run("ALTER TABLE seguimiento ADD COLUMN titulo TEXT");
  } catch { /* ok */ }
  ready = true;
}

export async function handleProspeccion(
  ctx: APIContext,
  u: Usuario,
  method: string,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith("/api/prospeccion")) return null;
  if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
  await ensureProspeccion();
  const q = ctx.url.searchParams;
  const key = `${method} ${path}`;
  const hoyTxt = hoy();

  if (key === "GET /api/prospeccion") {
    const corte = new Date(hoyTxt + "T12:00:00");
    corte.setDate(corte.getDate() - 30);
    const desde = new Date(hoyTxt + "T12:00:00");
    desde.setDate(desde.getDate() - 150);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const corteS = fmt(corte);
    const desdeS = fmt(desde);

    const agendaRaw = await all(
      `SELECT s.*, p.nombre AS prospecto_nombre, p.lugar AS prospecto_lugar,
              c.nombre AS cliente_nombre, c.codigo AS cliente_codigo, c.direccion AS cliente_direccion,
              (SELECT MAX(s2.fecha) FROM seguimiento s2
               WHERE (s.cliente_id IS NOT NULL AND s2.cliente_id=s.cliente_id)
                  OR (s.prospecto_id IS NOT NULL AND s2.prospecto_id=s.prospecto_id)
              ) AS ultimo_contacto
       FROM seguimiento s
       LEFT JOIN prospectos p ON p.id = s.prospecto_id
       LEFT JOIN clientes c ON c.id = s.cliente_id
       WHERE s.tarea_estado='pendiente' AND IFNULL(s.proxima_fecha,'')!=''
         AND (s.prospecto_id IS NULL OR p.estado='activo')
       ORDER BY s.proxima_fecha, IFNULL(s.proxima_hora,'')
       LIMIT 200`,
    );
    const agenda = agendaRaw.map((r) => {
      const item = { ...r } as Record<string, unknown>;
      const prox = String(item.proxima_fecha || "");
      item.vencida = prox < hoyTxt;
      item.dias_atraso = item.vencida ? diasEntre(prox, hoyTxt) : 0;
      item.quien = item.prospecto_nombre || item.cliente_nombre || "—";
      item.cliente_asignado = item.cliente_nombre
        ? `${item.cliente_codigo ? item.cliente_codigo + " · " : ""}${item.cliente_nombre}`
        : (item.prospecto_nombre || "—");
      item.lugar_mostrar = item.lugar || item.prospecto_lugar || item.cliente_direccion || "";
      const ult = marcar(String(item.ultimo_contacto || ""), hoyTxt);
      item.dias_ultimo = ult.dias;
      return item;
    });

    const prospectosRaw = await all(
      `SELECT p.*,
              (SELECT MAX(fecha) FROM seguimiento s WHERE s.prospecto_id=p.id) AS ultimo,
              (SELECT detalle FROM seguimiento s WHERE s.prospecto_id=p.id ORDER BY s.id DESC LIMIT 1) AS ultimo_detalle
       FROM prospectos p
       WHERE p.estado='activo'
       ORDER BY COALESCE((SELECT MAX(fecha) FROM seguimiento s WHERE s.prospecto_id=p.id), '0000') ASC, p.nombre`,
    );
    const prospectos = prospectosRaw.map((r) => ({ ...r, ...marcar(String(r.ultimo || ""), hoyTxt) }));

    const seguidosRaw = await all(
      `SELECT c.id, c.codigo, c.nombre, c.direccion, c.telefono, c.localidad,
              (SELECT MAX(fecha) FROM seguimiento s WHERE s.cliente_id=c.id) AS ultimo,
              (SELECT detalle FROM seguimiento s2 WHERE s2.cliente_id=c.id ORDER BY s2.id DESC LIMIT 1) AS ultimo_detalle
       FROM clientes c
       WHERE IFNULL(c.seguimiento_activo,0)=1 AND IFNULL(c.activo,1)=1
       ORDER BY COALESCE((SELECT MAX(fecha) FROM seguimiento s WHERE s.cliente_id=c.id), '0000') ASC, c.nombre
       LIMIT 200`,
    );
    const seguidos = seguidosRaw.map((r) => ({ ...r, ...marcar(String(r.ultimo || ""), hoyTxt) }));

    const dejaronRaw = await all(
      `SELECT c.id, c.codigo, c.nombre, c.direccion, c.telefono,
              ROUND(SUM(v.total), 2) AS anterior,
              MAX(v.fecha) AS ultima_compra
       FROM ventas_caja v
       JOIN clientes c ON c.id = v.cliente_id
       WHERE v.tipo!='salida' AND v.fecha>=? AND v.fecha<?
         AND NOT EXISTS (
           SELECT 1 FROM ventas_caja r
           WHERE r.cliente_id=v.cliente_id AND r.tipo!='salida' AND r.fecha>=?
         )
       GROUP BY c.id
       HAVING anterior > 0
       ORDER BY anterior DESC
       LIMIT 40`,
      [desdeS, corteS, corteS],
    );
    const dejaron = [];
    for (const r of dejaronRaw) {
      const ult = await one("SELECT MAX(fecha) AS f FROM seguimiento WHERE cliente_id=?", [r.id]);
      const item = { ...r, ...marcar(ult?.f ? String(ult.f) : null, hoyTxt) };
      item.sin_compra_dias = diasEntre(String(r.ultima_compra || ""), hoyTxt);
      dejaron.push(item);
    }

    return json({
      ok: true,
      dias_frio: DIAS_FRIO,
      agenda,
      prospectos,
      seguidos,
      dejaron,
    });
  }

  if (key === "GET /api/prospeccion/ficha") {
    const pid = q.get("prospecto_id");
    const cid = q.get("cliente_id");
    let entidad: Record<string, unknown> | null = null;
    let notas: Record<string, unknown>[] = [];
    if (pid) {
      const row = await one("SELECT * FROM prospectos WHERE id=?", [Number(pid)]);
      if (!row) return err("Prospecto no encontrado.", 404);
      entidad = { ...row, tipo: "prospecto" };
      notas = await all(
        "SELECT * FROM seguimiento WHERE prospecto_id=? ORDER BY fecha DESC, id DESC",
        [Number(pid)],
      );
    } else if (cid) {
      const row = await one(
        "SELECT id, codigo, nombre, direccion, telefono, cuit, localidad, seguimiento_activo FROM clientes WHERE id=?",
        [Number(cid)],
      );
      if (!row) return err("Cliente no encontrado.", 404);
      entidad = { ...row, tipo: "cliente" };
      notas = await all(
        "SELECT * FROM seguimiento WHERE cliente_id=? ORDER BY fecha DESC, id DESC",
        [Number(cid)],
      );
    } else {
      return err("Indicá el prospecto o el cliente.");
    }
    const marca = marcar(notas[0] ? String(notas[0].fecha) : null, hoyTxt);
    return json({ ok: true, entidad, notas, ...marca, dias_frio: DIAS_FRIO });
  }

  if (key === "POST /api/prospeccion/prospectos") {
    const data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = String(data.nombre || "").trim();
    if (nombre.length < 2) return err("El nombre es obligatorio.");
    const t = ahora();
    const r = await run(
      `INSERT INTO prospectos (
        nombre, codigo, cuit, telefono, direccion, localidad, lugar, rubro, notas,
        estado, creado_en, actualizado_en
      ) VALUES (?,?,?,?,?,?,?,?,?,'activo',?,?)`,
      [
        nombre,
        String(data.codigo || "").trim(),
        String(data.cuit || "").trim(),
        String(data.telefono || "").trim(),
        String(data.direccion || "").trim(),
        String(data.localidad || "").trim(),
        String(data.lugar || "").trim(),
        String(data.rubro || "").trim(),
        String(data.notas || "").trim(),
        t,
        t,
      ],
    );
    const prospecto = await one("SELECT * FROM prospectos WHERE id=?", [Number(r.lastInsertRowid)]);
    return json({ ok: true, prospecto });
  }

  const putPros = path.match(/^\/api\/prospeccion\/prospectos\/(\d+)$/);
  if (method === "PUT" && putPros) {
    const pid = Number(putPros[1]);
    const row = await one("SELECT * FROM prospectos WHERE id=?", [pid]);
    if (!row) return err("Prospecto no encontrado.", 404);
    const data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    let estado = String(data.estado ?? row.estado).trim().toLowerCase();
    if (!["activo", "descartado", "convertido"].includes(estado)) estado = String(row.estado);
    await run(
      `UPDATE prospectos
       SET nombre=?, codigo=?, cuit=?, telefono=?, direccion=?, localidad=?, lugar=?, rubro=?, notas=?,
           estado=?, actualizado_en=?
       WHERE id=?`,
      [
        String(data.nombre ?? row.nombre).trim(),
        String(data.codigo ?? row.codigo ?? "").trim(),
        String(data.cuit ?? row.cuit ?? "").trim(),
        String(data.telefono ?? row.telefono ?? "").trim(),
        String(data.direccion ?? row.direccion ?? "").trim(),
        String(data.localidad ?? row.localidad ?? "").trim(),
        String(data.lugar ?? row.lugar ?? "").trim(),
        String(data.rubro ?? row.rubro ?? "").trim(),
        String(data.notas ?? row.notas ?? "").trim(),
        estado,
        ahora(),
        pid,
      ],
    );
    return json({ ok: true, prospecto: await one("SELECT * FROM prospectos WHERE id=?", [pid]) });
  }

  const aCli = path.match(/^\/api\/prospeccion\/prospectos\/(\d+)\/a-cliente$/);
  if (method === "POST" && aCli) {
    const pid = Number(aCli[1]);
    const row = await one("SELECT * FROM prospectos WHERE id=?", [pid]);
    if (!row) return err("Prospecto no encontrado.", 404);
    if (row.cliente_id) return json({ ok: true, cliente_id: row.cliente_id });
    const direccion = String(row.direccion || "").trim();
    const cuit = String(row.cuit || "").trim();
    if (!direccion || !cuit) return err("Para pasarlo a cliente completá dirección y CUIT.");
    try {
      const ins = await run(
        `INSERT INTO clientes (codigo, nombre, direccion, telefono, localidad, cuit, activo, creado_en, seguimiento_activo)
         VALUES (?,?,?,?,?,?,1,?,1)`,
        [
          String(row.codigo || "") || null,
          String(row.nombre || "").trim().toUpperCase(),
          direccion,
          row.telefono || "",
          row.localidad || "",
          cuit,
          ahora(),
        ],
      );
      const cid = Number(ins.lastInsertRowid);
      await run("UPDATE prospectos SET estado='convertido', cliente_id=?, actualizado_en=? WHERE id=?", [
        cid,
        ahora(),
        pid,
      ]);
      await run("UPDATE seguimiento SET cliente_id=? WHERE prospecto_id=?", [cid, pid]);
      return json({ ok: true, cliente_id: cid });
    } catch {
      return err("No se pudo crear el cliente (¿nombre o código duplicado?).");
    }
  }

  if (key === "POST /api/prospeccion/notas") {
    const data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const detalle = String(data.detalle || "").trim();
    if (detalle.length < 2) return err("Escribí qué pasó en el contacto.");
    let clase = String(data.clase || "nota").trim().toLowerCase();
    if (!["nota", "llamada", "visita", "tarea"].includes(clase)) clase = "nota";
    let pid = data.prospecto_id ? Number(data.prospecto_id) : null;
    let cid = data.cliente_id ? Number(data.cliente_id) : null;
    if (!Number.isFinite(pid as number)) pid = null;
    if (!Number.isFinite(cid as number)) cid = null;
    if (!pid && !cid) return err("Indicá a quién corresponde el contacto.");
    const proxima = String(data.proxima_fecha || "").trim().slice(0, 10);
    const t = ahora();
    await run(
      `INSERT INTO seguimiento (
        prospecto_id, cliente_id, fecha, hora, clase, detalle, lugar,
        proxima_fecha, proxima_hora, proxima_detalle, tarea_estado, usuario_id, creado_en
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        pid,
        cid,
        String(data.fecha || hoyTxt).slice(0, 10),
        String(data.hora || t.slice(11, 16)).slice(0, 5),
        clase,
        detalle,
        String(data.lugar || "").trim(),
        proxima,
        String(data.proxima_hora || "").trim().slice(0, 5),
        String(data.proxima_detalle || "").trim(),
        proxima ? "pendiente" : null,
        u.id,
        t,
      ],
    );
    if (cid) await run("UPDATE clientes SET seguimiento_activo=1 WHERE id=?", [cid]);
    return json({ ok: true });
  }

  const putNota = path.match(/^\/api\/prospeccion\/notas\/(\d+)$/);
  if (method === "PUT" && putNota) {
    const nid = Number(putNota[1]);
    const row = await one("SELECT * FROM seguimiento WHERE id=?", [nid]);
    if (!row) return err("Actividad no encontrada.", 404);
    const data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const estado = String(data.tarea_estado || "").trim().toLowerCase();
    if (!["pendiente", "hecha"].includes(estado)) return err("Estado inválido.");
    await run("UPDATE seguimiento SET tarea_estado=? WHERE id=?", [estado, nid]);
    return json({ ok: true });
  }

  const actCli = path.match(/^\/api\/prospeccion\/clientes\/(\d+)\/activar$/);
  if (method === "PUT" && actCli) {
    const cid = Number(actCli[1]);
    const row = await one("SELECT id FROM clientes WHERE id=?", [cid]);
    if (!row) return err("Cliente no encontrado.", 404);
    const data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const activo = data.activo === false || data.activo === 0 || data.activo === "0" ? 0 : 1;
    await run("UPDATE clientes SET seguimiento_activo=? WHERE id=?", [activo, cid]);
    return json({ ok: true, seguimiento_activo: activo });
  }

  if (key === "GET /api/prospeccion/calendario") {
    let mes = (q.get("mes") || hoyTxt.slice(0, 7)).trim();
    if (mes.length !== 7 || mes[4] !== "-") mes = hoyTxt.slice(0, 7);
    const anio = Number(mes.slice(0, 4));
    const mesN = Number(mes.slice(5, 7));
    const hasta = mesN === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mesN + 1).padStart(2, "0")}-01`;
    const desde = `${mes}-01`;
    const eventosRaw = await all(
      `SELECT s.*, p.nombre AS prospecto_nombre, p.lugar AS prospecto_lugar,
              c.nombre AS cliente_nombre, c.codigo AS cliente_codigo, c.direccion AS cliente_direccion,
              u.nombre AS usuario_nombre
       FROM seguimiento s
       LEFT JOIN prospectos p ON p.id = s.prospecto_id
       LEFT JOIN clientes c ON c.id = s.cliente_id
       LEFT JOIN usuarios u ON u.id = s.usuario_id
       WHERE IFNULL(s.proxima_fecha,'')!=''
         AND s.proxima_fecha >= ? AND s.proxima_fecha < ?
         AND (s.prospecto_id IS NULL OR IFNULL(p.estado,'activo')='activo')
       ORDER BY s.proxima_fecha, IFNULL(s.proxima_hora,''), s.id`,
      [desde, hasta],
    );
    const eventos = eventosRaw.map((r) => {
      const item = { ...r } as Record<string, unknown>;
      item.vencida =
        item.tarea_estado === "pendiente" && String(item.proxima_fecha || "") < hoyTxt;
      item.dias_atraso = item.vencida ? diasEntre(String(item.proxima_fecha || ""), hoyTxt) : 0;
      item.quien = item.prospecto_nombre || item.cliente_nombre || "—";
      item.cliente_asignado = item.cliente_nombre
        ? `${item.cliente_codigo ? item.cliente_codigo + " · " : ""}${item.cliente_nombre}`
        : (item.prospecto_nombre || null);
      item.lugar_mostrar = item.lugar || item.prospecto_lugar || item.cliente_direccion || "";
      return item;
    });
    const por_dia: Record<string, unknown[]> = {};
    for (const ev of eventos) {
      const d = String(ev.proxima_fecha || "").slice(0, 10);
      if (!por_dia[d]) por_dia[d] = [];
      por_dia[d].push(ev);
    }
    return json({
      ok: true,
      mes,
      desde,
      hasta,
      hoy: hoyTxt,
      eventos,
      por_dia,
      pendientes: eventos.filter((e) => e.tarea_estado === "pendiente").length,
      hechas: eventos.filter((e) => e.tarea_estado === "hecha").length,
    });
  }

  if (key === "POST /api/prospeccion/calendario") {
    const data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const fecha = String(data.proxima_fecha || data.fecha || "").trim().slice(0, 10);
    if (fecha.length !== 10) return err("Indicá la fecha de la actividad.");
    const detalle = String(data.proxima_detalle || data.detalle || "").trim();
    if (detalle.length < 2) return err("Escribí qué hay que hacer.");
    let clase = String(data.clase || "tarea").trim().toLowerCase();
    if (!["nota", "llamada", "visita", "tarea"].includes(clase)) clase = "tarea";
    let pid = data.prospecto_id ? Number(data.prospecto_id) : null;
    let cid = data.cliente_id ? Number(data.cliente_id) : null;
    if (!Number.isFinite(pid as number)) pid = null;
    if (!Number.isFinite(cid as number)) cid = null;
    const t = ahora();
    const r = await run(
      `INSERT INTO seguimiento (
        prospecto_id, cliente_id, fecha, hora, clase, detalle, lugar, titulo,
        proxima_fecha, proxima_hora, proxima_detalle, tarea_estado, usuario_id, creado_en
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pendiente',?,?)`,
      [
        pid,
        cid,
        hoyTxt,
        t.slice(11, 16),
        clase,
        detalle,
        String(data.lugar || "").trim(),
        String(data.titulo || "").trim(),
        fecha,
        String(data.proxima_hora || data.hora || "").trim().slice(0, 5),
        detalle,
        u.id,
        t,
      ],
    );
    if (cid) await run("UPDATE clientes SET seguimiento_activo=1 WHERE id=?", [cid]);
    return json({ ok: true, id: Number(r.lastInsertRowid) });
  }

  return err("Ruta no encontrada.", 404);
}
