import type { APIContext } from "astro";
import { all, one, run } from "./db";
import { puede, type Usuario } from "./auth";

const GASES: [string, string, number][] = [
  ["oxigeno", "Oxígeno", 1],
  ["co2", "CO2", 2],
  ["nitrogeno", "Nitrógeno", 3],
  ["argon", "Argón", 4],
  ["athal", "Athal", 5],
  ["helio", "Helio", 6],
];

function ahora() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function hoy() {
  return ahora().slice(0, 10);
}

function parseFecha(valor?: string | null) {
  const s = String(valor || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return hoy();
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

let cajaReady = false;

export async function ensureCaja() {
  if (cajaReady) return;
  await run(`CREATE TABLE IF NOT EXISTS precios_caja (
    clave TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL,
    precio REAL NOT NULL DEFAULT 0,
    unidad TEXT NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0
  )`);
  await run(`CREATE TABLE IF NOT EXISTS ventas_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    hora TEXT NOT NULL,
    tipo TEXT NOT NULL,
    gas TEXT,
    descripcion TEXT NOT NULL,
    cantidad REAL NOT NULL DEFAULT 1,
    precio_unitario REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    medio_pago TEXT NOT NULL DEFAULT 'efectivo',
    facturar INTEGER NOT NULL DEFAULT 0,
    estado_factura TEXT NOT NULL DEFAULT 'no',
    cliente_id INTEGER,
    cliente_nombre TEXT,
    cliente_cuit TEXT,
    usuario_id INTEGER,
    creado_en TEXT NOT NULL,
    actualizado_en TEXT NOT NULL
  )`);
  try {
    await run("CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas_caja(fecha)");
  } catch { /* ok */ }
  try {
    await run("CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas_caja(estado_factura)");
  } catch { /* ok */ }
  try {
    await run("ALTER TABLE ventas_caja ADD COLUMN medio_pago TEXT NOT NULL DEFAULT 'efectivo'");
  } catch { /* ok */ }
  for (const [clave, nombre, orden] of GASES) {
    const unidadGas = clave === "co2" ? "kg" : "m3";
    await run(
      "INSERT OR IGNORE INTO precios_caja (clave, nombre, tipo, precio, unidad, orden) VALUES (?,?,?,0,?,?)",
      [`gas:${clave}`, nombre, "gas", unidadGas, orden],
    );
    await run(
      "INSERT OR IGNORE INTO precios_caja (clave, nombre, tipo, precio, unidad, orden) VALUES (?,?,?,0,?,?)",
      [`reg:${clave}`, `Regulador ${nombre}`, "regulador", "u", orden],
    );
  }
  await run("UPDATE precios_caja SET unidad='kg' WHERE clave='gas:co2' AND unidad IN ('m','m³')");
  await run("UPDATE precios_caja SET unidad='m3' WHERE tipo='gas' AND clave!='gas:co2' AND unidad IN ('m','m³')");
  cajaReady = true;
}

function parseMonto(valor: unknown): number {
  let s = String(valor ?? "").trim().replace(/\s/g, "").replace(/\$/g, "");
  if (!s) throw new Error("vacío");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Math.round(Number(s) * 100) / 100;
  if (!Number.isFinite(n) || n < 0) throw new Error("inválido");
  return n;
}

function normalizarMedio(valor: unknown, tipo: string): string {
  if (tipo === "salida") return "";
  const m = String(valor || "efectivo").trim().toLowerCase();
  if (["transferencia", "transfer", "transf"].includes(m)) return "transferencia";
  if (["tarjeta", "debito", "crédito", "credito", "card"].includes(m)) return "tarjeta";
  return "efectivo";
}

async function preciosLista() {
  const rows = await all("SELECT * FROM precios_caja ORDER BY orden, tipo, clave");
  return rows.map((item) => ({
    ...item,
    gas: String(item.clave).split(":")[1] || "",
  }));
}

async function resumenCaja(desde: string, hasta: string) {
  const grupos = await all(
    `SELECT tipo, estado_factura, IFNULL(medio_pago,'efectivo') AS medio,
            COALESCE(SUM(total),0) AS s, COUNT(*) AS n
     FROM ventas_caja
     WHERE fecha>=? AND fecha<=?
     GROUP BY tipo, estado_factura, IFNULL(medio_pago,'efectivo')`,
    [desde, hasta],
  );
  let ventas = 0;
  let salidas = 0;
  let para = 0;
  let facturado = 0;
  let nPara = 0;
  const porMedio = { efectivo: 0, transferencia: 0, tarjeta: 0 };
  for (const r of grupos) {
    const s = Number(r.s || 0);
    if (String(r.tipo) === "salida") salidas += s;
    else {
      ventas += s;
      const medio = String(r.medio || "efectivo");
      if (medio in porMedio) porMedio[medio as keyof typeof porMedio] += s;
      if (String(r.estado_factura) === "pendiente") {
        para += s;
        nPara += Number(r.n || 0);
      } else if (String(r.estado_factura) === "facturado") facturado += s;
    }
  }
  const pend = await one(
    "SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS s FROM ventas_caja WHERE estado_factura='pendiente'",
  );
  return {
    ventas: Math.round(ventas * 100) / 100,
    salidas: Math.round(salidas * 100) / 100,
    en_caja: Math.round((ventas - salidas) * 100) / 100,
    efectivo: Math.round(porMedio.efectivo * 100) / 100,
    transferencia: Math.round(porMedio.transferencia * 100) / 100,
    tarjeta: Math.round(porMedio.tarjeta * 100) / 100,
    para_facturar: Math.round(para * 100) / 100,
    n_para_facturar: nPara,
    facturado: Math.round(facturado * 100) / 100,
    pendientes_total: Number(pend?.n || 0),
    pendientes_importe: Math.round(Number(pend?.s || 0) * 100) / 100,
  };
}

async function filaVenta(vid: number) {
  return one(
    `SELECT v.*, u.nombre AS usuario_nombre
     FROM ventas_caja v LEFT JOIN usuarios u ON u.id=v.usuario_id
     WHERE v.id=?`,
    [vid],
  );
}

async function crearClienteCaja(data: Record<string, unknown>) {
  const nombre = String(data.nombre || "").trim().toUpperCase();
  const cuit = String(data.cuit || "").trim();
  const direccion = String(data.direccion || "").trim();
  if (!nombre) return { error: "El nombre o razón social es obligatorio." };
  if (!cuit) return { error: "El CUIT es obligatorio para un cliente nuevo." };
  if (!direccion) return { error: "La dirección es obligatoria para un cliente nuevo." };
  try {
    const r = await run(
      "INSERT INTO clientes (nombre, direccion, telefono, cuit, activo, creado_en) VALUES (?,?,?,?,1,?)",
      [nombre, direccion, "", cuit, ahora()],
    );
    const row = await one("SELECT * FROM clientes WHERE id=?", [Number(r.lastInsertRowid)]);
    return { cliente: row };
  } catch {
    return { error: "Ya existe un cliente con ese nombre." };
  }
}

/** Maneja rutas /api/caja/*. Devuelve null si no corresponde. */
export async function handleCaja(
  ctx: APIContext,
  u: Usuario,
  method: string,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith("/api/caja/")) return null;
  await ensureCaja();
  const q = ctx.url.searchParams;
  const key = `${method} ${path}`;

  if (key === "GET /api/caja/ventas") {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    let desde: string;
    let hasta: string;
    if (String(u.rol) === "cobrador") {
      desde = hasta = hoy();
    } else {
      desde = parseFecha(q.get("desde") || q.get("fecha") || hoy());
      hasta = parseFecha(q.get("hasta") || q.get("fecha") || desde);
      if (hasta < desde) [desde, hasta] = [hasta, desde];
    }
    const estado = String(q.get("estado") || "").trim();
    let sql = `SELECT v.*, u.nombre AS usuario_nombre
      FROM ventas_caja v LEFT JOIN usuarios u ON u.id=v.usuario_id
      WHERE v.fecha>=? AND v.fecha<=?`;
    const args: (string | number)[] = [desde, hasta];
    if (estado === "pendiente") sql += " AND v.estado_factura='pendiente'";
    else if (estado === "facturado") sql += " AND v.estado_factura='facturado'";
    else if (estado === "contado") sql += " AND v.tipo!='salida' AND v.estado_factura='no'";
    else if (estado === "salida") sql += " AND v.tipo='salida'";
    sql += " ORDER BY v.fecha DESC, v.id DESC LIMIT 400";
    const ventas = await all(sql, args);
    const recientes = await all(
      `SELECT c.id, c.nombre, c.cuit, c.direccion
       FROM ventas_caja v JOIN clientes c ON c.id=v.cliente_id
       GROUP BY c.id ORDER BY MAX(v.id) DESC LIMIT 8`,
    );
    return json({
      ok: true,
      desde,
      hasta,
      ventas,
      precios: await preciosLista(),
      resumen: await resumenCaja(desde, hasta),
      recientes,
    });
  }

  if (key === "GET /api/caja/ventas.csv") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    let desde = parseFecha(q.get("desde") || q.get("fecha") || hoy());
    let hasta = parseFecha(q.get("hasta") || q.get("fecha") || desde);
    if (hasta < desde) [desde, hasta] = [hasta, desde];
    const rows = await all(
      `SELECT v.fecha, v.hora, v.tipo, v.descripcion, v.cantidad, v.precio_unitario, v.total,
              IFNULL(v.medio_pago,'') AS medio_pago, v.estado_factura,
              IFNULL(v.cliente_nombre,'') AS cliente_nombre, IFNULL(v.cliente_cuit,'') AS cliente_cuit,
              IFNULL(u.nombre,'') AS usuario_nombre
       FROM ventas_caja v LEFT JOIN usuarios u ON u.id=v.usuario_id
       WHERE v.fecha>=? AND v.fecha<=? ORDER BY v.fecha, v.id`,
      [desde, hasta],
    );
    const escCsv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["fecha", "hora", "tipo", "descripcion", "cantidad", "precio_unitario", "total", "medio_pago", "estado_factura", "cliente", "cuit", "usuario"].join(";"),
      ...rows.map((r) =>
        [r.fecha, r.hora, r.tipo, r.descripcion, r.cantidad, r.precio_unitario, r.total, r.medio_pago, r.estado_factura, r.cliente_nombre, r.cliente_cuit, r.usuario_nombre]
          .map(escCsv)
          .join(";"),
      ),
    ];
    const body = "\ufeff" + lines.join("\n");
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=caja-${desde}_${hasta}.csv`,
      },
    });
  }

  if (key === "PUT /api/caja/precios") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const items = data.precios ?? data;
    let pares: [string, unknown][] = [];
    if (items && typeof items === "object" && !Array.isArray(items)) {
      pares = Object.entries(items as Record<string, unknown>);
    } else if (Array.isArray(items)) {
      pares = items
        .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
        .map((it) => [String(it.clave || ""), it.precio]);
    }
    const unidades = (data.unidades || {}) as Record<string, unknown>;
    if (unidades && typeof unidades === "object") {
      for (const [clave, unidad] of Object.entries(unidades)) {
        if (!clave.startsWith("gas:")) continue;
        const exists = await one("SELECT 1 AS n FROM precios_caja WHERE clave=?", [clave]);
        if (!exists) continue;
        let uu = String(unidad || "").trim().toLowerCase();
        if (["kg", "kilo", "kilos"].includes(uu)) uu = "kg";
        else if (["m", "m3", "m³", "metro", "metros"].includes(uu)) uu = "m3";
        else return err(`Unidad inválida para ${clave}. Usá kg o m3.`);
        await run("UPDATE precios_caja SET unidad=? WHERE clave=?", [uu, clave]);
      }
    }
    for (const [claveRaw, precio] of pares) {
      const clave = String(claveRaw || "");
      if (clave.startsWith("unidad:")) continue;
      const exists = await one("SELECT 1 AS n FROM precios_caja WHERE clave=?", [clave]);
      if (!exists) continue;
      try {
        const n = parseMonto(precio);
        await run("UPDATE precios_caja SET precio=? WHERE clave=?", [n, clave]);
      } catch {
        return err(`Precio inválido para ${clave}.`);
      }
    }
    return json({ ok: true, precios: await preciosLista() });
  }

  if (key === "POST /api/caja/ventas") {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    const data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const tipo = String(data.tipo || "").trim();
    if (!["gas", "regulador", "general", "salida"].includes(tipo)) return err("Elegí qué estás registrando.");
    let gas = String(data.gas || "").trim().toLowerCase();
    let descripcion = String(data.descripcion || "").trim();
    let cliente_id: number | null = null;
    let cliente_nombre = "";
    let cliente_cuit = "";
    let facturar = Boolean(data.facturar) && tipo !== "salida";
    let cantidad: number;
    let precio: number;
    let total: number;
    try {
      cantidad = Number(data.cantidad || 0);
    } catch {
      return err("La cantidad no es válida.");
    }

    if (tipo === "gas" || tipo === "regulador") {
      const pref = tipo === "gas" ? "gas" : "reg";
      const rowP = await one("SELECT * FROM precios_caja WHERE clave=?", [`${pref}:${gas}`]);
      if (!rowP) return err("Elegí el gas.");
      if (Number(rowP.precio || 0) <= 0) {
        return err(`Falta el precio de ${rowP.nombre}. Pedile al administrador que lo cargue.`);
      }
      if (!(cantidad > 0)) return err("Indicá la cantidad.");
      precio = Number(rowP.precio);
      cantidad = Math.round(cantidad * 100) / 100;
      if (tipo === "gas") {
        const unidad = String(rowP.unidad || "m3").toLowerCase();
        const suf = ["kg", "kilo", "kilos"].includes(unidad) ? "kg" : "m³";
        descripcion = `${rowP.nombre} ${cantidad} ${suf}`;
      } else {
        descripcion = `${rowP.nombre} x ${cantidad}`;
      }
      total = Math.round(cantidad * precio * 100) / 100;
      if (data.total !== undefined && data.total !== null && data.total !== "") {
        try {
          total = parseMonto(data.total);
        } catch {
          return err("El total no es válido.");
        }
        if (total <= 0) return err("El total debe ser mayor a cero.");
        precio = cantidad ? Math.round((total / cantidad) * 100) / 100 : precio;
      }
    } else if (tipo === "general") {
      if (descripcion.length < 2) return err("Escribí qué se vendió.");
      try {
        total = parseMonto(data.total !== undefined && data.total !== null && data.total !== "" ? data.total : data.precio);
      } catch {
        return err("Indicá el precio.");
      }
      if (total <= 0) return err("Indicá el precio.");
      cantidad = 1;
      precio = total;
      gas = "";
    } else {
      if (descripcion.length < 2) return err("Elegí o escribí el motivo de la salida.");
      try {
        total = parseMonto(data.total !== undefined && data.total !== null && data.total !== "" ? data.total : data.precio);
      } catch {
        return err("Indicá el importe que sale.");
      }
      if (total <= 0) return err("Indicá el importe que sale.");
      cantidad = 1;
      precio = total;
      gas = "";
      facturar = false;
    }

    let estado = "no";
    if (facturar) {
      const nuevo = data.cliente_nuevo && typeof data.cliente_nuevo === "object"
        ? (data.cliente_nuevo as Record<string, unknown>)
        : null;
      let cli: Record<string, unknown> | null = null;
      if (nuevo) {
        const created = await crearClienteCaja(nuevo);
        if (created.error) return err(created.error);
        cli = created.cliente;
      } else {
        const cid = Number(data.cliente_id);
        if (!Number.isFinite(cid)) return err("Elegí el cliente o cargá uno nuevo.");
        cli = await one("SELECT * FROM clientes WHERE id=? AND activo=1", [cid]);
        if (!cli) return err("Elegí el cliente o cargá uno nuevo.");
      }
      cliente_id = Number(cli!.id);
      cliente_nombre = String(cli!.nombre || "");
      cliente_cuit = String(cli!.cuit || "");
      estado = "pendiente";
    }

    const medio_pago = normalizarMedio(data.medio_pago, tipo);
    const t = ahora();
    const hora = t.slice(11, 16);
    const ins = await run(
      `INSERT INTO ventas_caja (
        fecha, hora, tipo, gas, descripcion, cantidad, precio_unitario, total,
        medio_pago, facturar, estado_factura, cliente_id, cliente_nombre, cliente_cuit,
        usuario_id, creado_en, actualizado_en
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        hoy(),
        hora,
        tipo,
        gas,
        descripcion,
        cantidad,
        precio,
        total,
        medio_pago,
        facturar ? 1 : 0,
        estado,
        cliente_id,
        cliente_nombre,
        cliente_cuit,
        u.id,
        t,
        t,
      ],
    );
    return json({ ok: true, venta: await filaVenta(Number(ins.lastInsertRowid)) });
  }

  const putVenta = path.match(/^\/api\/caja\/ventas\/(\d+)$/);
  if (method === "PUT" && putVenta) {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    const vid = Number(putVenta[1]);
    const data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const row = await one("SELECT * FROM ventas_caja WHERE id=?", [vid]);
    if (!row) return err("Venta no encontrada.", 404);
    if (String(u.rol) === "cobrador") {
      if (String(row.fecha || "") !== hoy()) return err("Solo podés modificar ventas de hoy.");
      if (String(row.estado_factura || "") === "facturado") {
        return err("Esa venta ya está facturada; pedile al administrador.");
      }
    }
    const descripcion = String(data.descripcion ?? row.descripcion).trim();
    if (descripcion.length < 2) return err("La descripción es obligatoria.");
    let cantidad: number;
    let precio: number;
    try {
      cantidad = data.cantidad !== undefined && data.cantidad !== null && data.cantidad !== ""
        ? Number(data.cantidad)
        : Number(row.cantidad || 1);
      precio = data.precio_unitario !== undefined && data.precio_unitario !== null && data.precio_unitario !== ""
        ? parseMonto(data.precio_unitario)
        : Number(row.precio_unitario || 0);
    } catch {
      return err("Cantidad o precio inválido.");
    }
    if (cantidad < 0 || precio < 0) return err("Cantidad o precio inválido.");
    let total: number;
    if (data.total !== undefined && data.total !== null && data.total !== "") {
      try {
        total = parseMonto(data.total);
      } catch {
        return err("Total inválido.");
      }
      if (cantidad) precio = Math.round((total / cantidad) * 100) / 100;
    } else {
      total = Math.round(cantidad * precio * 100) / 100;
    }
    let facturar = "facturar" in data ? Boolean(data.facturar) : Boolean(row.facturar);
    if (String(row.tipo) === "salida") facturar = false;
    let estado = String(data.estado_factura ?? row.estado_factura ?? "no");
    if (!["no", "pendiente", "facturado"].includes(estado)) return err("Estado de factura inválido.");
    if (String(u.rol) === "cobrador" && estado === "facturado") {
      return err("No podés marcar como facturada desde Cobrar.");
    }
    if (!facturar) estado = "no";
    else if (estado === "no") estado = "pendiente";
    let cliente_id = row.cliente_id != null ? Number(row.cliente_id) : null;
    let cliente_nombre = String(row.cliente_nombre || "");
    let cliente_cuit = String(row.cliente_cuit || "");
    if (facturar && data.cliente_id) {
      const cid = Number(data.cliente_id);
      const cli = await one("SELECT * FROM clientes WHERE id=?", [cid]);
      if (!cli) return err("Cliente no encontrado.");
      cliente_id = Number(cli.id);
      cliente_nombre = String(cli.nombre);
      cliente_cuit = String(cli.cuit || "");
    }
    if (facturar && !cliente_id && data.cliente_nuevo && typeof data.cliente_nuevo === "object") {
      const created = await crearClienteCaja(data.cliente_nuevo as Record<string, unknown>);
      if (created.error) return err(created.error);
      cliente_id = Number(created.cliente!.id);
      cliente_nombre = String(created.cliente!.nombre);
      cliente_cuit = String(created.cliente!.cuit || "");
    }
    if (facturar && !cliente_id) return err("Una venta para facturar necesita cliente.");
    if (!facturar) estado = "no";
    let medio_pago = String(row.medio_pago || "efectivo");
    if ("medio_pago" in data && String(row.tipo) !== "salida") {
      medio_pago = normalizarMedio(data.medio_pago, String(row.tipo));
    }
    await run(
      `UPDATE ventas_caja
       SET descripcion=?, cantidad=?, precio_unitario=?, total=?, medio_pago=?, facturar=?,
           estado_factura=?, cliente_id=?, cliente_nombre=?, cliente_cuit=?, actualizado_en=?
       WHERE id=?`,
      [
        descripcion,
        Math.round(cantidad * 100) / 100,
        Math.round(precio * 100) / 100,
        total,
        medio_pago || "",
        facturar ? 1 : 0,
        estado,
        cliente_id,
        cliente_nombre,
        cliente_cuit,
        ahora(),
        vid,
      ],
    );
    return json({ ok: true, venta: await filaVenta(vid) });
  }

  if (method === "DELETE" && putVenta) {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    const vid = Number(putVenta[1]);
    const row = await one("SELECT * FROM ventas_caja WHERE id=?", [vid]);
    if (!row) return err("Venta no encontrada.", 404);
    if (String(u.rol) === "cobrador") {
      if (String(row.fecha || "") !== hoy()) return err("Solo podés borrar ventas de hoy.");
      if (String(row.estado_factura || "") === "facturado") {
        return err("No podés borrar una venta ya facturada.");
      }
    }
    await run("DELETE FROM ventas_caja WHERE id=?", [vid]);
    return json({ ok: true, id: vid });
  }

  return err("Ruta no encontrada.", 404);
}
