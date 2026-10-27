import type { APIContext } from "astro";
import { all, one, run } from "./db";
import { puede, type Usuario } from "./auth";

const GASES: [string, string, number][] = [
  ["oxigeno", "Oxígeno", 1],
  ["oxigeno_medicinal", "Oxígeno medicinal", 2],
  ["co2", "CO2", 3],
  ["nitrogeno", "Nitrógeno", 4],
  ["argon", "Argón", 5],
  ["athal", "Athal", 6],
  ["helio", "Helio", 7],
  ["acetileno", "Acetileno", 8],
];

function slugGas(nombre: string): string {
  return String(nombre || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
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
  try {
    await run("ALTER TABLE ventas_caja ADD COLUMN cheque_id INTEGER");
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
  for (const col of ["afip_cae", "afip_numero"] as const) {
    try {
      await run(`ALTER TABLE ventas_caja ADD COLUMN ${col} TEXT`);
    } catch {
      /* ya existe */
    }
  }
  await run(`CREATE TABLE IF NOT EXISTS ventas_caja_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    gas TEXT,
    descripcion TEXT NOT NULL,
    cantidad REAL NOT NULL DEFAULT 1,
    precio_unitario REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    precio_clave TEXT
  )`);
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
  const m = String(valor || "efectivo").trim().toLowerCase();
  let medio = "efectivo";
  if (["transferencia", "transfer", "transf"].includes(m)) medio = "transferencia";
  else if (["tarjeta", "debito", "crédito", "credito", "card"].includes(m)) medio = "tarjeta";
  else if (["cheque", "check"].includes(m)) medio = "cheque";
  else if (["echeq", "e-check", "e_check", "echeck"].includes(m)) medio = "echeq";
  if (tipo === "salida" && medio === "tarjeta") return "efectivo";
  return medio;
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
    let facturaTipo = String(data.factura_tipo || "").trim().toLowerCase();
    if (!["ri", "exento", "a", "b", "c", "x"].includes(facturaTipo)) facturaTipo = "";
    const r = await run(
      "INSERT INTO clientes (nombre, direccion, telefono, cuit, factura_tipo, activo, creado_en) VALUES (?,?,?,?,?,1,?)",
      [nombre, direccion, "", cuit, facturaTipo || null, ahora()],
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

  if (key === "GET /api/caja/cheques") {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    const estado = String(q.get("estado") || "").trim();
    let sql = `SELECT ch.*, cl.nombre AS cliente_nombre
      FROM cheques ch LEFT JOIN clientes cl ON cl.id=ch.cliente_id WHERE 1=1`;
    const args: (string | number)[] = [];
    if (estado) {
      sql += " AND ch.estado=?";
      args.push(estado);
    }
    sql += " ORDER BY ch.id DESC LIMIT 300";
    return json({ cheques: await all(sql, args) });
  }

  if (key === "GET /api/caja/ventas") {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    let desde = parseFecha(q.get("desde") || q.get("fecha") || hoy());
    let hasta = parseFecha(q.get("hasta") || q.get("fecha") || desde);
    if (hasta < desde) [desde, hasta] = [hasta, desde];
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
      `SELECT c.id, c.nombre, c.cuit, c.direccion, c.codigo, c.factura_tipo
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

  if (key === "POST /api/caja/precios/gas") {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = String(data.nombre || "").trim();
    if (nombre.length < 2) return err("Escribí el nombre del gas.");
    const clave = slugGas(String(data.clave || nombre));
    if (!clave) return err("El nombre no da una clave válida.");
    let unidad = String(data.unidad || "m3").trim().toLowerCase();
    if (["kg", "kilo", "kilos"].includes(unidad)) unidad = "kg";
    else if (["m", "m3", "m³", "metro", "metros"].includes(unidad)) unidad = "m3";
    else return err("Unidad inválida. Usá kg o m3.");
    let precio = 0;
    let precioReg = 0;
    try {
      precio = data.precio != null && data.precio !== "" ? parseMonto(data.precio) : 0;
      precioReg =
        data.precio_regulador != null && data.precio_regulador !== ""
          ? parseMonto(data.precio_regulador)
          : 0;
    } catch {
      return err("Precio inválido.");
    }
    const existe = await one("SELECT 1 AS n FROM precios_caja WHERE clave=?", [`gas:${clave}`]);
    if (existe) return err(`Ya existe el gas «${clave}».`);
    const maxOrd = await one("SELECT COALESCE(MAX(orden),0) AS m FROM precios_caja WHERE tipo='gas'");
    const orden = Number(maxOrd?.m || 0) + 1;
    await run(
      "INSERT INTO precios_caja (clave, nombre, tipo, precio, unidad, orden) VALUES (?,?,?,?,?,?)",
      [`gas:${clave}`, nombre, "gas", precio, unidad, orden],
    );
    await run(
      "INSERT INTO precios_caja (clave, nombre, tipo, precio, unidad, orden) VALUES (?,?,?,?,?,?)",
      [`reg:${clave}`, `Regulador ${nombre}`, "regulador", precioReg, "u", orden],
    );
    return json({ ok: true, clave, precios: await preciosLista() });
  }

  const delGas = path.match(/^\/api\/caja\/precios\/gas\/([^/]+)$/);
  if (method === "DELETE" && delGas) {
    if (!puede(u, "admin")) return err("No tiene permiso para esta acción.", 403);
    const gas = slugGas(decodeURIComponent(delGas[1]));
    if (!gas) return err("Gas inválido.");
    const row = await one("SELECT 1 AS n FROM precios_caja WHERE clave=?", [`gas:${gas}`]);
    if (!row) return err("Ese gas no está en la lista.", 404);
    await run("DELETE FROM precios_caja WHERE clave IN (?,?)", [`gas:${gas}`, `reg:${gas}`]);
    return json({ ok: true, precios: await preciosLista() });
  }

  if (key === "POST /api/caja/ventas") {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    const data = (await ctx.request.json().catch(() => ({}))) as Record<string, unknown>;
    let tipo = String(data.tipo || "").trim();
    const itemsIn = Array.isArray(data.items) ? data.items : null;
    if (tipo === "salida") {
      /* sin ítems */
    } else if (!itemsIn && !["gas", "regulador", "general", "salida"].includes(tipo)) {
      return err("Elegí qué estás registrando.");
    }
    let gas = String(data.gas || "").trim().toLowerCase();
    let descripcion = String(data.descripcion || "").trim();
    let cliente_id: number | null = null;
    let cliente_nombre = "";
    let cliente_cuit = "";
    let facturar = Boolean(data.facturar) && tipo !== "salida";
    let cantidad = 0;
    let precio = 0;
    let total = 0;
    type Linea = {
      tipo: string;
      gas: string;
      descripcion: string;
      cantidad: number;
      precio: number;
      total: number;
      precio_clave: string;
    };
    const lineas: Linea[] = [];

    async function armarLinea(raw: Record<string, unknown>): Promise<Linea | string> {
      const tipoIt = String(raw.tipo || "gas").trim();
      if (!["gas", "regulador", "general"].includes(tipoIt)) return "Tipo de ítem inválido.";
      if (tipoIt === "gas" || tipoIt === "regulador") {
        const g = String(raw.gas || "").trim().toLowerCase();
        const pref = tipoIt === "gas" ? "gas" : "reg";
        const rowP = await one("SELECT * FROM precios_caja WHERE clave=?", [`${pref}:${g}`]);
        if (!rowP) return "Elegí el gas de cada ítem.";
        if (Number(rowP.precio || 0) <= 0) return `Falta el precio de ${rowP.nombre}.`;
        let cant = Math.round(Number(raw.cantidad || 0) * 100) / 100;
        if (!(cant > 0)) return "Indicá la cantidad de cada ítem.";
        let pu = Number(rowP.precio);
        let tot = Math.round(cant * pu * 100) / 100;
        if (raw.total != null && raw.total !== "") {
          try {
            tot = parseMonto(raw.total);
          } catch {
            return "El total de un ítem no es válido.";
          }
          if (tot <= 0) return "El total de cada ítem debe ser mayor a cero.";
          pu = cant ? Math.round((tot / cant) * 100) / 100 : pu;
        }
        const unidad = String(rowP.unidad || "m3").toLowerCase();
        const suf = ["kg", "kilo", "kilos"].includes(unidad) ? "kg" : "m³";
        const desc =
          tipoIt === "gas"
            ? `${rowP.nombre} ${cant} ${suf}`
            : `${rowP.nombre} x ${cant}`;
        return {
          tipo: tipoIt,
          gas: g,
          descripcion: desc,
          cantidad: cant,
          precio: pu,
          total: tot,
          precio_clave: String(rowP.clave),
        };
      }
      const desc = String(raw.descripcion || "").trim();
      if (desc.length < 2) return "Escribí qué se vendió en cada ítem.";
      let cant = Math.round(Number(raw.cantidad || 1) * 100) / 100;
      if (!(cant > 0)) cant = 1;
      let tot: number;
      try {
        tot = parseMonto(raw.total != null && raw.total !== "" ? raw.total : raw.precio);
      } catch {
        return "Indicá el precio de cada ítem.";
      }
      if (tot <= 0) return "Indicá el precio de cada ítem.";
      return {
        tipo: "general",
        gas: "",
        descripcion: desc,
        cantidad: cant,
        precio: Math.round((tot / cant) * 100) / 100,
        total: Math.round(tot * 100) / 100,
        precio_clave: "",
      };
    }

    if (itemsIn) {
      for (const raw of itemsIn) {
        if (!raw || typeof raw !== "object") return err("Hay un ítem que no se puede leer.");
        const linea = await armarLinea(raw as Record<string, unknown>);
        if (typeof linea === "string") return err(linea);
        lineas.push(linea);
      }
      if (!lineas.length) return err("Sumá al menos un ítem antes de grabar.");
      if (lineas.length === 1) {
        tipo = lineas[0].tipo;
        gas = lineas[0].gas;
        descripcion = lineas[0].descripcion;
        cantidad = lineas[0].cantidad;
        precio = lineas[0].precio;
        total = lineas[0].total;
      } else {
        tipo = "mixto";
        gas = "";
        descripcion = lineas.map((x) => x.descripcion).join(" + ");
        if (descripcion.length > 240) descripcion = descripcion.slice(0, 237) + "…";
        cantidad = lineas.length;
        total = Math.round(lineas.reduce((s, x) => s + x.total, 0) * 100) / 100;
        precio = total;
      }
      if (lineas.length > 1 && data.total != null && data.total !== "") {
        try {
          const totalManual = parseMonto(data.total);
          if (totalManual <= 0) return err("El total debe ser mayor a cero.");
          const last = lineas[lineas.length - 1];
          last.total = Math.round((last.total + (totalManual - total)) * 100) / 100;
          if (last.cantidad) last.precio = Math.round((last.total / last.cantidad) * 100) / 100;
          total = totalManual;
          precio = total;
        } catch {
          return err("El total no es válido.");
        }
      }
    } else if (tipo === "gas" || tipo === "regulador") {
      const pref = tipo === "gas" ? "gas" : "reg";
      const rowP = await one("SELECT * FROM precios_caja WHERE clave=?", [`${pref}:${gas}`]);
      if (!rowP) return err("Elegí el gas.");
      if (Number(rowP.precio || 0) <= 0) {
        return err(`Falta el precio de ${rowP.nombre}. Pedile al administrador que lo cargue.`);
      }
      cantidad = Math.round(Number(data.cantidad || 0) * 100) / 100;
      if (!(cantidad > 0)) return err("Indicá la cantidad.");
      precio = Number(rowP.precio);
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

    let medio_pago = normalizarMedio(data.medio_pago, tipo);
    let chequeId: number | null = null;
    if (tipo === "salida" && (medio_pago === "cheque" || medio_pago === "echeq")) {
      chequeId = Number(data.cheque_id);
      if (!chequeId) return err("Elegí el cheque de la cartera.");
      const cheque = await one("SELECT * FROM cheques WHERE id=?", [chequeId]);
      if (!cheque || String(cheque.estado) !== "en_cartera") return err("Ese cheque no está en cartera.");
      total = Math.round(Number(cheque.monto || 0) * 100) / 100;
      if (total <= 0) return err("El cheque no tiene importe.");
      precio = total;
      medio_pago = String(cheque.tipo) === "echeq" ? "echeq" : "cheque";
    }
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
    const vid = Number(ins.lastInsertRowid);
    const aGuardar = lineas.length
      ? lineas
      : tipo !== "salida"
        ? [{
            tipo,
            gas,
            descripcion,
            cantidad,
            precio,
            total,
            precio_clave: gas ? `${tipo === "regulador" ? "reg" : "gas"}:${gas}` : "",
          }]
        : [];
    for (const it of aGuardar) {
      await run(
        `INSERT INTO ventas_caja_items (
          venta_id, tipo, gas, descripcion, cantidad, precio_unitario, total, precio_clave
        ) VALUES (?,?,?,?,?,?,?,?)`,
        [vid, it.tipo, it.gas || "", it.descripcion, it.cantidad, it.precio, it.total, it.precio_clave || ""],
      );
    }
    if (chequeId) {
      await run(
        `INSERT INTO cheque_endosos (cheque_id, fecha, endosatario, observaciones, usuario_id, creado_en)
         VALUES (?,?,?,?,?,?)`,
        [chequeId, hoy(), descripcion || "Salida de caja", `Salida de caja #${vid}`, u.id, t],
      );
      await run("UPDATE cheques SET estado='endosado', actualizado_en=? WHERE id=?", [t, chequeId]);
      try { await run("UPDATE ventas_caja SET cheque_id=? WHERE id=?", [chequeId, vid]); } catch { /* ok */ }
    }
    return json({ ok: true, venta: await filaVenta(vid) });
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
    if ("medio_pago" in data) {
      const nuevo = normalizarMedio(data.medio_pago, String(row.tipo));
      const actual = String(row.medio_pago || "efectivo");
      if (String(row.tipo) === "salida") {
        if (actual === "cheque" || actual === "echeq") medio_pago = actual;
        else if (nuevo === "cheque" || nuevo === "echeq") return err("El cheque se elige al grabar la salida.");
        else medio_pago = nuevo;
      } else medio_pago = nuevo;
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

  const printVenta = path.match(/^\/api\/caja\/ventas\/(\d+)\/imprimir$/);
  if (method === "GET" && printVenta) {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    const vid = Number(printVenta[1]);
    const venta = await filaVenta(vid);
    if (!venta) return err("Movimiento no encontrado.", 404);
    let items = await all(
      "SELECT * FROM ventas_caja_items WHERE venta_id=? ORDER BY id",
      [vid],
    );
    if (!items.length) {
      const cant = Number(venta.cantidad || 1) || 1;
      let pu = Number(venta.precio_unitario || 0);
      const total = Number(venta.total || 0);
      if (pu <= 0 && cant) pu = Math.round((total / cant) * 100) / 100;
      items = [
        {
          descripcion: venta.descripcion || "Ítem",
          cantidad: cant,
          precio_unitario: pu,
          subtotal: total,
          total,
        },
      ];
    } else {
      items = items.map((it) => ({
        ...it,
        subtotal: it.subtotal != null ? it.subtotal : it.total,
      }));
    }
    const cfgRows = await all("SELECT clave, valor FROM config");
    const empresa: Record<string, string> = {};
    for (const r of cfgRows) empresa[String(r.clave)] = String(r.valor ?? "");
    const doc = String(venta.tipo || "") === "salida" ? "orden_pago" : "factura";
    return json({
      ok: true,
      venta,
      items,
      empresa,
      comprobante: null,
      doc,
    });
  }

  if (key === "GET /api/caja/alertas") {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    return json({ ok: true, alertas: [] });
  }

  if (key === "GET /api/caja/deudas") {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    return json({
      ok: true,
      deudas: [],
      vencidos: [],
      proximos: [],
      total: 0,
      n_clientes: 0,
      n_vencidos: 0,
      n_proximos: 0,
    });
  }

  if (key === "GET /api/caja/comprobantes") {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    return json({ ok: true, comprobantes: [] });
  }

  if (key === "GET /api/caja/condiciones") {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    return json({
      ok: true,
      condiciones: [
        { id: 1, nombre: "Contado", genera_deuda: 0, plazo_dias: 0, recargo_pct: 0, descuento_pct: 0, activo: 1 },
        { id: 2, nombre: "Cuenta corriente 30 días", genera_deuda: 1, plazo_dias: 30, recargo_pct: 0, descuento_pct: 0, activo: 1 },
      ],
    });
  }

  const ccMatch = path.match(/^\/api\/caja\/cuenta-corriente\/(\d+)$/);
  if (method === "GET" && ccMatch) {
    if (!puede(u, "admin", "cobrador")) return err("No tiene permiso para esta acción.", 403);
    const cid = Number(ccMatch[1]);
    const cli = await one("SELECT * FROM clientes WHERE id=?", [cid]);
    if (!cli) return err("Cliente no encontrado.", 404);
    return json({
      ok: true,
      cliente: cli,
      saldo: 0,
      abiertos: [],
      comprobantes: [],
      cobros: [],
    });
  }

  return err("Ruta no encontrada.", 404);
}
