const ESTADOS = {
  vacio: "Vacío",
  en_planta: "En planta",
  cargado: "Cargado",
  en_cliente: "En cliente",
};

const TIPOS = {
  ALTA: "Alta",
  TRANSALI: "SalidaCL",
  TRANSENT: "EntradaCL",
  PLANSALI: "Salida",
  PLANENTR: "Entrada",
  CARGA: "Carga en empresa",
  BAJA: "Baja",
  EDICION: "Edición",
};

const INFORME_MOV = {
  PLANSALI: "Salida",
  PLANENTR: "Entrada",
  TRANSALI: "SalidaCL",
  TRANSENT: "EntradaCL",
};

const state = {
  config: { empresa: "Gasonor SRL" },
  articulos: [],
  clientes: [],
  usuario: null,
  scanLista: [],
  scanModo: null,
  scanProveedor: null,
  scanCliente: null,
  catalogoSelTodo: false,
  catalogoBulkOpen: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const app = () => $("#app");

function fmtFecha(v, corto = true) {
  if (!v) return "";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return v;
  return corto ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : `${m[3]}/${m[2]}/${m[1]}`;
}

function hoyInput() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function primerDiaMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(msg, error = false) {
  const el = $("#toast");
  el.hidden = false;
  el.className = error ? "error" : "";
  el.id = "toast";
  el.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Respuesta inválida" }));
  if (res.status === 401) {
    state.usuario = null;
    mostrarLogin(true);
    throw new Error(data.error || "Debe iniciar sesión");
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || "Error de servidor");
  return data;
}

function rolActual() {
  const r = state.usuario?.rol || "";
  if (r === "despacho_total" || r === "despacho_general") return "despacho";
  return r;
}

function puede(...roles) {
  if (!state.usuario) return false;
  const r = rolActual();
  if (r === "admin") return true;
  return roles.some((need) => {
    if (need === "despacho") return r === "despacho";
    return r === need;
  });
}

function etiquetaRol(rol) {
  return ({
    admin: "Administrador",
    despacho: "Despacho",
    despacho_total: "Despacho",
    despacho_general: "Despacho",
    reparto: "Reparto",
    cobrador: "Cobrador",
  })[rol] || rol;
}

function aplicarPermisos() {
  const rol = rolActual();
  document.body.classList.toggle("modo-cobrador", rol === "cobrador");
  document.body.classList.toggle("modo-despacho", rol === "despacho");
  document.body.classList.toggle("modo-reparto", rol === "reparto");
  const busq = $("#busqueda-global");
  if (busq) busq.hidden = rol === "cobrador" || rol === "despacho" || rol === "reparto";
  document.querySelectorAll(".sidebar nav a").forEach((el) => {
    if (!el.dataset.roles) {
      el.style.display = rol === "cobrador" ? "none" : "";
      return;
    }
    const needed = el.dataset.roles.split(",").map((s) => s.trim());
    el.style.display = needed.some((n) => puede(n)) ? "" : "none";
  });
  document.querySelectorAll("[data-nav-group]").forEach((g) => {
    const visibles = [...g.querySelectorAll("a")].some((a) => a.style.display !== "none");
    g.hidden = !visibles;
  });
  const quien = $("#quien");
  if (quien && state.usuario) quien.textContent = `${state.usuario.nombre} (${etiquetaRol(rol)})`;
}

function mostrarLogin(ver) {
  const el = $("#login-screen");
  if (el) el.hidden = !ver;
}

function badge(estado) {
  return `<span class="badge ${esc(estado)}">${esc(ESTADOS[estado] || estado)}</span>`;
}

function setNav(name) {
  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === name);
  });
}

function selectedIds(root = document) {
  return [...new Set([...root.querySelectorAll("input[name='tubo']:checked")].map((i) => Number(i.value)))];
}

async function cargarCatalogos() {
  const rol = rolActual();
  // Roles de celular: no bajar todo el padrón (traba el teléfono).
  if (rol === "reparto" || rol === "despacho") {
    const cfg = await api("/api/config");
    state.config = cfg.config;
    state.articulos = state.articulos || [];
    state.clientes = state.clientes || [];
    $("#brand-name").textContent = state.config.empresa || "Gasonor SRL";
    aplicarPermisos();
    return;
  }
  const [arts, clis, cfg] = await Promise.all([
    api("/api/articulos?tipo=tubo"),
    api("/api/clientes"),
    api("/api/config"),
  ]);
  state.articulos = arts.articulos;
  state.clientes = clis.clientes;
  state.config = cfg.config;
  $("#brand-name").textContent = state.config.empresa || "Gasonor SRL";
  aplicarPermisos();
}

function optsArticulos(selected) {
  return state.articulos
    .filter((a) => a.es_tubo)
    .slice(0, 400)
    .map((a) => `<option value="${a.id}" ${String(a.id) === String(selected) ? "selected" : ""}>${esc(a.codigo)} — ${esc(a.descripcion)}</option>`)
    .join("");
}

function optsClientes(selected) {
  return state.clientes
    .map((c) => `<option value="${c.id}" ${String(c.id) === String(selected) ? "selected" : ""}>${esc(c.nombre)}</option>`)
    .join("");
}

function optsProveedores(provs, selected) {
  return (provs || [])
    .map((p) => `<option value="${p.id}" ${String(p.id) === String(selected) ? "selected" : ""}>${esc(p.nombre)}</option>`)
    .join("");
}

function bindBusquedaClienteSimple(buscaId, idHidden, listaId) {
  const input = $(buscaId);
  const hidden = $(idHidden);
  const ul = $(listaId);
  if (!input || !hidden || !ul) return;
  let timer;
  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { ul.hidden = true; ul.innerHTML = ""; return; }
      try {
        const data = await api("/api/clientes?q=" + encodeURIComponent(q));
        const rows = (data.clientes || []).slice(0, 20);
        ul.innerHTML = rows.length
          ? rows.map((c) => `<li data-id="${c.id}">${esc(c.nombre)}${c.direccion ? ` · <small>${esc(c.direccion)}</small>` : ""}</li>`).join("")
          : `<li class="empty-li">Sin coincidencias</li>`;
        ul.hidden = false;
        ul.querySelectorAll("li[data-id]").forEach((li) => {
          li.onclick = () => {
            hidden.value = li.dataset.id;
            const c = rows.find((x) => String(x.id) === li.dataset.id);
            input.value = c?.nombre || li.textContent || "";
            ul.hidden = true;
          };
        });
      } catch (_) { /* ok */ }
    }, 200);
  };
}

/** Búsqueda en vivo de clientes: nombre + CUIT + dirección (destacada). */
function htmlBusquedaCliente(pref = "bc") {
  return `
    <div class="cliente-busca" data-cli-pref="${pref}">
      <div class="toolbar cliente-busca-bar">
        <div class="field"><label>Nombre</label>
          <input id="${pref}-nombre" placeholder="Escribí el nombre…" autocomplete="off">
        </div>
        <div class="field"><label>CUIT</label>
          <input id="${pref}-cuit" placeholder="20-…" autocomplete="off">
        </div>
        <div class="field field-dir"><label>Dirección</label>
          <input id="${pref}-dir" placeholder="Calle, barrio, localidad…" autocomplete="off">
        </div>
      </div>
      <input type="hidden" name="cliente_id" id="${pref}-id" value="">
      <div id="${pref}-elegido" class="cli-elegido" hidden></div>
      <ul id="${pref}-lista" class="cli-live-list" hidden></ul>
    </div>`;
}

function bindBusquedaCliente(pref = "bc", { required = true, onSelect = null, extraParams = null } = {}) {
  const elNombre = $(`#${pref}-nombre`);
  const elCuit = $(`#${pref}-cuit`);
  const elDir = $(`#${pref}-dir`);
  const elId = $(`#${pref}-id`);
  const elLista = $(`#${pref}-lista`);
  const elElegido = $(`#${pref}-elegido`);
  if (!elNombre || !elLista) return;
  let timer;
  const pintarElegido = (c) => {
    if (!c) {
      elElegido.hidden = true;
      elElegido.innerHTML = "";
      return;
    }
    elElegido.hidden = false;
    elElegido.innerHTML = `<strong>${esc(c.nombre)}</strong>
      <span>${esc(c.cuit || "Sin CUIT")}</span>
      <span class="cli-dir">${esc(c.direccion || "Sin dirección")}</span>
      <button type="button" class="btn ghost" id="${pref}-clear">Cambiar</button>`;
    $(`#${pref}-clear`).onclick = () => {
      elId.value = "";
      pintarElegido(null);
      elNombre.focus();
      buscar();
    };
  };
  const buscar = async () => {
    const nombre = (elNombre.value || "").trim();
    const cuit = (elCuit.value || "").trim();
    const direccion = (elDir.value || "").trim();
    if (elId.value && !nombre && !cuit && !direccion) return;
    if (!nombre && !cuit && !direccion) {
      elLista.hidden = true;
      elLista.innerHTML = "";
      return;
    }
    const qs = new URLSearchParams();
    if (nombre) qs.set("q", nombre);
    if (cuit) qs.set("cuit", cuit);
    if (direccion) qs.set("direccion", direccion);
    if (extraParams && typeof extraParams === "object") {
      Object.entries(extraParams).forEach(([k, v]) => {
        if (v != null && v !== "") qs.set(k, String(v));
      });
    }
    const data = await api("/api/clientes?" + qs.toString());
    const rows = (data.clientes || []).slice(0, 25);
    elLista.innerHTML = rows.length
      ? rows.map((c) => `
        <li data-id="${c.id}">
          <strong>${esc(c.nombre)}</strong>
          <small>${esc(c.cuit || "—")}${c.tubos != null ? ` · ${Number(c.tubos)} tubo(s)` : ""}</small>
          <span class="cli-dir">${esc(c.direccion || "—")}</span>
        </li>`).join("")
      : `<li class="empty-li">Sin coincidencias</li>`;
    elLista.hidden = false;
    elLista.querySelectorAll("li[data-id]").forEach((li) => {
      li.onclick = () => {
        const c = rows.find((x) => String(x.id) === li.dataset.id);
        elId.value = li.dataset.id;
        elLista.hidden = true;
        if (c) {
          elNombre.value = c.nombre || "";
          elCuit.value = c.cuit || "";
          elDir.value = c.direccion || "";
          pintarElegido(c);
        }
        if (onSelect) onSelect(c);
      };
    });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => buscar().catch((e) => toast(e.message, true)), 180);
  };
  [elNombre, elCuit, elDir].forEach((inp) => {
    if (inp) inp.oninput = schedule;
  });
  return {
    getId: () => elId.value,
    required,
  };
}

function tablaTubos(tubos, { check = false, extra = "" } = {}) {
  if (!tubos.length) return `<p class="empty">No hay tubos para mostrar.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${check ? "<th></th>" : ""}
            <th>Número</th><th>Artículo</th><th>Descripción</th>
            <th>Estado</th><th>Propiedad</th><th>Cliente</th><th>Lote</th><th>Vto.</th>${extra}
          </tr>
        </thead>
        <tbody>
          ${tubos.map((t) => `
            <tr>
              ${check ? `<td><input type="checkbox" name="tubo" value="${t.id}"></td>` : ""}
              <td class="mono"><a href="#/tubo/${t.id}">${esc(t.numero)}</a></td>
              <td class="mono">${esc(t.articulo_codigo)}</td>
              <td>${esc(t.articulo_descripcion)}</td>
              <td>${badge(t.estado)}</td>
              <td><span class="badge ${t.propiedad === "cliente" ? "cliente" : "empresa"}">${t.propiedad === "cliente" ? "Cliente" : "Empresa"}</span></td>
              <td>${esc(t.cliente_nombre || "—")}</td>
              <td class="mono">${esc(t.lote || "—")}</td>
              <td class="mono">${fmtFecha(t.fecha_vto)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

async function vistaInicio() {
  setNav("inicio");
  if (state.usuario?.rol === "reparto") {
    const data = await api("/api/repartos");
    const hoy = hoyInput();
    const lista = data.repartos || [];
    const deHoy = lista.filter((r) => String(r.fecha || "").slice(0, 10) === hoy);
    const base = deHoy.length ? deHoy : (lista[0] ? [lista[0]] : []);
    let hechas = 0;
    let total = 0;
    base.forEach((r) => {
      hechas += Number(r.paradas_hechas || 0);
      total += Number(r.paradas_total || 0);
    });
    const pendientes = Math.max(0, total - hechas);
    const verId = deHoy[0]?.id || lista[0]?.id;
    const saludo = (() => {
      const h = new Date().getHours();
      if (h < 12) return "Buenos días";
      if (h < 19) return "Buenas tardes";
      return "Buenas noches";
    })();
    app().innerHTML = `
      <h1>${saludo}, ${esc(state.usuario.nombre)}</h1>
      <p class="lead">Acá tenés tu ruta y las entregas / retiros de cliente.</p>
      <div class="grid stats reparto-inicio-stats">
        <div class="card stat vacio"><div class="n">${pendientes}</div><small>Lugares pendientes</small></div>
        <div class="card stat cargado"><div class="n">${hechas}</div><small>Hechos</small></div>
        <div class="card stat total"><div class="n">${total}</div><small>${deHoy.length ? "Paradas de hoy" : "En la hoja abierta"}</small></div>
      </div>
      <div class="quick-row no-print">
        <a class="quick" style="background:#2b5d8a;grid-column:1/-1" href="${verId ? `#/reparto?ver=${verId}` : "#/reparto"}">
          ${verId ? (deHoy.length ? "Abrir hoja de hoy" : "Abrir hoja de ruta") : "Ver repartos"}
        </a>
        <a class="quick green" href="#/cliente/despacho">Despacho a cliente</a>
        <a class="quick red" href="#/cliente/recepcion">Recepción de cliente</a>
      </div>
      <div class="card" style="margin-top:12px">
        <h3>Tus hojas</h3>
        ${lista.slice(0, 5).map((r) => {
          const av = avanceReparto(r);
          return `<p><a href="#/reparto?ver=${r.id}">${fmtFecha(r.fecha)} · ${esc(r.estado)} · ${Number(r.paradas_hechas || 0)}/${Number(r.paradas_total || 0)}</a>
            ${av.ok ? "" : ` <span class="badge badge-warn-rep">${esc(av.texto)}</span>`}</p>`;
        }).join("") || "<p class='empty'>Todavía no tenés hoja de ruta asignada.</p>"}
      </div>`;
    return;
  }
  if (rolActual() === "despacho") {
    app().innerHTML = `
      <h1>Hola, ${esc(state.usuario.nombre)}</h1>
      <p class="lead">Escaneá en el celular. Las recepciones quedan pendientes para que administración complete los lotes en la PC.</p>
      <div class="quick-row no-print">
        <a class="quick green" href="#/planta/despacho">Despacho a planta</a>
        <a class="quick red" href="#/planta/recepcion">Recepción de planta</a>
      </div>`;
    return;
  }
  const r = await api("/api/resumen");
  const t = r.totales;
  let pendientes = [];
  if (rolActual() === "admin") {
    try {
      pendientes = (await api("/api/planta/documentos?estado=borrador&tipo=recepcion")).documentos || [];
    } catch (_) { pendientes = []; }
  }
  app().innerHTML = `
    <div class="quick-row no-print">
      ${puede("admin") ? `
        <a class="quick green" href="#/planta/despacho">Despacho a planta</a>
        <a class="quick red" href="#/planta/recepcion">Recepción (escanear)</a>
        <a class="quick" style="background:#8a5a12" href="#/planta/completar">Completar recepciones${pendientes.length ? ` (${pendientes.length})` : ""}</a>
        <a class="quick green" href="#/cliente/despacho">Despacho a cliente</a>
        <a class="quick red" href="#/cliente/recepcion">Recepción de cliente</a>
      ` : ""}
      ${puede("admin", "reparto") ? `<a class="quick" style="background:#2b5d8a;grid-column:1/-1" href="#/reparto">Reparto del día</a>` : ""}
      ${rolActual() === "admin" || rolActual() === "cobrador" ? `
        <a class="quick" style="background:#8a5a12" href="#/facturar">Facturar</a>
        <a class="quick" style="background:#9b2c2c" href="#/deudas">Deudas</a>
        <a class="quick" style="background:#2b5d8a" href="#/cheques">Cheques</a>
        <a class="quick" style="background:#24483e" href="#/facturacion">Resumen caja</a>
      ` : ""}
    </div>
    ${pendientes.length ? `
      <a class="banner-fact" href="#/planta/completar">${pendientes.length} recepción(es) escaneada(s) pendientes de lotes / trazabilidad</a>
    ` : ""}
    <h1>Dónde están los tubos</h1>
    <p class="lead">Gasonor SRL — rotación de cilindros. Los artículos genéricos no entran en estos marcadores.</p>
    <div class="ciclo">
      <b>Vacío en empresa</b> → <b>Cargado en empresa</b> → <b>Despacho a cliente</b> → retorno → vacío
    </div>
    <div class="grid stats">
      <a class="card stat vacio" href="#/catalogo?tipo=tubo&estado=vacio"><div class="n">${t.vacio || 0}</div><small>Tubos vacíos</small></a>
      <a class="card stat cargado" href="#/catalogo?tipo=tubo&estado=cargado"><div class="n">${t.cargado || 0}</div><small>Tubos cargados</small></a>
      <a class="card stat en_planta" href="#/catalogo?tipo=tubo&estado=en_planta"><div class="n">${t.en_planta || 0}</div><small>En planta (todos los proveedores)</small></a>
      <a class="card stat en_cliente" href="#/catalogo?tipo=tubo&propiedad=empresa&estado=en_cliente"><div class="n">${t.gn_en_cliente || 0}</div><small>Tubos GN en clientes</small></a>
      <a class="card stat total" href="#/catalogo?tipo=generico"><div class="n">${t.genericos || 0}</div><small>Artículos genéricos</small></a>
    </div>
    <p class="lead">Rotación: ${t.total || 0} tubos · ${t.prop_empresa || 0} de Gasonor · ${t.prop_cliente || 0} de clientes.</p>
    <div class="grid two" style="margin-top:16px">
      <div class="card">
        <h3>Últimos movimientos</h3>
        ${r.recientes.length ? `
        <table>
          <thead><tr><th>Fecha</th><th>Movim.</th><th>Número</th><th>Destino / origen</th></tr></thead>
          <tbody>
            ${r.recientes.map((m) => `
              <tr>
                <td class="mono">${fmtFecha(m.fecha)}</td>
                <td>${esc(TIPOS[m.tipo] || m.tipo)}</td>
                <td class="mono">${esc(m.numero)}</td>
                <td>${esc(m.cliente_nombre || "—")}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : `<p class="empty">Todavía no hay movimientos.</p>`}
      </div>
      <div class="card">
        <h3>Clientes con tubos</h3>
        ${r.por_cliente.length ? `
        <table>
          <thead><tr><th>Cliente</th><th>Tubos</th></tr></thead>
          <tbody>
            ${r.por_cliente.map((c) => `
              <tr>
                <td><a href="#/clientes/${c.id}">${esc(c.nombre)}</a></td>
                <td class="mono">${c.cantidad}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : `<p class="empty">Ningún cliente tiene tubos ahora.</p>`}
        <h3 style="margin-top:22px">Próximos vencimientos</h3>
        ${r.proximos_vto.length ? `
        <table>
          <thead><tr><th>Número</th><th>Lote</th><th>Vto.</th></tr></thead>
          <tbody>
            ${r.proximos_vto.map((x) => `
              <tr>
                <td class="mono"><a href="#/tubo/${x.id}">${esc(x.numero)}</a></td>
                <td class="mono">${esc(x.lote || "—")}</td>
                <td class="mono">${fmtFecha(x.fecha_vto)}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : `<p class="empty">Sin fechas de vencimiento cargadas.</p>`}
      </div>
    </div>`;
}

async function vistaTubos(params) {
  return vistaCatalogo(params);
}

async function vistaArticulos(params) {
  if (!params.get("tipo")) params.set("tipo", params.get("tipo") || "");
  return vistaCatalogo(params);
}

function codProvItem(it) {
  if (it.kind === "generico") return it.codigo_proveedor || "—";
  return it.codigo_proveedor || it.articulo_codigo_proveedor || "—";
}

function marcaRetener(v) {
  return Number(v) ? `<span class="retener-ok" title="Retener">✓</span>` : "";
}

function htmlUltimoMov(it) {
  const cuando = it.ultimo_movimiento || it.actualizado_en || it.creado_en || "";
  if (!cuando) return `<span class="lead" style="margin:0">—</span>`;
  const tipo = TIPOS[it.ultimo_movimiento_tipo] || it.ultimo_movimiento_tipo || (it.ultimo_movimiento ? "" : "Actualizado");
  const fecha = String(cuando).length > 10 ? `${fmtFecha(cuando)} ${String(cuando).slice(11, 16)}` : fmtFecha(cuando);
  return `<span class="mono" title="${esc(tipo || "Último registro")}">${esc(fecha || cuando)}</span>${tipo ? `<div class="lead" style="margin:0;font-size:.8rem">${esc(tipo)}</div>` : ""}`;
}

function htmlCatalogo(items) {
  if (!items.length) return `<p class="empty">No hay resultados. Seguí escribiendo o cambiá el filtro.</p>`;
  return `
    <div class="table-wrap">
      <table class="cat-table">
        <thead>
          <tr>
            <th class="col-sel sticky-col"></th>
            <th class="col-edit sticky-col2"></th>
            <th>Tipo</th>
            <th>Código / Nº</th>
            <th>Últ. movimiento</th>
            <th>Cód. proveedor</th>
            <th>Descripción / gas</th>
            <th>Cap.</th>
            <th>Estado</th>
            <th>Propiedad</th>
            <th>Retener</th>
            <th>Cliente</th>
            <th>Vto. hidráulica</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it) => {
            const key = `${it.kind}-${it.id}`;
            if (it.kind === "generico") {
              return `
            <tr data-row-key="${esc(key)}" data-kind="generico" data-id="${it.id}">
              <td class="sticky-col"><input type="checkbox" class="sel-box sel-item" data-kind="generico" value="${it.id}"></td>
              <td class="sticky-col2"><button type="button" class="btn secondary row-edit-btn" data-edit-key="${esc(key)}" title="Editar este artículo">Editar</button></td>
              <td><span class="badge vacio">Genérico</span></td>
              <td class="mono cell-view" data-f="codigo">${esc(it.codigo)}</td>
              <td>${htmlUltimoMov(it)}</td>
              <td class="mono cell-view" data-f="codigo_proveedor">${esc(codProvItem(it) === "—" ? "" : codProvItem(it))}</td>
              <td class="cell-view" data-f="descripcion">${esc(it.descripcion)}</td>
              <td class="cell-view" data-f="capacidad">${esc(it.capacidad || "")}</td>
              <td>—</td>
              <td>En empresa</td>
              <td class="retener-cell cell-view" data-f="retener">${marcaRetener(it.retener)}</td>
              <td>—</td>
              <td>—</td>
            </tr>`;
            }
            const codp = it.codigo_proveedor || it.articulo_codigo_proveedor || "";
            return `
            <tr data-row-key="${esc(key)}" data-kind="tubo" data-id="${it.id}" data-articulo-id="${it.articulo_id || ""}">
              <td class="sticky-col"><input type="checkbox" class="sel-box sel-item" data-kind="tubo" value="${it.id}"></td>
              <td class="sticky-col2"><button type="button" class="btn secondary row-edit-btn" data-edit-key="${esc(key)}" title="Editar este tubo">Editar</button></td>
              <td><span class="badge cargado">Tubo</span></td>
              <td class="mono">
                <div class="cell-view" data-f="numero"><a href="#/tubo/${it.id}">${esc(it.numero)}</a></div>
                <div class="lead cell-view" data-f="articulo_codigo" style="margin:0">${esc(it.articulo_codigo || "")}</div>
              </td>
              <td>${htmlUltimoMov(it)}</td>
              <td class="mono cell-view" data-f="codigo_proveedor">${esc(codp)}</td>
              <td class="cell-view" data-f="descripcion">${esc(it.articulo_descripcion || it.grupo || "")}</td>
              <td class="cell-view" data-f="capacidad">${esc(it.capacidad || "")}</td>
              <td>${badge(it.estado)}</td>
              <td class="cell-view" data-f="propiedad"><span class="badge ${it.propiedad === "cliente" ? "cliente" : "empresa"}">${it.propiedad === "cliente" ? "Cliente" : "GN"}</span></td>
              <td class="retener-cell cell-view" data-f="retener">${marcaRetener(it.retener || it.articulo_retener)}</td>
              <td>${esc(it.cliente_nombre || "—")}</td>
              <td class="mono cell-view" data-f="fecha_vto">${fmtFecha(it.fecha_vto) || "—"}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function modalEditarCatalogoItem(it, onSaved) {
  const esGen = it.kind === "generico";
  abrirModal(`
    <h2>Editar ${esGen ? "artículo" : "tubo"}</h2>
    <p class="lead">${esGen
      ? `Código <span class="mono">${esc(it.codigo || "")}</span>`
      : `Nº <span class="mono">${esc(it.numero || "")}</span> · ${esc(it.articulo_codigo || "")} · Estado actual: <strong>${esc(ESTADOS[it.estado] || it.estado || "—")}</strong>${it.proveedor_nombre ? ` · Planta: <strong>${esc(it.proveedor_nombre)}</strong>` : ""}`}
      · Últ. mov.: ${esc((() => {
        const c = it.ultimo_movimiento || it.actualizado_en || "";
        if (!c) return "—";
        return String(c).length > 10 ? `${fmtFecha(c)} ${String(c).slice(11, 16)}` : fmtFecha(c);
      })())}</p>
    <form id="form-edit-item" class="grid form">
      ${esGen ? `
        <div class="field"><label>Código</label><input name="codigo" required value="${esc(it.codigo || "")}"></div>
        <div class="field"><label>Cód. proveedor</label><input name="codigo_proveedor" value="${esc(it.codigo_proveedor || "")}"></div>
        <div class="field full"><label>Descripción</label><input name="descripcion" required value="${esc(it.descripcion || "")}"></div>
        <div class="field"><label>Capacidad</label><input name="capacidad" value="${esc(it.capacidad || "")}"></div>
        <div class="field"><label class="check-inline"><input type="checkbox" name="retener" value="1" ${Number(it.retener) ? "checked" : ""}> Retener</label></div>
      ` : `
        <div class="field"><label>Número de tubo</label><input name="numero" required value="${esc(it.numero || "")}"></div>
        <div class="field"><label>Estado</label>
          <select name="estado" id="edit-estado">
            ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${it.estado === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
        <div class="field full" id="edit-wrap-planta" ${it.estado === "en_planta" ? "" : "hidden"}>
          <label>Planta / proveedor</label>
          <select name="proveedor_id" id="edit-proveedor">
            <option value="">Cargando plantas…</option>
          </select>
          <small class="hint">Obligatorio si el estado es “En planta”: el tubo queda a cargo de ese proveedor.</small>
        </div>
        <div class="field"><label>Código artículo</label><input name="articulo_codigo" value="${esc(it.articulo_codigo || "")}"></div>
        <div class="field"><label>Cód. proveedor</label><input name="codigo_proveedor" value="${esc(it.codigo_proveedor || it.articulo_codigo_proveedor || "")}"></div>
        <div class="field"><label>Descripción / gas</label><input name="descripcion" value="${esc(it.articulo_descripcion || it.grupo || "")}"></div>
        <div class="field"><label>Capacidad</label><input name="capacidad" value="${esc(it.capacidad || "")}"></div>
        <div class="field"><label>Número de lote</label><input name="lote" value="${esc(it.lote || "")}" placeholder="Lote de carga / gas"></div>
        <div class="field"><label>Propiedad</label>
          <select name="propiedad" id="edit-propiedad">
            <option value="empresa" ${it.propiedad !== "cliente" ? "selected" : ""}>GN (Gasonor)</option>
            <option value="cliente" ${it.propiedad === "cliente" ? "selected" : ""}>Del cliente</option>
          </select>
        </div>
        <div class="field full" id="edit-wrap-cliente" ${it.propiedad === "cliente" ? "" : "hidden"}>
          <label>Cliente propietario</label>
          <div class="cli-suggest">
            <input id="edit-cli-busca" value="${esc(it.cliente_nombre || "")}" placeholder="Escribí nombre del cliente…" autocomplete="off">
            <input type="hidden" name="cliente_id" id="edit-cli-id" value="${it.cliente_id || ""}">
            <ul id="edit-cli-lista" hidden></ul>
          </div>
          <small class="hint">Obligatorio: el tubo queda enlazado a la ficha de ese cliente (envase propio S/P).</small>
        </div>
        <div class="field"><label>Vto. hidráulica / carga</label><input name="fecha_vto" type="date" value="${esc(it.fecha_vto || "")}"></div>
        <div class="field"><label class="check-inline"><input type="checkbox" name="retener" value="1" ${Number(it.retener || it.articulo_retener) ? "checked" : ""}> Retener</label></div>
        <div class="field full"><small class="hint">Si el tubo está en planta y cambiás el estado, te va a pedir confirmar lote / vto. o seguir sin esos datos.</small></div>
      `}
      <div class="field full toolbar">
        <button class="btn copper" type="submit">Guardar cambios</button>
        ${!esGen ? `<a class="btn ghost" href="#/tubo/${it.id}">Ver ficha completa</a>` : ""}
      </div>
    </form>
    <div id="aviso-cambio-estado" class="aviso-salida-planta" hidden></div>`);

  let listaProveedores = [];
  const syncPlanta = () => {
    const wrap = $("#edit-wrap-planta");
    if (!wrap) return;
    const estadoSel = $("#edit-estado")?.value || "";
    wrap.hidden = !(estadoSel === "en_planta" && it.estado === "en_planta");
  };
  const syncPropiedad = () => {
    const wrap = $("#edit-wrap-cliente");
    if (!wrap) return;
    wrap.hidden = ($("#edit-propiedad")?.value || "") !== "cliente";
  };
  const pintarOptsProv = (sel, selected) => {
    if (!sel) return;
    sel.innerHTML = `<option value="">Elegí la planta…</option>${optsProveedores(listaProveedores, selected || "")}`;
  };
  if (!esGen) {
    $("#edit-estado").onchange = syncPlanta;
    $("#edit-propiedad").onchange = syncPropiedad;
    syncPlanta();
    syncPropiedad();
    bindBusquedaClienteSimple("#edit-cli-busca", "#edit-cli-id", "#edit-cli-lista");
    api("/api/proveedores").then((data) => {
      listaProveedores = data.proveedores || [];
      pintarOptsProv($("#edit-proveedor"), it.proveedor_id);
    }).catch((err) => toast(err.message, true));
  }

  const guardarTubo = async (fd) => {
    const body = {
      numero: fd.numero,
      codigo_proveedor: fd.codigo_proveedor || "",
      propiedad: fd.propiedad || "empresa",
      fecha_vto: fd.fecha_vto || "",
      lote: fd.lote || "",
      estado: fd.estado || it.estado,
      retener: fd.retener === "1" ? 1 : 0,
      articulo_id: it.articulo_id,
    };
    if (body.propiedad === "cliente") {
      const cid = Number(fd.cliente_id || $("#edit-cli-id")?.value || 0);
      if (!cid) throw new Error("Asigná el cliente propietario");
      body.cliente_id = cid;
    } else {
      body.cliente_id = body.estado === "en_cliente" ? (fd.cliente_id || it.cliente_id || null) : null;
    }
    if (body.estado === "en_planta") {
      const pid = Number(fd.proveedor_id);
      if (!pid) throw new Error("Elegí la planta / proveedor");
      body.proveedor_id = pid;
    } else {
      body.proveedor_id = null;
    }
    await api("/api/tubos/" + it.id, { method: "PUT", body });
    if (it.articulo_id) {
      await api("/api/articulos/" + it.articulo_id, {
        method: "PUT",
        body: {
          codigo: fd.articulo_codigo || it.articulo_codigo,
          descripcion: fd.descripcion || it.articulo_descripcion,
          grupo: fd.descripcion || it.grupo || "",
          capacidad: fd.capacidad || "",
          codigo_proveedor: fd.codigo_proveedor || fd.articulo_codigo || it.articulo_codigo,
          retener: fd.retener === "1" ? 1 : 0,
          es_tubo: 1,
          activo: 1,
        },
      });
    }
    cerrarModal();
    toast(fd.estado && fd.estado !== it.estado
      ? `Guardado · estado ${ESTADOS[it.estado] || it.estado} → ${ESTADOS[fd.estado] || fd.estado}`
      : "Guardado");
    if (onSaved) await onSaved();
  };

  const mostrarAviso = (html) => {
    const box = $("#aviso-cambio-estado");
    if (!box) return null;
    box.hidden = false;
    box.innerHTML = html;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return box;
  };

  $("#form-edit-item").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.retener = e.target.retener?.checked ? "1" : "0";
    try {
      if (esGen) {
        if (!fd.codigo || !fd.descripcion) return toast("Código y descripción son obligatorios", true);
        await api("/api/articulos/" + it.id, {
          method: "PUT",
          body: {
            codigo: fd.codigo,
            descripcion: fd.descripcion,
            codigo_proveedor: fd.codigo_proveedor || fd.codigo,
            capacidad: fd.capacidad || "",
            retener: fd.retener === "1" ? 1 : 0,
            es_tubo: 0,
            activo: 1,
          },
        });
        cerrarModal();
        toast("Guardado");
        if (onSaved) await onSaved();
        return;
      }
      if (!fd.numero) return toast("El número de tubo es obligatorio", true);
      if (fd.propiedad === "cliente") {
        fd.cliente_id = fd.cliente_id || $("#edit-cli-id")?.value || "";
        if (!fd.cliente_id) {
          syncPropiedad();
          $("#edit-cli-busca")?.focus();
          return toast("Elegí de qué cliente es el tubo", true);
        }
      }

      const entraAPlanta = fd.estado === "en_planta" && it.estado !== "en_planta";
      if (entraAPlanta) {
        const box = mostrarAviso(`
          <div class="alerta-reparto" role="alert">
            <strong>Advertencia:</strong> estás pasando el tubo de
            <strong>${esc(ESTADOS[it.estado] || it.estado || "—")}</strong> a
            <strong>En planta</strong>. Tenés que indicar a qué planta / proveedor se asigna:
            el tubo queda a cargo de ese proveedor (como en un despacho).
          </div>
          <div class="grid form" style="margin-top:10px">
            <div class="field full"><label>Planta / proveedor</label>
              <select id="aviso-proveedor">
                <option value="">Elegí la planta…</option>
                ${optsProveedores(listaProveedores, fd.proveedor_id || it.proveedor_id || "")}
              </select>
            </div>
          </div>
          <div class="toolbar" style="margin-top:10px;flex-wrap:wrap;gap:8px">
            <button type="button" class="btn copper" id="btn-confirmar-planta">Asignar planta y guardar</button>
            <button type="button" class="btn ghost" id="btn-cancel-aviso">Cancelar</button>
          </div>`);
        if (!box) return;
        if (!listaProveedores.length) {
          api("/api/proveedores").then((data) => {
            listaProveedores = data.proveedores || [];
            pintarOptsProv($("#aviso-proveedor"), fd.proveedor_id || it.proveedor_id);
          }).catch((err) => toast(err.message, true));
        }
        $("#btn-cancel-aviso").onclick = () => { box.hidden = true; box.innerHTML = ""; };
        $("#btn-confirmar-planta").onclick = async () => {
          const pid = ($("#aviso-proveedor")?.value || "").trim();
          if (!pid) return toast("Elegí a qué planta asignar el tubo", true);
          fd.proveedor_id = pid;
          try { await guardarTubo(fd); } catch (err) { toast(err.message, true); }
        };
        $("#aviso-proveedor")?.focus();
        return;
      }

      if (fd.estado === "en_planta" && !fd.proveedor_id) {
        syncPlanta();
        $("#edit-proveedor")?.focus();
        return toast("Elegí a qué planta va el tubo", true);
      }

      const saleDePlanta = it.estado === "en_planta" && fd.estado && fd.estado !== "en_planta";
      if (saleDePlanta) {
        const box = mostrarAviso(`
          <div class="alerta-reparto" role="alert">
            <strong>Advertencia:</strong> este tubo está en planta. Si cambiás el estado a
            <strong>${esc(ESTADOS[fd.estado] || fd.estado)}</strong> no va a quedar la trazabilidad de recepción
            a menos que completes ahora el <b>nº de lote</b> y el <b>nº de trazabilidad</b>.
          </div>
          <div class="grid form" style="margin-top:10px">
            <div class="field"><label>Número de lote</label>
              <input id="salida-lote" value="${esc(fd.lote || "")}" placeholder="Ej: C012-943" autocomplete="off">
              <small class="hint">Lote de la carga / gas.</small>
            </div>
            <div class="field"><label>Número de trazabilidad</label>
              <input id="salida-trazabilidad" value="${esc(fd.numero || it.numero || "")}" placeholder="Nº de trazabilidad del tubo" autocomplete="off">
              <small class="hint">Número de trazabilidad del cilindro (obligatorio).</small>
            </div>
            <div class="field"><label>Fecha vto. (opcional)</label>
              <input id="salida-vto" type="date" value="${esc(fd.fecha_vto || "")}">
            </div>
          </div>
          <div class="toolbar" style="margin-top:10px;flex-wrap:wrap;gap:8px">
            <button type="button" class="btn copper" id="btn-completar-salida">Completar y confirmar cambio</button>
            <button type="button" class="btn secondary" id="btn-sin-datos-salida">Modificar sin esos datos</button>
            <button type="button" class="btn ghost" id="btn-cancel-aviso">Cancelar</button>
          </div>`);
        if (!box) return;
        $("#btn-cancel-aviso").onclick = () => { box.hidden = true; box.innerHTML = ""; };
        $("#btn-completar-salida").onclick = async () => {
          fd.lote = ($("#salida-lote")?.value || "").trim();
          fd.numero = ($("#salida-trazabilidad")?.value || "").trim();
          fd.fecha_vto = ($("#salida-vto")?.value || "").trim();
          if (!fd.lote) return toast("Ingresá el número de lote, o elegí “Modificar sin esos datos”", true);
          if (!fd.numero) return toast("Ingresá el número de trazabilidad, o elegí “Modificar sin esos datos”", true);
          try { await guardarTubo(fd); } catch (err) { toast(err.message, true); }
        };
        $("#btn-sin-datos-salida").onclick = async () => {
          try { await guardarTubo(fd); } catch (err) { toast(err.message, true); }
        };
        return;
      }
      await guardarTubo(fd);
    } catch (err) { toast(err.message, true); }
  };
}

function activarEdicionFila(tr, it) {
  // Compat: si alguien llama inline, redirigimos al editor individual (popup).
  modalEditarCatalogoItem(it, () => route());
}

async function guardarEdicionFila(tr, it) {
  const val = (name) => {
    const el = tr.querySelector(`[name="${name}"]`);
    if (!el) return "";
    if (el.type === "checkbox") return el.checked ? "1" : "0";
    return String(el.value || "").trim();
  };
  if (it.kind === "generico") {
    const codigo = val("codigo");
    const descripcion = val("descripcion");
    if (!codigo || !descripcion) throw new Error("Código y descripción son obligatorios");
    await api("/api/articulos/" + it.id, {
      method: "PUT",
      body: {
        codigo,
        descripcion,
        codigo_proveedor: val("codigo_proveedor") || codigo,
        capacidad: val("capacidad"),
        retener: val("retener") === "1" ? 1 : 0,
        es_tubo: 0,
        activo: 1,
      },
    });
  } else {
    const numero = val("numero");
    if (!numero) throw new Error("El número de tubo es obligatorio");
    const descripcion = val("descripcion");
    const capacidad = val("capacidad");
    const codigoArt = val("articulo_codigo");
    const codp = val("codigo_proveedor");
    const retener = val("retener") === "1" ? 1 : 0;
    await api("/api/tubos/" + it.id, {
      method: "PUT",
      body: {
        numero,
        codigo_proveedor: codp,
        propiedad: val("propiedad") || "empresa",
        fecha_vto: val("fecha_vto") || "",
        retener,
        articulo_id: it.articulo_id,
      },
    });
    if (it.articulo_id) {
      await api("/api/articulos/" + it.articulo_id, {
        method: "PUT",
        body: {
          codigo: codigoArt || it.articulo_codigo,
          descripcion: descripcion || it.articulo_descripcion,
          grupo: descripcion || it.grupo || "",
          capacidad,
          codigo_proveedor: codp || codigoArt || it.articulo_codigo,
          retener,
          es_tubo: 1,
          activo: 1,
        },
      });
    }
  }
}

async function vistaCatalogo(params) {
  setNav("catalogo");
  const soloPlanta = false;
  // Por defecto solo tubos: cargar genéricos junto hace más lenta la pantalla.
  const tipo0 = soloPlanta ? "tubo" : (params.get("tipo") || "tubo");
  const estado0 = soloPlanta ? "en_planta" : (params.get("estado") || "");
  const prop0 = soloPlanta ? "" : (params.get("propiedad") || "");
  const q0 = params.get("q") || "";
  const cliente0 = params.get("cliente") || params.get("cliente_id") || "";

  app().innerHTML = `
    <h1>Tubos y artículos</h1>
    <p class="lead">${soloPlanta ? "Solo tubos en planta." : "Tocá <b>Editar</b> en una fila para el editor individual. Marcá 2 o más para edición masiva."}</p>
    <div class="toolbar" id="cat-filtros">
      ${soloPlanta ? "" : `<div class="field"><label>Ver</label>
        <select id="f-tipo">
          <option value="" ${!tipo0 ? "selected" : ""}>Todos</option>
          <option value="tubo" ${tipo0 === "tubo" ? "selected" : ""}>Solo tubos</option>
          <option value="generico" ${tipo0 === "generico" ? "selected" : ""}>Solo genéricos</option>
        </select>
      </div>
      <div class="field"><label>Estado</label>
        <select id="f-estado">
          <option value="">Todos</option>
          ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${estado0 === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>Propiedad</label>
        <select id="f-prop">
          <option value="">Todas</option>
          <option value="empresa" ${prop0 === "empresa" ? "selected" : ""}>GN (Gasonor)</option>
          <option value="cliente" ${prop0 === "cliente" ? "selected" : ""}>Del cliente</option>
        </select>
      </div>`}
      <div class="field" style="flex:1;min-width:220px"><label>Buscar en tiempo real</label>
        <input id="f-q" value="${esc(q0)}" placeholder="Código, número, gas, cliente…" autocomplete="off">
      </div>
      ${soloPlanta ? "" : `<button class="btn copper" type="button" id="btn-alta">Cargar</button>`}
    </div>
    <div class="cat-sel-bar" id="cat-sel-bar">
      <label class="sel-all-label"><input type="checkbox" class="sel-box" id="sel-todo"> Seleccionar todo lo visible</label>
      <button type="button" class="btn icon-btn" id="btn-bulk-open" title="Edición masiva (2 o más)" hidden disabled aria-label="Edición masiva">✎ Masivo</button>
      <span class="lead" id="sel-count"></span>
    </div>
    <div class="bulk-panel" id="bulk-panel" hidden>
      <p class="lead" style="margin:0 0 10px">Cambios sobre los ítems marcados (los de la lista filtrada).</p>
      <form id="form-bulk" class="grid form">
        <div class="field"><label>Tipo de producto</label>
          <select name="tipo_producto">
            <option value="">— No cambiar —</option>
            <option value="tubo">Tubo (entra en rotación)</option>
            <option value="generico">Artículo genérico</option>
          </select>
        </div>
        <div class="field"><label>Propiedad (tubos)</label>
          <select name="propiedad">
            <option value="">— No cambiar —</option>
            <option value="empresa">GN (Gasonor)</option>
            <option value="cliente">Del cliente</option>
          </select>
        </div>
        <div class="field"><label>Retener</label>
          <select name="retener">
            <option value="">— No cambiar —</option>
            <option value="1">Sí (marcar ✓)</option>
            <option value="0">No (quitar)</option>
          </select>
        </div>
        <div class="field"><label>Código artículo</label><input name="codigo" placeholder="Vacío = no cambia"></div>
        <div class="field"><label>Cód. proveedor / barras</label><input name="codigo_proveedor" placeholder="Vacío = no cambia"></div>
        <div class="field"><label>Descripción / tipo de gas</label><input name="descripcion" placeholder="Vacío = no cambia"></div>
        <div class="field"><label>Capacidad</label><input name="capacidad"></div>
        <div class="field"><label>Nº de tubo</label><input name="numero" placeholder="Solo filas tubo"></div>
        <div class="field"><label>Vto. prueba hidráulica</label><input name="fecha_vto" type="date"></div>
        <div class="field full toolbar">
          <button class="btn copper" type="submit">Aplicar cambios</button>
          <button class="btn ghost" type="button" id="btn-bulk-cerrar">Cerrar</button>
          <button class="btn danger" type="button" id="btn-bulk-del">Dar de baja selección</button>
        </div>
      </form>
    </div>
    <div class="card" id="lista-cat"><p class="empty">Cargando…</p></div>`;

  const recoger = () => {
    const u = new URLSearchParams();
    const estado = $("#f-estado")?.value || estado0;
    // Estado solo aplica a tubos; si hay filtro de estado, forzamos tipo=tubo
    // para no mezclar genéricos (aparecen sin estado y parece que el filtro falla).
    let tipo = $("#f-tipo")?.value || tipo0;
    if (estado && !tipo) tipo = "tubo";
    const prop = $("#f-prop")?.value || prop0;
    const q = ($("#f-q")?.value || "").trim();
    if (tipo) u.set("tipo", tipo);
    if (estado) u.set("estado", estado);
    if (prop) u.set("propiedad", prop);
    if (q) u.set("q", q);
    if (cliente0) u.set("cliente_id", cliente0);
    return u;
  };

  const syncBulkUi = () => {
    const n = document.querySelectorAll(".sel-item:checked").length;
    const cnt = $("#sel-count");
    if (cnt) cnt.textContent = n ? `${n} seleccionado(s)` : "";
    const puedeMasivo = n >= 2;
    const openBtn = $("#btn-bulk-open");
    if (openBtn) {
      openBtn.hidden = !puedeMasivo;
      openBtn.disabled = !puedeMasivo;
      openBtn.classList.toggle("active", puedeMasivo && state.catalogoBulkOpen);
    }
    if (!puedeMasivo) state.catalogoBulkOpen = false;
    const panel = $("#bulk-panel");
    if (panel) panel.hidden = !state.catalogoBulkOpen;
  };

  let itemsCache = [];

  const pintar = async () => {
    const u = recoger();
    history.replaceState(null, "", "#/catalogo" + (u.toString() ? "?" + u : ""));
    const data = await api("/api/catalogo?" + u.toString());
    itemsCache = data.items || [];
    $("#lista-cat").innerHTML = htmlCatalogo(itemsCache);
    const selTodo = $("#sel-todo");
    const marcarTodo = (on) => {
      state.catalogoSelTodo = on;
      if (selTodo) selTodo.checked = on;
      document.querySelectorAll(".sel-item").forEach((c) => { c.checked = on; });
      if (!on) state.catalogoBulkOpen = false;
      syncBulkUi();
    };
    if (selTodo) {
      selTodo.onchange = () => marcarTodo(selTodo.checked);
      if (state.catalogoSelTodo && itemsCache.length) marcarTodo(true);
    }
    document.querySelectorAll(".sel-item").forEach((c) => {
      c.onchange = () => {
        const all = document.querySelectorAll(".sel-item");
        const checked = document.querySelectorAll(".sel-item:checked");
        if (selTodo) selTodo.checked = all.length > 0 && checked.length === all.length;
        state.catalogoSelTodo = !!selTodo?.checked;
        if (checked.length < 2) state.catalogoBulkOpen = false;
        syncBulkUi();
      };
    });
    document.querySelectorAll(".row-edit-btn").forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.editKey;
        const it = itemsCache.find((x) => `${x.kind}-${x.id}` === key);
        if (!it) return;
        modalEditarCatalogoItem(it, () => pintar());
      };
    });
    syncBulkUi();
  };

  const idsSel = () => [...document.querySelectorAll(".sel-item:checked")].map((c) => ({ kind: c.dataset.kind, id: Number(c.value) }));

  let tbus;
  $("#f-q").oninput = () => {
    clearTimeout(tbus);
    tbus = setTimeout(() => pintar().catch((e) => toast(e.message, true)), 220);
  };
  ["f-tipo", "f-estado", "f-prop"].forEach((id) => {
    const el = $("#" + id);
    if (el) el.onchange = () => pintar().catch((e) => toast(e.message, true));
  });
  if ($("#btn-alta")) $("#btn-alta").onclick = modalAltaCatalogo;
  $("#btn-bulk-open").onclick = () => {
    const n = document.querySelectorAll(".sel-item:checked").length;
    if (n < 2) return toast("Seleccioná al menos 2 ítems para edición masiva", true);
    state.catalogoBulkOpen = !state.catalogoBulkOpen;
    syncBulkUi();
  };
  $("#btn-bulk-cerrar").onclick = () => {
    state.catalogoBulkOpen = false;
    syncBulkUi();
  };
  $("#form-bulk").onsubmit = async (e) => {
    e.preventDefault();
    const ids = idsSel();
    if (!ids.length) return toast("No hay selección", true);
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const campos = {};
    Object.entries(fd).forEach(([k, v]) => {
      const s = String(v).trim();
      if (s) campos[k] = s;
    });
    if (campos.descripcion) campos.grupo = campos.descripcion;
    if (!Object.keys(campos).length) return toast("Elegí al menos un campo o el tipo de producto", true);
    try {
      const r = await api("/api/catalogo/masivo", { method: "POST", body: { accion: "actualizar", ids, campos } });
      let msg = "Actualizados: " + r.cantidad;
      if (campos.tipo_producto === "generico") {
        msg += ". Pasaron a genérico (dejan de listarse como tubos en rotación).";
        if (r.genericos) msg += " Artículos: " + r.genericos + ".";
      }
      toast(msg);
      state.catalogoBulkOpen = false;
      state.catalogoSelTodo = false;
      pintar();
    } catch (err) { toast(err.message, true); }
  };
  $("#btn-bulk-del").onclick = async () => {
    const ids = idsSel();
    if (!ids.length) return toast("No hay selección", true);
    if (!confirm("¿Eliminar (dar de baja) los " + ids.length + " productos visibles seleccionados?")) return;
    try {
      const r = await api("/api/catalogo/masivo", { method: "POST", body: { accion: "eliminar", ids } });
      toast("Eliminados: " + r.cantidad);
      pintar();
    } catch (err) { toast(err.message, true); }
  };
  await pintar().catch((err) => {
    $("#lista-cat").innerHTML = `<p class="empty">No se pudo cargar el catálogo.</p>`;
    toast(err.message || "Error al cargar tubos y artículos", true);
  });
}

function modalAltaTubo() {
  modalAltaCatalogo();
}

function modalAltaCatalogo() {
  abrirModal(`
    <h2>Cargar producto</h2>
    <form id="form-alta-cat" class="grid form">
      <div class="field full"><label>¿Qué estás cargando?</label>
        <select name="kind" id="alta-kind">
          <option value="tubo">Tubo (cilindro en rotación)</option>
          <option value="generico">Artículo genérico</option>
        </select>
      </div>
      <div id="alta-gen" hidden>
        <div class="field"><label>Código</label><input name="g_codigo" placeholder="Código interno"></div>
        <div class="field"><label>Cód. proveedor</label><input name="g_codigo_proveedor"></div>
        <div class="field full"><label>Descripción</label><input name="g_descripcion"></div>
        <div class="field full"><label class="check-inline"><input type="checkbox" name="g_retener" value="1"> Retener</label></div>
      </div>
      <div id="alta-tubo">
        <div class="field"><label>Propiedad</label>
          <select name="propiedad" id="alta-prop">
            <option value="empresa">GN (Gasonor)</option>
            <option value="cliente">Del cliente</option>
          </select>
        </div>
        <div class="field"><label class="check-inline"><input type="checkbox" name="retener" value="1"> Retener (nuestro / robado)</label></div>
        <div class="field"><label>Número de tubo</label><input name="numero" placeholder="Nº de trazabilidad"></div>
        <div class="field"><label>Tipo de gas</label><input name="grupo" placeholder="Oxígeno, Nitrógeno…"></div>
        <div class="field"><label>Capacidad</label><input name="capacidad" placeholder="m³ / litros"></div>
        <div class="field"><label>Vto. prueba hidráulica</label><input name="fecha_vto" type="date"></div>
        <div class="field"><label>Código</label><input name="codigo" placeholder="Código de artículo"></div>
        <div class="field"><label>Código proveedor</label><input name="codigo_proveedor"></div>
        <div class="field full" id="wrap-cli" hidden>
          <label>Cliente propietario</label>
          <div class="cli-suggest">
            <input id="cli-busca" placeholder="Escribí para buscar en la base…" autocomplete="off">
            <input type="hidden" name="cliente_id" id="cli-id">
            <ul id="cli-lista" hidden></ul>
          </div>
          <button class="btn ghost" type="button" id="btn-cli-nuevo" style="margin-top:8px">Cliente nuevo</button>
          <div id="cli-nuevo" hidden class="grid form" style="margin-top:8px">
            <div class="field"><label>Nombre</label><input id="cli-n"></div>
            <div class="field"><label>Teléfono</label><input id="cli-t"></div>
            <div class="field full"><label>Dirección</label><input id="cli-d"></div>
            <div class="field full"><button class="btn secondary" type="button" id="btn-cli-ok">Crear y asignar</button></div>
          </div>
        </div>
      </div>
      <div class="field full"><button class="btn copper" type="submit">Guardar</button></div>
    </form>`);
  const kind = $("#alta-kind");
  const toggleKind = () => {
    const tubo = kind.value === "tubo";
    $("#alta-tubo").hidden = !tubo;
    $("#alta-gen").hidden = tubo;
  };
  const toggleProp = () => {
    $("#wrap-cli").hidden = $("#alta-prop").value !== "cliente";
  };
  kind.onchange = toggleKind;
  $("#alta-prop").onchange = toggleProp;
  toggleKind();
  toggleProp();

  let tcli;
  const buscarCli = async () => {
    const q = $("#cli-busca").value.trim();
    const ul = $("#cli-lista");
    if (q.length < 2) { ul.hidden = true; ul.innerHTML = ""; return; }
    const data = await api("/api/clientes?q=" + encodeURIComponent(q));
    const rows = data.clientes || [];
    ul.innerHTML = rows.slice(0, 20).map((c) => `<li data-id="${c.id}">${esc(c.nombre)}</li>`).join("") || `<li>Sin coincidencias</li>`;
    ul.hidden = false;
    ul.querySelectorAll("li[data-id]").forEach((li) => {
      li.onclick = () => {
        $("#cli-id").value = li.dataset.id;
        $("#cli-busca").value = li.textContent;
        ul.hidden = true;
      };
    });
  };
  $("#cli-busca").oninput = () => { clearTimeout(tcli); tcli = setTimeout(() => buscarCli().catch(() => {}), 200); };
  $("#btn-cli-nuevo").onclick = () => { $("#cli-nuevo").hidden = !$("#cli-nuevo").hidden; };
  $("#btn-cli-ok").onclick = async () => {
    const nombre = $("#cli-n").value.trim();
    if (!nombre) return toast("El nombre del cliente es obligatorio", true);
    try {
      const r = await api("/api/clientes", { method: "POST", body: { nombre, telefono: $("#cli-t").value, direccion: $("#cli-d").value } });
      $("#cli-id").value = r.cliente.id;
      $("#cli-busca").value = r.cliente.nombre;
      $("#cli-nuevo").hidden = true;
      toast("Cliente creado y asignado");
      await cargarCatalogos().catch(() => {});
    } catch (err) { toast(err.message, true); }
  };

  $("#form-alta-cat").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      if (fd.kind === "generico") {
        await api("/api/articulos", { method: "POST", body: {
          codigo: fd.g_codigo, descripcion: fd.g_descripcion, codigo_proveedor: fd.g_codigo_proveedor, es_tubo: 0,
          retener: fd.g_retener ? 1 : 0,
        } });
        toast("Artículo genérico cargado");
      } else {
        if (!fd.numero || !fd.codigo) return toast("Número de tubo y código son obligatorios", true);
        if (fd.propiedad === "cliente" && !fd.cliente_id) return toast("Asigná el cliente propietario", true);
        await api("/api/tubos", { method: "POST", body: {
          numero: fd.numero,
          codigo: fd.codigo,
          codigo_proveedor: fd.codigo_proveedor,
          grupo: fd.grupo,
          tipo_gas: fd.grupo,
          descripcion: fd.grupo,
          capacidad: fd.capacidad,
          fecha_vto: fd.fecha_vto,
          propiedad: fd.propiedad,
          cliente_id: fd.cliente_id || null,
          retener: fd.retener ? 1 : 0,
          estado: "vacio",
        } });
        toast("Tubo cargado (queda vacío)");
      }
      cerrarModal();
      await cargarCatalogos();
      route();
    } catch (err) { toast(err.message, true); }
  };
}

async function vistaTubo(id) {
  setNav("tubos");
  const data = await api("/api/tubos/" + id);
  const t = data.tubo;
  app().innerHTML = `
    <h1>Tubo ${esc(t.numero)}</h1>
    <p class="lead">${esc(t.articulo_codigo)} · ${esc(t.articulo_descripcion)}</p>
    <div class="grid two">
      <div class="card">
        <p>${badge(t.estado)} ${t.cliente_nombre ? " · " + esc(t.cliente_nombre) : ""}</p>
        <p><b>Propiedad:</b> ${t.propiedad === "cliente"
          ? (t.cliente_id
            ? `del cliente (S/P) · <a href="#/clientes/${t.cliente_id}">${esc(t.cliente_nombre || "Ver ficha")}</a>`
            : "del cliente (S/P) · <em>sin cliente asignado</em>")
          : "de la empresa (Gasonor)"}</p>
        <p><b>Retener:</b> ${Number(t.retener) || Number(t.articulo_retener) ? "✓ Sí" : "No"}</p>
        <p><b>Lote:</b> <span class="mono">${esc(t.lote || "—")}</span> &nbsp; <b>Vto.:</b> <span class="mono">${fmtFecha(t.fecha_vto) || "—"}</span></p>
        <p><b>Notas:</b> ${esc(t.notas || "—")}</p>
        <div class="toolbar">
          <button class="btn secondary" id="btn-editar">Editar datos</button>
          ${t.activo ? `<button class="btn danger" id="btn-baja">Dar de baja</button>` : ""}
        </div>
      </div>
      <div class="card">
        <h3>Historial de trazabilidad</h3>
        <table>
          <thead><tr><th>Fecha</th><th>Movim.</th><th>Cliente</th><th>Lote</th></tr></thead>
          <tbody>
            ${data.movimientos.map((m) => `
              <tr>
                <td class="mono">${fmtFecha(m.fecha)}</td>
                <td>${esc(TIPOS[m.tipo] || m.tipo)}</td>
                <td>${esc(m.cliente_nombre || "—")}</td>
                <td class="mono">${esc(m.lote || "—")}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  $("#btn-editar").onclick = async () => {
    let provs = [];
    try {
      provs = (await api("/api/proveedores")).proveedores || [];
    } catch (_) { /* ok */ }
    abrirModal(`
      <h2>Editar tubo ${esc(t.numero)}</h2>
      <form id="form-edit" class="grid form">
        <div class="field"><label>Artículo</label><select name="articulo_id">${optsArticulos(t.articulo_id)}</select></div>
        <div class="field"><label>Número</label><input name="numero" value="${esc(t.numero)}" required></div>
        <div class="field"><label>Estado</label>
          <select name="estado" id="ficha-estado">
            ${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}" ${t.estado === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
        <div class="field full" id="ficha-wrap-planta" ${t.estado === "en_planta" ? "" : "hidden"}>
          <label>Planta / proveedor</label>
          <select name="proveedor_id" id="ficha-proveedor">
            <option value="">Elegí la planta…</option>
            ${optsProveedores(provs, t.proveedor_id)}
          </select>
          <small class="hint">Si ya está en planta, podés cambiar de proveedor acá.</small>
        </div>
        <div class="field"><label>Lote</label><input name="lote" value="${esc(t.lote || "")}"></div>
        <div class="field"><label>Vencimiento</label><input name="fecha_vto" type="date" value="${esc(t.fecha_vto || "")}"></div>
        <div class="field"><label>Propiedad</label>
          <select name="propiedad" id="ficha-propiedad">
            <option value="empresa" ${t.propiedad !== "cliente" ? "selected" : ""}>De la empresa</option>
            <option value="cliente" ${t.propiedad === "cliente" ? "selected" : ""}>Del cliente</option>
          </select>
        </div>
        <div class="field full" id="ficha-wrap-cliente" ${t.propiedad === "cliente" ? "" : "hidden"}>
          <label>Cliente propietario</label>
          <div class="cli-suggest">
            <input id="ficha-cli-busca" value="${esc(t.cliente_nombre || "")}" placeholder="Escribí nombre del cliente…" autocomplete="off">
            <input type="hidden" name="cliente_id" id="ficha-cli-id" value="${t.cliente_id || ""}">
            <ul id="ficha-cli-lista" hidden></ul>
          </div>
          <small class="hint">Obligatorio si es del cliente: queda enlazado a su ficha.</small>
        </div>
        <div class="field"><label class="check-inline"><input type="checkbox" name="retener" value="1" ${Number(t.retener) ? "checked" : ""}> Retener (nuestro / robado)</label></div>
        <div class="field full"><label>Notas</label><textarea name="notas" rows="2">${esc(t.notas || "")}</textarea></div>
        <div class="field full"><small class="hint">Si pasás a “En planta” desde otro estado, te va a pedir la planta en una advertencia.</small></div>
        <div class="field full"><button class="btn" type="submit">Guardar</button></div>
      </form>
      <div id="aviso-ficha-estado" class="aviso-salida-planta" hidden></div>`);
    const sync = () => {
      const wrap = $("#ficha-wrap-planta");
      if (!wrap) return;
      const estadoSel = $("#ficha-estado")?.value || "";
      wrap.hidden = !(estadoSel === "en_planta" && t.estado === "en_planta");
    };
    const syncProp = () => {
      const wrap = $("#ficha-wrap-cliente");
      if (wrap) wrap.hidden = ($("#ficha-propiedad")?.value || "") !== "cliente";
    };
    $("#ficha-estado").onchange = sync;
    $("#ficha-propiedad").onchange = syncProp;
    sync();
    syncProp();
    bindBusquedaClienteSimple("#ficha-cli-busca", "#ficha-cli-id", "#ficha-cli-lista");
    $("#form-edit").onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.retener = e.target.retener?.checked ? 1 : 0;
      body.cliente_id = body.cliente_id || $("#ficha-cli-id")?.value || "";
      const guardar = async () => {
        if (body.propiedad === "cliente") {
          if (!body.cliente_id) return toast("Elegí de qué cliente es el tubo", true);
          body.cliente_id = Number(body.cliente_id);
        } else if (body.estado !== "en_cliente") {
          body.cliente_id = null;
        }
        if (body.estado === "en_planta") {
          if (!body.proveedor_id) return toast("Elegí a qué planta va el tubo", true);
          body.proveedor_id = Number(body.proveedor_id);
        } else {
          body.proveedor_id = null;
        }
        try {
          await api("/api/tubos/" + t.id, { method: "PUT", body });
          cerrarModal(); toast("Tubo actualizado"); route();
        } catch (err) { toast(err.message, true); }
      };
      if (body.estado === "en_planta" && t.estado !== "en_planta") {
        const box = $("#aviso-ficha-estado");
        if (!box) return;
        box.hidden = false;
        box.innerHTML = `
          <div class="alerta-reparto" role="alert">
            <strong>Advertencia:</strong> estás pasando el tubo a <strong>En planta</strong>.
            Indicá a qué planta / proveedor se asigna.
          </div>
          <div class="grid form" style="margin-top:10px">
            <div class="field full"><label>Planta / proveedor</label>
              <select id="aviso-ficha-prov">
                <option value="">Elegí la planta…</option>
                ${optsProveedores(provs, body.proveedor_id || t.proveedor_id || "")}
              </select>
            </div>
          </div>
          <div class="toolbar" style="margin-top:10px;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn copper" id="btn-ficha-planta">Asignar planta y guardar</button>
            <button type="button" class="btn ghost" id="btn-ficha-cancel">Cancelar</button>
          </div>`;
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
        $("#btn-ficha-cancel").onclick = () => { box.hidden = true; box.innerHTML = ""; };
        $("#btn-ficha-planta").onclick = () => {
          const pid = ($("#aviso-ficha-prov")?.value || "").trim();
          if (!pid) return toast("Elegí a qué planta asignar el tubo", true);
          body.proveedor_id = pid;
          guardar();
        };
        return;
      }
      await guardar();
    };
  };
  const baja = $("#btn-baja");
  if (baja) baja.onclick = async () => {
    if (!confirm("¿Sacar este tubo de circulación?")) return;
    try {
      await api("/api/tubos/" + t.id, { method: "PUT", body: { activo: 0 } });
      toast("Tubo dado de baja"); location.hash = "#/catalogo?tipo=tubo";
    } catch (err) { toast(err.message, true); }
  };
}

function tablaTubosCliente(rows, vacio) {
  if (!rows.length) return `<p class="empty">${esc(vacio)}</p>`;
  return `<table>
    <thead><tr><th>Número</th><th>Código art.</th><th>Artículo / gas</th><th>Dueño</th><th>Estado</th><th>Lote</th><th>Vto.</th></tr></thead>
    <tbody>
      ${rows.map((t) => `
        <tr>
          <td class="mono"><a href="#/tubo/${t.id}">${esc(t.numero)}</a></td>
          <td class="mono"><a href="#/catalogo?tipo=tubo&q=${encodeURIComponent(t.articulo_codigo || "")}">${esc(t.articulo_codigo)}</a></td>
          <td>${esc(t.articulo_descripcion)}</td>
          <td><span class="badge ${t.propiedad === "cliente" ? "cliente" : "empresa"}">${t.propiedad === "cliente" ? "Propio (S/P)" : "Gasonor (GN)"}</span></td>
          <td>${badge(t.estado)}</td>
          <td class="mono">${esc(t.lote || "—")}</td>
          <td class="mono">${fmtFecha(t.fecha_vto) || "—"}</td>
        </tr>`).join("")}
    </tbody>
  </table>`;
}

async function vistaClienteFicha(id, params) {
  setNav("clientes");
  const tab = params.get("tab") || "gn";
  const data = await api("/api/clientes/" + id);
  const c = data.cliente;
  const r = data.resumen || {};
  const tubosGn = data.tubos_gn || (data.tubos_en_cliente || []).filter((t) => t.propiedad !== "cliente");
  const tubosPropios = data.tubos_propios || [];
  const propiosEnPoder = tubosPropios.filter((t) => t.estado === "en_cliente");
  const propiosFuera = tubosPropios.filter((t) => t.estado !== "en_cliente");
  app().innerHTML = `
    <p><a href="#/clientes">← Clientes</a></p>
    <h1>${esc(c.nombre)}</h1>
    <p class="lead">
      ${esc(c.direccion || "Sin dirección")}
      ${c.cuit ? " · CUIT " + esc(c.cuit) : ""}
      ${c.telefono ? " · " + esc(c.telefono) : ""}
      ${c.activo ? "" : " · <em>Inactivo</em>"}
    </p>
    <div class="grid stats">
      <div class="card stat en_cliente"><div class="n">${r.en_cliente_gn ?? tubosGn.length}</div><small>GN en su poder</small></div>
      <div class="card stat cliente"><div class="n">${r.propios_en_poder ?? propiosEnPoder.length}</div><small>Propios en su poder</small></div>
      <div class="card stat vacio"><div class="n">${r.registrados_propios ?? tubosPropios.length}</div><small>Propios registrados (total)</small></div>
    </div>
    <div class="toolbar">
      <button class="btn copper" type="button" id="btn-asig-tubo">Asignar tubo existente</button>
      <button class="btn ghost" type="button" data-edit-cli="${c.id}">Editar datos</button>
      <a class="btn secondary" href="#/cliente/despacho">Despacho a cliente</a>
      <a class="btn secondary" href="#/cliente/recepcion">Recepción de cliente</a>
    </div>
    <div class="tabs">
      <button data-tab="gn" class="${tab === "gn" ? "active" : ""}">GN en poder (${tubosGn.length})</button>
      <button data-tab="propios" class="${tab === "propios" ? "active" : ""}">Envases propios (${tubosPropios.length})</button>
      <button data-tab="historial" class="${tab === "historial" ? "active" : ""}">Historial</button>
    </div>
    <div id="cli-tab" class="card"></div>`;

  app().querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => { location.hash = "#/clientes/" + id + "?tab=" + b.dataset.tab; };
  });

  const box = $("#cli-tab");
  if (tab === "propios") {
    box.innerHTML = `
      <h3>Envases propios de este cliente (S/P)</h3>
      <p class="lead">Todos los cilindros registrados a su nombre. Los que están <b>en cliente</b> son los que tiene en poder; el resto pueden estar vacíos, cargados o en planta.</p>
      ${propiosEnPoder.length ? `
        <h4 style="margin:12px 0 6px">En su poder ahora (${propiosEnPoder.length})</h4>
        ${tablaTubosCliente(propiosEnPoder, "")}
      ` : `<p class="empty">Ningún envase propio está ahora en su poder.</p>`}
      ${propiosFuera.length ? `
        <h4 style="margin:18px 0 6px">Registrados pero no en su poder (${propiosFuera.length})</h4>
        ${tablaTubosCliente(propiosFuera, "")}
      ` : ""}
      ${!tubosPropios.length ? `<p class="empty">No hay envases propios registrados.</p>` : ""}`;
  } else if (tab === "historial") {
    const movs = data.movimientos || [];
    const ventas = data.ventas || [];
    const linea = [
      ...movs.map((m) => ({
        sort: `${m.fecha}-${String(m.id).padStart(8, "0")}`,
        fecha: m.fecha,
        hora: "",
        tipo: "tubo",
        titulo: TIPOS[m.tipo] || m.tipo,
        detalle: [
          m.tubo_numero ? `Tubo ${m.tubo_numero}` : "",
          m.articulo_codigo || "",
          m.lote ? `Lote ${m.lote}` : "",
          m.observaciones || "",
        ].filter(Boolean).join(" · "),
        monto: null,
      })),
      ...ventas.map((v) => ({
        sort: `${v.fecha}-${String(v.id).padStart(8, "0")}`,
        fecha: v.fecha,
        hora: v.hora || "",
        tipo: "caja",
        titulo: v.tipo === "salida" ? "Salida de caja" : "Cobro / venta",
        detalle: v.descripcion || "",
        monto: v.total,
        salida: v.tipo === "salida",
      })),
    ].sort((a, b) => (a.sort < b.sort ? 1 : -1));
    box.innerHTML = linea.length ? `
      <h3>Historial (tubos + cobros)</h3>
      <p class="lead">Despachos y recepciones de cliente, envíos a planta de propios, y lo cobrado a este cliente.</p>
      <table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Importe</th></tr></thead>
        <tbody>
          ${linea.map((x) => `
            <tr>
              <td class="mono">${fmtFecha(x.fecha)}${x.hora ? " " + esc(x.hora) : ""}</td>
              <td><span class="badge ${x.tipo === "caja" ? "badge-fact" : ""}">${esc(x.titulo)}</span></td>
              <td>${esc(x.detalle)}</td>
              <td class="mono">${x.monto == null ? "—" : (x.salida ? "−" : "") + money(x.monto)}</td>
            </tr>`).join("")}
        </tbody>
      </table>` : `<p class="empty">Todavía no hay movimientos ni cobros para este cliente.</p>`;
  } else {
    box.innerHTML = `
      <h3>Tubos GN (Gasonor) en su poder</h3>
      <p class="lead">Cilindros de la empresa que están ahora en este cliente (no son de su propiedad).</p>
      ${tubosGn.length ? `<p class="mono" style="font-size:1.15rem;font-weight:700">${tubosGn.map((t) => esc(t.numero)).join(" · ")}</p>` : ""}
      ${tablaTubosCliente(tubosGn, "No tiene tubos GN en el cliente ahora.")}`;
  }

  $("#btn-asig-tubo").onclick = () => {
    abrirModal(`
      <h2>Asignar tubo existente</h2>
      <p class="lead">Buscá un número que ya esté en la base y asignalo a ${esc(c.nombre)}.</p>
      <form id="form-asig" class="grid form">
        <div class="field full"><label>Número de tubo</label><input name="numero" required placeholder="Ej. 12345" autocomplete="off"></div>
        <div class="field full"><label>Cómo se asigna</label>
          <select name="como">
            <option value="gn">Tubo GN (queda en el cliente)</option>
            <option value="propio">Envase propio del cliente (S/P)</option>
          </select>
        </div>
        <div class="field full"><button class="btn copper" type="submit">Asignar</button></div>
      </form>`);
    $("#form-asig").onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        const res = await api("/api/clientes/" + id + "/asignar-tubos", { method: "POST", body: fd });
        cerrarModal();
        toast("Asignados: " + res.cantidad);
        route();
      } catch (err) { toast(err.message, true); }
    };
  };

  const btnEdit = app().querySelector("[data-edit-cli]");
  if (btnEdit) {
    btnEdit.onclick = () => {
      abrirModal(`
        <h2>Editar cliente</h2>
        <form id="form-cli-edit" class="grid form">
          <div class="field full"><label>Nombre</label><input name="nombre" value="${esc(c.nombre)}" required></div>
          <div class="field full"><label>Dirección</label><input name="direccion" value="${esc(c.direccion || "")}" required></div>
          <div class="field full"><label>CUIT</label><input name="cuit" value="${esc(c.cuit || "")}" required></div>
          <div class="field"><label>Teléfono</label><input name="telefono" value="${esc(c.telefono || "")}"></div>
          <div class="field"><label>Activo</label>
            <select name="activo"><option value="1" ${c.activo ? "selected" : ""}>Sí</option><option value="0" ${c.activo ? "" : "selected"}>No</option></select>
          </div>
          <div class="field full"><button class="btn" type="submit">Guardar</button></div>
        </form>`);
      $("#form-cli-edit").onsubmit = async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target));
        body.activo = body.activo === "1";
        try {
          await api("/api/clientes/" + c.id, { method: "PUT", body });
          cerrarModal(); toast("Cliente actualizado"); route();
        } catch (err) { toast(err.message, true); }
      };
    };
  }
}

async function vistaClientes(params) {
  setNav("clientes");
  const q = params.get("q") || "";
  const soloActivos = params.get("inactivos") !== "1";
  const conTubos = params.get("con_tubos") === "1";
  const qs = new URLSearchParams();
  if (!soloActivos) qs.set("todos", "1");
  if (q) qs.set("q", q);
  if (conTubos) qs.set("con_tubos", "1");
  const data = await api("/api/clientes" + (qs.toString() ? "?" + qs.toString() : ""));
  app().innerHTML = `
    <h1>Clientes</h1>
    <p class="lead">GN = cilindros de Gasonor en el cliente. Propios = envases del cliente registrados en la base.</p>
    <div class="toolbar">
      <button class="btn copper" type="button" id="btn-nuevo-cli">+ Nuevo cliente</button>
    </div>
    <div class="card">
      <form id="f-cli-q" class="toolbar">
        <div class="field" style="flex:1"><label>Buscar</label><input name="q" value="${esc(q)}" placeholder="Nombre, CUIT o dirección"></div>
        <div class="field"><label>Filtro</label>
          <select name="con_tubos">
            <option value="" ${conTubos ? "" : "selected"}>Todos</option>
            <option value="1" ${conTubos ? "selected" : ""}>Con tubos</option>
          </select>
        </div>
        <div class="field"><label>Estado</label>
          <select name="inactivos">
            <option value="" ${soloActivos ? "selected" : ""}>Solo activos</option>
            <option value="1" ${soloActivos ? "" : "selected"}>Incluir inactivos</option>
          </select>
        </div>
        <button class="btn" type="submit">Filtrar</button>
      </form>
      <table>
        <thead><tr><th>Nombre</th><th>Dirección / CUIT</th><th>Tubos GN</th><th>Envases propios</th><th></th></tr></thead>
        <tbody>
          ${data.clientes.map((c) => `
            <tr class="${c.activo ? "" : "muted"}">
              <td><a href="#/clientes/${c.id}"><b>${esc(c.nombre)}</b></a></td>
              <td>${esc(c.direccion || "—")}${c.cuit ? `<br><small>CUIT ${esc(c.cuit)}</small>` : ""}</td>
              <td class="mono">${c.tubos_gn ?? 0}</td>
              <td class="mono">${c.tubos_registrados_propios ?? 0}</td>
              <td class="actions">
                <a class="btn ghost" href="#/clientes/${c.id}">Abrir</a>
                ${c.activo ? `<button class="btn danger ghost" type="button" data-del-cli="${c.id}">Baja</button>` : ""}
              </td>
            </tr>`).join("") || `<tr><td colspan="5" class="empty">No hay clientes.</td></tr>`}
        </tbody>
      </table>
    </div>`;
  $("#f-cli-q").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const parts = [];
    const qq = fd.get("q") || "";
    if (qq) parts.push("q=" + encodeURIComponent(qq));
    if (fd.get("con_tubos") === "1") parts.push("con_tubos=1");
    if (fd.get("inactivos") === "1") parts.push("inactivos=1");
    location.hash = "#/clientes" + (parts.length ? "?" + parts.join("&") : "");
  };
  $("#btn-nuevo-cli").onclick = () => {
    abrirModal(`
      <h2>Nuevo cliente</h2>
      <form id="form-cli-nuevo" class="grid form">
        <div class="field full"><label>Nombre</label><input name="nombre" required autocomplete="organization"></div>
        <div class="field full"><label>Dirección</label><input name="direccion" required autocomplete="street-address"></div>
        <div class="field full"><label>CUIT</label><input name="cuit" required inputmode="numeric" autocomplete="off"></div>
        <div class="field full"><button class="btn copper" type="submit">Crear cliente</button></div>
      </form>`);
    $("#form-cli-nuevo").onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api("/api/clientes", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
        cerrarModal();
        toast("Cliente creado");
        await cargarCatalogos();
        location.hash = "#/clientes/" + r.cliente.id;
      } catch (err) { toast(err.message, true); }
    };
  };
  app().querySelectorAll("[data-del-cli]").forEach((btn) => {
    btn.onclick = async () => {
      const c = data.clientes.find((x) => String(x.id) === btn.dataset.delCli);
      if (!confirm(`¿Dar de baja a ${c?.nombre || "este cliente"}?\nDejará de aparecer en la lista (sirve para borrar duplicados).`)) return;
      try {
        const r = await api("/api/clientes/" + btn.dataset.delCli, { method: "DELETE" });
        toast(r.aviso || "Cliente dado de baja");
        await cargarCatalogos();
        route();
      } catch (err) { toast(err.message, true); }
    };
  });
}

async function vistaEnvios(tipo) {
  setNav("envios");
  const esPlanta = tipo === "planta";
  app().innerHTML = `
    <h1>${esPlanta ? "Planta" : "Cliente"}</h1>
    <p class="lead">Elegí la operación.</p>
    <div class="grid form envios-hub">
      <a class="card envio-pick despacho" href="#/${esPlanta ? "planta" : "cliente"}/despacho">
        <strong>Despacho</strong>
        <p class="lead">${esPlanta ? "Enviar tubos a planta de carga" : "Salida de tubos cargados a un cliente"}</p>
      </a>
      <a class="card envio-pick recepcion" href="#/${esPlanta ? "planta" : "cliente"}/recepcion">
        <strong>Recepción</strong>
        <p class="lead">${esPlanta ? "Retorno de tubos cargados desde planta" : "Ingreso de tubos que vuelven del cliente"}</p>
      </a>
    </div>
    ${rolActual() === "admin" ? `
      <p class="lead" style="margin-top:18px">También podés operar por lotes en la PC:</p>
      <p>
        <a class="btn secondary" href="#/operaciones?tab=${esPlanta ? "planta" : "cliente"}">Ciclo — ${esPlanta ? "despacho a planta" : "despacho a cliente"}</a>
        <a class="btn ghost" href="#/operaciones?tab=${esPlanta ? "retorno" : "vacio"}">Ciclo — ${esPlanta ? "recepción de planta" : "recepción de cliente"}</a>
      </p>` : ""}`;
}

async function vistaOperaciones(params) {
  setNav("operaciones");
  const tab = params.get("tab") || "cargar";
  const q = params.get("q") || "";
  app().innerHTML = `
    <h1>Ciclo de despacho</h1>
    <p class="lead">Carga, despacho y recepción de planta y cliente (operación por lotes en PC).</p>
    <div class="tabs">
      <button data-tab="cargar" class="${tab === "cargar" ? "active" : ""}">Cargar vacíos</button>
      <button data-tab="cliente" class="${tab === "cliente" ? "active" : ""}">Despacho a cliente</button>
      <button data-tab="vacio" class="${tab === "vacio" ? "active" : ""}">Recepción de cliente</button>
      <button data-tab="planta" class="${tab === "planta" ? "active" : ""}">Despacho a planta</button>
      <button data-tab="retorno" class="${tab === "retorno" ? "active" : ""}">Recepción de planta</button>
    </div>
    <div id="op-box" class="card">Cargando…</div>`;
  app().querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => { location.hash = "#/operaciones?tab=" + b.dataset.tab; };
  });
  const box = $("#op-box");
  const qop = encodeURIComponent(q);
  if (tab === "cargar") {
    const data = await api("/api/tubos?estado=vacio" + (q ? "&q=" + qop : ""));
    box.innerHTML = `
      <h3>Vacíos en empresa — marcar como cargados</h3>
      <form id="op-form">
        <div class="toolbar">
          <div class="field"><label>Fecha de carga</label><input name="fecha" type="date" value="${hoyInput()}"></div>
          <div class="field"><label>Lote</label><input name="lote" placeholder="C012-943"></div>
          <div class="field"><label>Vto.</label><input name="fecha_vto" type="date"></div>
          <div class="field"><label>Buscar tubo</label><input id="op-q" value="${esc(q)}" placeholder="Número"></div>
          <button class="btn copper" type="submit">Registrar carga</button>
        </div>
        ${tablaTubos(data.tubos, { check: true })}
      </form>`;
    $("#op-q").onchange = () => { location.hash = "#/operaciones?tab=cargar&q=" + encodeURIComponent($("#op-q").value.trim()); };
    $("#op-form").onsubmit = (e) => enviarOp(e, "/api/operaciones/cargar-empresa");
  } else if (tab === "planta") {
    const [data, provs] = await Promise.all([
      api("/api/tubos?estado=vacio,cargado" + (q ? "&q=" + qop : "")),
      api("/api/proveedores"),
    ]);
    const lista = data.tubos || [];
    box.innerHTML = `
      <h3>Despacho a planta</h3>
      <p class="lead">Ingreso manual sencillo: agregá el número (o cód. proveedor) de cada tubo cargado o vacío que mandás a planta.</p>
      <form id="op-form">
        <div class="toolbar">
          <div class="field"><label>Planta destino</label>
            <select name="proveedor_id" id="pl-prov" required>
              <option value="">Elegir planta…</option>
              ${optsProveedores(provs.proveedores)}
            </select>
          </div>
          <div class="field"><label>Fecha</label><input name="fecha" type="date" value="${hoyInput()}"></div>
          <div class="field"><label>Nº remito</label><input name="remito" placeholder="Como en el papel" autocomplete="off"></div>
        </div>
        <div class="toolbar">
          <div class="field" style="flex:1"><label>Tubo a enviar</label>
            <input id="pl-manual" placeholder="Número o código de proveedor" autocomplete="off">
          </div>
          <button class="btn" type="button" id="pl-add">Agregar</button>
        </div>
        <div class="field"><label>Observaciones (opcional)</label>
          <input name="observaciones" placeholder="Chofer, notas…">
        </div>
        <div id="pl-manual-lista" class="table-wrap" style="margin:12px 0">
          <p class="empty" id="pl-empty">Todavía no agregaste tubos.</p>
          <table id="pl-tabla" hidden>
            <thead><tr><th></th><th>Número</th><th>Cód. proveedor</th><th>Estado</th><th>Artículo</th><th></th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <button class="btn copper" type="submit">Registrar envío a planta</button>
        <details style="margin-top:16px">
          <summary>Elegir de la lista (en empresa)</summary>
          <div class="toolbar" style="margin-top:8px">
            <div class="field"><label>Filtrar</label><input id="op-q" value="${esc(q)}" placeholder="Número / lote"></div>
          </div>
          ${tablaTubos(lista, { check: true })}
        </details>
      </form>`;
    const tbody = box.querySelector("#pl-tabla tbody");
    const tabla = $("#pl-tabla");
    const empty = $("#pl-empty");
    const syncVis = () => {
      const n = tbody.querySelectorAll("tr").length;
      tabla.hidden = !n;
      empty.hidden = !!n;
    };
    const agregarFila = (t) => {
      if (box.querySelector(`input[name="tubo"][value="${t.id}"]`)) {
        const existing = box.querySelector(`input[name="tubo"][value="${t.id}"]`);
        existing.checked = true;
        return toast("Ya estaba en la lista");
      }
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" name="tubo" value="${t.id}" checked></td>
        <td class="mono">${esc(t.numero)}</td>
        <td class="mono">${esc(t.codigo_proveedor_mostrar || t.codigo_proveedor || "—")}</td>
        <td>${badge(t.estado)}</td>
        <td>${esc(t.articulo_codigo)} · ${esc(t.articulo_descripcion)}</td>
        <td><button type="button" class="btn ghost pl-rm">Quitar</button></td>`;
      tr.querySelector(".pl-rm").onclick = () => { tr.remove(); syncVis(); };
      tbody.appendChild(tr);
      syncVis();
    };
    const addManual = async () => {
      const codigo = ($("#pl-manual").value || "").trim();
      if (!codigo) return;
      const pid = $("#pl-prov").value;
      try {
        const r = await api("/api/planta/identificar", {
          method: "POST",
          body: { codigo, modo: "despacho", proveedor_id: pid ? Number(pid) : null },
        });
        if ((r.resultado === "ok" || r.resultado === "advertencia") && r.tubo?.id) {
          if (debeConfirmarDespacho(r) && !(await confirmarAdvertenciaDespacho(r))) return;
          agregarFila(r.tubo);
          $("#pl-manual").value = "";
          $("#pl-manual").focus();
          if (debeConfirmarDespacho(r)) toast("Sumado con advertencia");
          return;
        }
        if (r.tubo?.id && ["estado_invalido", "ya_en_planta"].includes(r.resultado)) {
          if (!(await confirmarAdvertenciaDespacho({ ...r, mensaje: (r.mensaje || "Estado no habitual") + " ¿Proseguir igual?" }))) return;
          agregarFila(r.tubo);
          $("#pl-manual").value = "";
          toast("Sumado con advertencia");
          return;
        }
        const msgs = {
          ya_en_planta: "Ese tubo ya está en planta",
          estado_invalido: "Solo vacíos o cargados en empresa (estado: " + (r.tubo?.estado || "?") + ")",
          nuevo: "Tubo no registrado — cargalo primero en el catálogo",
        };
        toast(msgs[r.resultado] || r.mensaje || "No se pudo agregar", true);
      } catch (err) { toast(err.message, true); }
    };
    $("#pl-add").onclick = () => addManual();
    $("#pl-manual").onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); addManual(); }
    };
    $("#op-q").onchange = () => {
      location.hash = "#/operaciones?tab=planta&q=" + encodeURIComponent($("#op-q").value.trim());
    };
    $("#op-form").onsubmit = (e) => enviarOp(e, "/api/operaciones/enviar-planta", { pideProveedor: true });
  } else if (tab === "retorno") {
    const data = await api("/api/tubos?estado=en_planta" + (q ? "&q=" + qop : ""));
    box.innerHTML = `
      <h3>Tubos en planta — registrar retorno cargado</h3>
      <p class="lead">Al volver quedan cargados para cliente. En cada fila completá el <b>nº de trazabilidad</b> (a mano), el <b>lote</b> y el <b>vto.</b> si corresponde.</p>
      <form id="op-form">
        <div class="toolbar">
          <div class="field"><label>Fecha de retorno</label><input name="fecha" type="date" value="${hoyInput()}"></div>
          <div class="field"><label>Lote (aplicar a marcados)</label><input id="lote-comun" placeholder="C012-943" autocomplete="off"></div>
          <div class="field"><label>Vto. (aplicar a marcados)</label><input id="vto-comun" type="date"></div>
          <div class="field"><label>Buscar</label><input id="op-q" value="${esc(q)}" placeholder="Número / cód. proveedor"></div>
          <button class="btn secondary" type="button" id="aplicar-lote">Aplicar lote/vto</button>
          <button class="btn copper" type="submit">Marcar como cargados</button>
        </div>
        ${data.tubos.length ? `
        <div class="table-wrap"><table class="tabla-cerrar-recep">
          <thead><tr>
            <th></th>
            <th>Cód. proveedor</th>
            <th>Nº trazabilidad</th>
            <th>Lote nuevo</th>
            <th>Vto. nuevo</th>
            <th>Artículo</th>
            <th>Planta</th>
            <th>Fecha envío</th>
            <th>Nº actual en sistema</th>
          </tr></thead>
          <tbody>
            ${data.tubos.map((t) => {
              const codp = t.codigo_proveedor_mostrar || t.codigo_proveedor || t.articulo_codigo_proveedor || "";
              const numActual = t.numero || "";
              const mismoQueCod = numActual && codp && String(numActual) === String(codp);
              return `
              <tr>
                <td><input type="checkbox" name="tubo" value="${t.id}" checked></td>
                <td class="mono">${esc(codp || "—")}</td>
                <td>
                  <input class="inp-traza" name="num_${t.id}" data-num="${t.id}" required
                    value="" placeholder="Escribí el nº de trazabilidad" autocomplete="off"
                    title="Número de trazabilidad obligatorio">
                </td>
                <td>
                  <input class="inp-lote" name="lote_${t.id}" data-lote="${t.id}" required
                    value="${esc(t.lote || "")}" placeholder="Lote" autocomplete="off">
                </td>
                <td><input data-vto="${t.id}" type="date" value="${esc(t.fecha_vto || "")}"></td>
                <td>${esc(t.articulo_codigo)} · ${esc(t.articulo_descripcion)}</td>
                <td>${esc(t.proveedor_nombre || "—")}</td>
                <td class="mono">${fmtFecha(t.fecha_envio_planta) || "—"}</td>
                <td class="mono muted">${esc(numActual || "—")}${mismoQueCod ? " <small>(igual al cód. proveedor)</small>" : ""}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table></div>` : `<p class="empty">No hay tubos en planta.</p>`}
      </form>`;
    $("#op-q").onchange = () => {
      location.hash = "#/operaciones?tab=retorno&q=" + encodeURIComponent($("#op-q").value.trim());
    };
    const aplicar = $("#aplicar-lote");
    if (aplicar) aplicar.onclick = () => {
      const lote = $("#lote-comun").value;
      const vto = $("#vto-comun").value;
      selectedIds(box).forEach((id) => {
        const l = box.querySelector(`[data-lote="${id}"]`);
        const v = box.querySelector(`[data-vto="${id}"]`);
        if (lote && l) l.value = lote;
        if (vto && v) v.value = vto;
      });
    };
    $("#op-form").onsubmit = async (e) => {
      e.preventDefault();
      const ids = selectedIds(box);
      if (!ids.length) return toast("Marque al menos un tubo", true);
      const items = [];
      for (const id of ids) {
        const lote = (box.querySelector(`[data-lote="${id}"]`)?.value || "").trim();
        const numero = (box.querySelector(`[data-num="${id}"]`)?.value || "").trim();
        if (!numero) return toast("Completá el número de trazabilidad de cada tubo marcado", true);
        if (!lote) return toast("Completá el lote de cada tubo marcado", true);
        items.push({
          id,
          lote,
          numero,
          fecha_vto: box.querySelector(`[data-vto="${id}"]`)?.value || "",
        });
      }
      try {
        const r = await api("/api/operaciones/recibir-planta", {
          method: "POST",
          body: { fecha: e.target.fecha.value, items, observaciones: "Retorno de planta (ciclo)" },
        });
        toast(`${r.cantidad} tubo(s) cargados con trazabilidad`);
        route();
      } catch (err) { toast(err.message, true); }
    };
  } else if (tab === "cliente") {
    const data = await api("/api/tubos?estado=cargado" + (q ? "&q=" + qop : ""));
    box.innerHTML = `
      <h3>Despacho a cliente</h3>
      <p class="lead">Buscá el cliente en tiempo real (nombre, CUIT o dirección) y marcá los tubos cargados.</p>
      <p><a class="btn secondary" href="#/cliente/despacho">Ir al escáner / flujo móvil</a></p>
      <form id="op-form">
        <div class="field"><label>Cliente destino</label></div>
        ${htmlBusquedaCliente("bc")}
        <div class="toolbar" style="margin-top:10px">
          <div class="field"><label>Fecha de expedición</label><input name="fecha" type="date" value="${hoyInput()}"></div>
          <div class="field"><label>Nº remito</label><input name="remito" placeholder="Opcional" autocomplete="off"></div>
          <div class="field" style="flex:1"><label>Observaciones</label><input name="observaciones"></div>
          <div class="field"><label>Filtrar tubos</label><input id="op-q" value="${esc(q)}" placeholder="Número"></div>
          <button class="btn copper" type="submit">Registrar salida a cliente</button>
        </div>
        ${tablaTubos(data.tubos, { check: true })}
      </form>`;
    bindBusquedaCliente("bc");
    $("#op-q").onchange = () => {
      location.hash = "#/operaciones?tab=cliente&q=" + encodeURIComponent($("#op-q").value.trim());
    };
    $("#op-form").onsubmit = (e) => enviarOp(e, "/api/operaciones/enviar-cliente", { pideCliente: true });
  } else {
    box.innerHTML = `
      <h3>Recepción de cliente</h3>
      <p class="lead">Buscá por tubo: el sistema detecta cuál es y de qué cliente. El filtro por cliente es opcional.</p>
      <p><a class="btn secondary" href="#/cliente/recepcion">Ir al escáner / flujo móvil</a></p>
      <form id="op-form">
        <div class="toolbar">
          <div class="field" style="flex:1"><label>Buscar por tubo</label>
            <input id="rec-tubo" placeholder="Número o código de proveedor" autocomplete="off">
          </div>
          <button class="btn copper" type="button" id="rec-detect">Detectar</button>
        </div>
        <details style="margin:10px 0">
          <summary>Filtrar por cliente (opcional)</summary>
          <div style="margin-top:8px">${htmlBusquedaCliente("rc")}</div>
          <button class="btn secondary" type="button" id="rec-por-cli" style="margin-top:8px">Listar tubos de ese cliente</button>
        </details>
        <div class="toolbar">
          <div class="field"><label>Fecha de retorno</label><input name="fecha" type="date" value="${hoyInput()}"></div>
          <div class="field" style="flex:1"><label>Observaciones</label><input name="observaciones"></div>
          <button class="btn copper" type="submit">Ingresar como vacíos</button>
        </div>
        <div id="rec-lista"><p class="empty">Detectá un tubo o listá por cliente.</p></div>
      </form>`;
    bindBusquedaCliente("rc", { required: false });
    const pintarRec = (tubos) => {
      const el = $("#rec-lista");
      if (!tubos.length) {
        el.innerHTML = `<p class="empty">No hay tubos para mostrar.</p>`;
        return;
      }
      el.innerHTML = `
        <div class="table-wrap"><table>
          <thead><tr><th></th><th>Número</th><th>Cód. proveedor</th><th>Cliente</th><th>Artículo</th><th>Lote</th></tr></thead>
          <tbody>
            ${tubos.map((t) => `
              <tr>
                <td><input type="checkbox" name="tubo" value="${t.id}" checked></td>
                <td class="mono">${esc(t.numero)}</td>
                <td class="mono">${esc(t.codigo_proveedor_mostrar || t.codigo_proveedor || "—")}</td>
                <td>${esc(t.cliente_nombre || "—")}</td>
                <td>${esc(t.articulo_codigo)} · ${esc(t.articulo_descripcion)}</td>
                <td class="mono">${esc(t.lote || "—")}</td>
              </tr>`).join("")}
          </tbody>
        </table></div>`;
    };
    const mergeTubo = (t) => {
      if (box.querySelector(`input[name="tubo"][value="${t.id}"]`)) {
        box.querySelector(`input[name="tubo"][value="${t.id}"]`).checked = true;
        return toast("Ya estaba en la lista");
      }
      const existentes = [];
      box.querySelectorAll("#rec-lista tbody tr").forEach((tr) => {
        const id = Number(tr.querySelector("input")?.value);
        if (!id) return;
        existentes.push({
          id,
          numero: tr.children[1]?.textContent || "",
          codigo_proveedor_mostrar: tr.children[2]?.textContent || "",
          cliente_nombre: tr.children[3]?.textContent || "",
          articulo_codigo: (tr.children[4]?.textContent || "").split(" · ")[0] || "",
          articulo_descripcion: (tr.children[4]?.textContent || "").split(" · ").slice(1).join(" · ") || "",
          lote: tr.children[5]?.textContent || "",
        });
      });
      existentes.push(t);
      pintarRec(existentes);
    };
    const detectar = async () => {
      const codigo = ($("#rec-tubo").value || "").trim();
      if (!codigo) return toast("Ingresá un número de tubo", true);
      const cid = $("#rc-id")?.value;
      try {
        const r = await api("/api/cliente/identificar", {
          method: "POST",
          body: { codigo, modo: "recepcion", cliente_id: cid ? Number(cid) : null },
        });
        if (r.resultado === "ok" && r.tubo) {
          mergeTubo(r.tubo);
          $("#rec-tubo").value = "";
          $("#rec-tubo").focus();
          toast(`${r.tubo.numero} · ${r.tubo.cliente_nombre || "cliente"}`);
          return;
        }
        const msgs = {
          no_encontrado: "No está en el sistema",
          no_en_cliente: "Ese tubo no figura en cliente (estado: " + (r.tubo?.estado || "?") + ")",
          otro_cliente: "Está en " + (r.tubo?.cliente_nombre || "otro cliente"),
        };
        toast(msgs[r.resultado] || "No se pudo detectar", true);
      } catch (err) { toast(err.message, true); }
    };
    $("#rec-detect").onclick = () => detectar();
    $("#rec-tubo").onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); detectar(); }
    };
    $("#rec-por-cli").onclick = async () => {
      const cid = $("#rc-id")?.value;
      if (!cid) return toast("Elegí un cliente en el filtro opcional", true);
      try {
        const data = await api("/api/cliente/deuda?cliente_id=" + cid);
        pintarRec(data.tubos || []);
      } catch (err) { toast(err.message, true); }
    };
    $("#op-form").onsubmit = (e) => enviarOp(e, "/api/operaciones/recibir-cliente");
  }
}

async function enviarOp(e, url, opts = {}) {
  e.preventDefault();
  const pideCliente = opts === true || opts.pideCliente;
  const pideProveedor = opts.pideProveedor;
  const ids = selectedIds();
  if (!ids.length) return toast("Marque al menos un tubo", true);
  const fd = new FormData(e.target);
  const body = { tubo_ids: ids, fecha: fd.get("fecha"), observaciones: fd.get("observaciones") || "" };
  if (fd.get("remito")) body.remito = fd.get("remito");
  if (pideCliente) {
    const cid = fd.get("cliente_id") || $("#bc-id")?.value;
    if (!cid) return toast("Elegí el cliente destino", true);
    body.cliente_id = cid;
  }
  if (pideProveedor) {
    const pid = fd.get("proveedor_id");
    if (!pid) return toast("Elegí la planta destino", true);
    body.proveedor_id = pid;
  }
  if (fd.get("lote")) body.lote = fd.get("lote");
  if (fd.get("fecha_vto")) body.fecha_vto = fd.get("fecha_vto");
  try {
    const r = await api(url, { method: "POST", body });
    toast(`${r.cantidad} tubo(s) actualizados`);
    route();
  } catch (err) { toast(err.message, true); }
}

async function vistaInforme(params) {
  setNav("informe");
  const desde = params.get("desde") || primerDiaMes();
  const hasta = params.get("hasta") || hoyInput();
  const tipo = params.get("tipo") || "TODOS";
  const data = await api(`/api/informe/expedicion?desde=${desde}&hasta=${hasta}&tipo=${tipo}`);
  const cfg = data.config;
  const generado = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${p(generado.getDate())}/${p(generado.getMonth() + 1)}/${String(generado.getFullYear()).slice(2)} ${p(generado.getHours())}:${p(generado.getMinutes())}:${p(generado.getSeconds())}`;
  app().innerHTML = `
    <h1 class="no-print">Informe de expedición</h1>
    <p class="lead no-print">Solo movimientos de planta y cliente (desde el historial): Salida, Entrada, SalidaCL, EntradaCL.</p>
    <form class="toolbar no-print" id="f-inf">
      <div class="field"><label>Desde</label><input name="desde" type="date" value="${desde}"></div>
      <div class="field"><label>Hasta</label><input name="hasta" type="date" value="${hasta}"></div>
      <div class="field"><label>Movimiento</label>
        <select name="tipo">
          <option value="TODOS" ${tipo === "TODOS" ? "selected" : ""}>Todos (expedición)</option>
          <option value="PLANSALI" ${tipo === "PLANSALI" ? "selected" : ""}>Salida (a planta)</option>
          <option value="PLANENTR" ${tipo === "PLANENTR" ? "selected" : ""}>Entrada (de planta)</option>
          <option value="TRANSALI" ${tipo === "TRANSALI" ? "selected" : ""}>SalidaCL (a cliente)</option>
          <option value="TRANSENT" ${tipo === "TRANSENT" ? "selected" : ""}>EntradaCL (de cliente)</option>
        </select>
      </div>
      <button class="btn" type="submit">Generar</button>
      <button class="btn secondary" type="button" onclick="window.print()">Imprimir</button>
    </form>
    <div class="report card" id="informe">
      <img class="report-logo" src="/static/img/logo.png?v=4" alt="Gasonor SRL" />
      <div class="report-head">
        <div>[ ${esc(cfg.codigo_informe || "InfTubo5")} * ]</div>
        <div>${stamp} &nbsp; Pág. 1</div>
      </div>
      <h2>${esc(cfg.empresa || "Gasonor SRL")}</h2>
      <div><b>${esc(cfg.titulo_informe || "Informe de expedición de cilindros")}</b></div>
      <div>Desde: ${fmtFecha(data.desde)} Hasta: ${fmtFecha(data.hasta)}</div>
      <table style="margin-top:12px">
        <thead>
          <tr>
            <th>Fecha</th><th>Hora</th><th>Movim</th><th>Cód. art.</th><th>Cód. prov.</th>
            <th>Nº trazabilidad</th><th>Nombre</th><th>Lote</th><th>Fecha Vto.</th><th>Usuario</th>
          </tr>
        </thead>
        <tbody>
          ${data.filas.length ? data.filas.map((f) => `
            <tr>
              <td>${fmtFecha(f.fecha)}</td>
              <td class="mono">${esc(f.hora || "")}</td>
              <td>${esc(f.movimiento || INFORME_MOV[f.tipo] || f.tipo)}</td>
              <td class="mono">${esc(f.articulo_codigo || "")}</td>
              <td class="mono">${esc(f.codigo_proveedor || "")}</td>
              <td class="mono">${esc(f.numero || "")}</td>
              <td>${esc(f.nombre || f.cliente_nombre || "")}</td>
              <td class="mono">${esc(f.lote || "")}</td>
              <td>${fmtFecha(f.fecha_vto)}</td>
              <td>${esc(f.usuario_nombre || "")}</td>
            </tr>`).join("") : `<tr><td colspan="10">Sin movimientos de expedición en el período.</td></tr>`}
        </tbody>
      </table>
    </div>`;
  $("#f-inf").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    location.hash = `#/informe?desde=${fd.get("desde")}&hasta=${fd.get("hasta")}&tipo=${fd.get("tipo")}`;
  };
}

async function vistaMovimientos(params) {
  setNav("movimientos");
  const qs = new URLSearchParams();
  if (params.get("desde")) qs.set("desde", params.get("desde"));
  if (params.get("hasta")) qs.set("hasta", params.get("hasta"));
  if (params.get("q")) qs.set("q", params.get("q"));
  if (params.get("cliente_id")) qs.set("cliente_id", params.get("cliente_id"));
  const data = await api("/api/movimientos?" + qs.toString());
  app().innerHTML = `
    <h1>Historial de movimientos</h1>
    ${params.get("cliente_id") ? `<p class="lead">Filtrado por cliente #${esc(params.get("cliente_id"))} · <a href="#/clientes/${esc(params.get("cliente_id"))}">Ver ficha</a></p>` : ""}
    <form class="toolbar" id="f-mov">
      <div class="field"><label>Desde</label><input name="desde" type="date" value="${esc(params.get("desde") || "")}"></div>
      <div class="field"><label>Hasta</label><input name="hasta" type="date" value="${esc(params.get("hasta") || "")}"></div>
      <div class="field"><label>Buscar</label><input name="q" value="${esc(params.get("q") || "")}" placeholder="Número, lote, cliente"></div>
      <button class="btn" type="submit">Filtrar</button>
    </form>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Movim</th><th>Código</th><th>Número</th><th>Cliente / planta</th><th>Lote</th><th>Detalle</th><th>Usuario</th><th>Vto.</th></tr></thead>
        <tbody>
          ${data.movimientos.map((m) => `
            <tr>
              <td class="mono">${fmtFecha(m.fecha)}</td>
              <td>${esc(TIPOS[m.tipo] || m.tipo)}</td>
              <td class="mono">${esc(m.articulo_codigo || "")}</td>
              <td class="mono"><a href="#/tubo/${m.tubo_id}">${esc(m.numero)}</a></td>
              <td>${esc(m.cliente_nombre || (["PLANSALI", "PLANENTR"].includes(m.tipo) ? (m.observaciones || "").split(" · ").slice(0, 2).join(" · ") : "") || "—")}</td>
              <td class="mono">${esc(m.lote || "—")}</td>
              <td>${esc(m.observaciones || "—")}</td>
              <td>${esc(m.usuario_nombre || "—")}</td>
              <td class="mono">${fmtFecha(m.fecha_vto)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  $("#f-mov").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const u = new URLSearchParams();
    for (const [k, v] of fd.entries()) if (v) u.set(k, v);
    if (params.get("cliente_id")) u.set("cliente_id", params.get("cliente_id"));
    location.hash = "#/movimientos" + (u.toString() ? "?" + u.toString() : "");
  };
}

async function vistaConfig() {
  setNav("config");
  const cfg = (await api("/api/config")).config;
  app().innerHTML = `
    <h1>Datos de la empresa</h1>
    <div class="card" style="max-width:640px">
      <form id="form-cfg" class="grid form">
        <div class="field full"><label>Razón social</label><input name="empresa" value="${esc(cfg.empresa || "")}"></div>
        <div class="field"><label>Código de informe</label><input name="codigo_informe" value="${esc(cfg.codigo_informe || "")}"></div>
        <div class="field"><label>Título del listado</label><input name="titulo_informe" value="${esc(cfg.titulo_informe || "")}"></div>
        <div class="field full"><button class="btn" type="submit">Guardar</button></div>
      </form>
      <p class="lead">Respaldo: descargue una copia de la base o un archivo JSON.</p>
      <div class="toolbar">
        <a class="btn secondary" href="/api/respaldo.db">Descargar base de datos</a>
        <a class="btn ghost" href="/api/exportar.json">Exportar JSON</a>
      </div>
    </div>`;
  $("#form-cfg").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/config", { method: "PUT", body: Object.fromEntries(new FormData(e.target)) });
      await cargarCatalogos();
      toast("Datos de empresa guardados");
    } catch (err) { toast(err.message, true); }
  };
}

function abrirModal(html) {
  cerrarModal();
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `<div class="modal card">${html}<div class="toolbar"><button class="btn ghost" type="button" id="cerrar-modal">Cerrar</button></div></div>`;
  back.addEventListener("click", (e) => { if (e.target === back) cerrarModal(); });
  document.body.appendChild(back);
  $("#cerrar-modal").onclick = cerrarModal;
}

function cerrarModal() {
  document.querySelector(".modal-back")?.remove();
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "") || "inicio";
  const [path, query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
}

function horaInput() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function vistaProveedores() {
  setNav("proveedores");
  const data = await api("/api/proveedores");
  const rows = data.proveedores || [];
  app().innerHTML = `
    <h1>Proveedores / plantas</h1>
    <p class="lead">Cargá plantas de carga. Tocá una para ver los tubos que tiene y el historial de envíos.</p>
    <div class="card">
      <h3>Nuevo proveedor</h3>
      <form id="form-prov" class="grid form">
        <div class="field"><label>Nombre</label><input name="nombre" required autocomplete="organization"></div>
        <div class="field"><label>CUIT (opcional)</label><input name="cuit" inputmode="numeric" autocomplete="off" placeholder="30-…"></div>
        <div class="field full"><label>Dirección (opcional)</label><input name="direccion" autocomplete="street-address"></div>
        <div class="field"><label>Teléfono (opcional)</label><input name="telefono" inputmode="tel" autocomplete="tel"></div>
        <div class="field full"><button class="btn copper" type="submit">Agregar proveedor</button></div>
      </form>
    </div>
    <div class="card" style="margin-top:14px">
      ${rows.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>CUIT</th><th>Dirección</th><th>Teléfono</th><th>En posesión</th><th></th></tr></thead>
        <tbody>
          ${rows.map((p) => `
            <tr>
              <td><a href="#/proveedores/${p.id}"><strong>${esc(p.nombre)}</strong></a></td>
              <td class="mono">${esc(p.cuit || "—")}</td>
              <td>${esc(p.direccion || "—")}</td>
              <td>${esc(p.telefono || "—")}</td>
              <td class="mono">${Number(p.tubos_en_planta || 0)}</td>
              <td><a class="btn" href="#/proveedores/${p.id}">Abrir</a></td>
            </tr>`).join("")}
        </tbody>
      </table></div>` : `<p class="empty">Todavía no hay proveedores cargados.</p>`}
    </div>`;
  $("#form-prov").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api("/api/proveedores", { method: "POST", body: Object.fromEntries(new FormData(e.target)) });
      toast("Proveedor cargado");
      location.hash = "#/proveedores/" + r.proveedor.id;
    } catch (err) { toast(err.message, true); }
  };
}

async function vistaProveedorFicha(id, params) {
  setNav("proveedores");
  const tab = params.get("tab") || "tubos";
  const data = await api("/api/proveedores/" + id);
  const p = data.proveedor;
  const r = data.resumen || {};
  const tubos = data.tubos || [];
  const docs = data.documentos || [];
  const movs = data.movimientos || [];
  app().innerHTML = `
    <p><a href="#/proveedores">← Proveedores</a></p>
    <h1>${esc(p.nombre)}</h1>
    <p class="lead">
      ${esc(p.direccion || "Sin dirección")}
      ${p.cuit ? " · CUIT " + esc(p.cuit) : ""}
      ${p.telefono ? " · " + esc(p.telefono) : ""}
      ${p.activo ? "" : " · <em>Inactivo</em>"}
    </p>
    <div class="grid stats">
      <div class="card stat en_planta"><div class="n">${r.en_posesion ?? tubos.length}</div><small>Tubos en posesión</small></div>
      <div class="card stat vacio"><div class="n">${r.tubos_enviados || 0}</div><small>Tubos enviados (hist.)</small></div>
      <div class="card stat cargado"><div class="n">${r.tubos_recibidos || 0}</div><small>Tubos recibidos (hist.)</small></div>
      <div class="card stat total"><div class="n">${(r.documentos_despacho || 0) + (r.documentos_recepcion || 0)}</div><small>Documentos planta</small></div>
    </div>
    <div class="toolbar">
      <button class="btn copper" type="button" id="btn-edit-prov">Editar datos</button>
      <a class="btn secondary" href="#/planta/despacho/${p.id}">Despacho a esta planta</a>
      <a class="btn secondary" href="#/planta/recepcion/${p.id}">Recepción de esta planta</a>
    </div>
    <div class="tabs">
      <button data-tab="tubos" class="${tab === "tubos" ? "active" : ""}">En posesión (${tubos.length})</button>
      <button data-tab="docs" class="${tab === "docs" ? "active" : ""}">Documentos (${docs.length})</button>
      <button data-tab="movs" class="${tab === "movs" ? "active" : ""}">Movimientos</button>
    </div>
    <div id="prov-tab" class="card"></div>`;

  app().querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => { location.hash = "#/proveedores/" + id + "?tab=" + b.dataset.tab; };
  });

  const box = $("#prov-tab");
  if (tab === "docs") {
    box.innerHTML = docs.length ? `
      <h3>Documentos de planta</h3>
      <table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Remito</th><th>Cant.</th><th>Usuario</th><th>Estado</th></tr></thead>
        <tbody>
          ${docs.map((d) => `
            <tr>
              <td class="mono">${fmtFecha(d.fecha)}${d.hora ? " " + esc(d.hora) : ""}</td>
              <td>${d.tipo === "despacho" ? "Despacho" : "Recepción"}</td>
              <td class="mono">${esc(d.remito || "—")}</td>
              <td class="mono">${Number(d.cantidad || 0)}</td>
              <td>${esc(d.usuario_nombre || "—")}</td>
              <td>${esc(d.estado || "cerrado")}</td>
            </tr>`).join("")}
        </tbody>
      </table>` : `<p class="empty">Todavía no hay documentos con esta planta.</p>`;
  } else if (tab === "movs") {
    box.innerHTML = movs.length ? `
      <h3>Últimos movimientos (envío / retorno)</h3>
      <table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Tubo</th><th>Detalle</th></tr></thead>
        <tbody>
          ${movs.map((m) => `
            <tr>
              <td class="mono">${fmtFecha(m.fecha)}</td>
              <td>${esc(TIPOS[m.tipo] || m.tipo)}</td>
              <td class="mono">${esc(m.tubo_numero || "—")}</td>
              <td>${esc(m.observaciones || "—")}</td>
            </tr>`).join("")}
        </tbody>
      </table>` : `<p class="empty">Sin movimientos registrados para esta planta.</p>`;
  } else {
    box.innerHTML = `
      <h3>Tubos actualmente en esta planta</h3>
      <p class="lead">Cilindros con estado <b>en planta</b> asignados a ${esc(p.nombre)}.</p>
      ${tubos.length ? `
        <p class="mono" style="font-size:1.05rem;font-weight:700;margin-bottom:10px">${tubos.map((t) => esc(t.numero)).join(" · ")}</p>
        <table>
          <thead><tr><th>Número</th><th>Cód. prov.</th><th>Artículo</th><th>Propiedad</th><th>Lote</th><th>Envío</th></tr></thead>
          <tbody>
            ${tubos.map((t) => `
              <tr>
                <td class="mono"><a href="#/tubo/${t.id}">${esc(t.numero)}</a></td>
                <td class="mono">${esc(t.codigo_proveedor_mostrar || t.codigo_proveedor || "—")}</td>
                <td>${esc(t.articulo_descripcion || t.articulo_codigo || "")}</td>
                <td><span class="badge ${t.propiedad === "cliente" ? "cliente" : "empresa"}">${t.propiedad === "cliente" ? "Cliente" : "GN"}</span></td>
                <td class="mono">${esc(t.lote || "—")}</td>
                <td class="mono">${fmtFecha(t.fecha_envio_planta) || "—"}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : `<p class="empty">No tiene tubos en posesión ahora.</p>`}`;
  }

  $("#btn-edit-prov").onclick = () => {
    abrirModal(`
      <h2>Editar ${esc(p.nombre)}</h2>
      <form id="form-edit-prov" class="grid form">
        <div class="field"><label>Nombre</label><input name="nombre" required value="${esc(p.nombre || "")}"></div>
        <div class="field"><label>CUIT</label><input name="cuit" value="${esc(p.cuit || "")}" inputmode="numeric"></div>
        <div class="field full"><label>Dirección</label><input name="direccion" value="${esc(p.direccion || "")}"></div>
        <div class="field"><label>Teléfono</label><input name="telefono" value="${esc(p.telefono || "")}"></div>
        <div class="field full"><button class="btn copper" type="submit">Guardar</button></div>
      </form>`);
    $("#form-edit-prov").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api("/api/proveedores/" + id, { method: "PUT", body: Object.fromEntries(new FormData(e.target)) });
        cerrarModal();
        toast("Proveedor actualizado");
        route();
      } catch (err) { toast(err.message, true); }
    };
  };
}

async function vistaUsuarios() {
  setNav("usuarios");
  const data = await api("/api/usuarios");
  const info = data.roles_info || [];
  const sel = state._usuEdit;
  const editando = sel ? data.usuarios.find((u) => u.id === sel) : null;
  app().innerHTML = `
    <h1>Usuarios y permisos</h1>
    <p class="lead">Creá cuentas, cambiá roles y contraseñas. Cada rol define qué puede hacer en planta y en el resto del sistema.</p>
    <div class="grid two">
      ${info.map((r) => `<div class="card"><strong>${esc(r.nombre)}</strong><p class="lead">${esc(r.detalle)}</p></div>`).join("")}
    </div>
    <div class="card">
      <h3>${editando ? "Modificar usuario" : "Nuevo usuario"}</h3>
      <form id="form-usu" class="grid form">
        <div class="field"><label>Usuario</label><input name="usuario" required value="${esc(editando?.usuario || "")}" ${editando ? "readonly" : ""}></div>
        <div class="field"><label>Nombre</label><input name="nombre" required value="${esc(editando?.nombre || "")}"></div>
        <div class="field"><label>Rol / permiso</label>
          <select name="rol">
            ${(data.roles || ["admin","despacho","reparto","cobrador"]).map((id) => {
              const n = (info.find((x) => x.id === id) || {}).nombre || id;
              const cur = editando
                ? (["despacho_total", "despacho_general"].includes(editando.rol) ? "despacho" : editando.rol)
                : "despacho";
              return `<option value="${esc(id)}" ${id === cur ? "selected" : ""}>${esc(n)}</option>`;
            }).join("")}
          </select>
        </div>
        <div class="field"><label>${editando ? "Nueva clave (vacío = no cambia)" : "Clave"}</label>
          <input name="clave" type="password" ${editando ? "" : "required"} minlength="4" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true">
        </div>
        ${editando ? `<div class="field"><label>Estado</label>
          <select name="activo"><option value="1" ${editando.activo ? "selected" : ""}>Activo</option>
          <option value="0" ${!editando.activo ? "selected" : ""}>Suspendido</option></select></div>` : ""}
        <div class="field full toolbar">
          <button class="btn copper" type="submit">${editando ? "Guardar cambios" : "Crear usuario"}</button>
          ${editando ? `<button class="btn ghost" type="button" id="btn-usu-cancel">Cancelar</button>
            <button class="btn danger" type="button" id="btn-usu-del">Eliminar</button>` : ""}
        </div>
      </form>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
        <tbody>${data.usuarios.map((u) => `
          <tr>
            <td class="mono">${esc(u.usuario)}</td>
            <td>${esc(u.nombre)}</td>
            <td>${esc(etiquetaRol(u.rol))}</td>
            <td>${u.activo ? "Activo" : "Suspendido"}</td>
            <td><button class="btn ghost" type="button" data-edit="${u.id}">Editar</button></td>
          </tr>`).join("")}</tbody>
      </table>
    </div>`;
  $("#form-usu").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      if (editando) {
        const body = { nombre: fd.nombre, rol: fd.rol, activo: fd.activo !== "0" };
        if (fd.clave) body.clave = fd.clave;
        await api("/api/usuarios/" + editando.id, { method: "PUT", body });
        toast("Usuario actualizado");
      } else {
        await api("/api/usuarios", { method: "POST", body: fd });
        toast("Usuario creado");
      }
      state._usuEdit = null;
      route();
    } catch (err) { toast(err.message, true); }
  };
  document.querySelectorAll("[data-edit]").forEach((b) => {
    b.onclick = () => { state._usuEdit = Number(b.dataset.edit); route(); };
  });
  $("#btn-usu-cancel") && ($("#btn-usu-cancel").onclick = () => { state._usuEdit = null; route(); });
  $("#btn-usu-del") && ($("#btn-usu-del").onclick = async () => {
    if (!confirm("¿Eliminar este usuario?")) return;
    try {
      await api("/api/usuarios/" + editando.id, { method: "DELETE" });
      toast("Usuario eliminado");
      state._usuEdit = null;
      route();
    } catch (err) { toast(err.message, true); }
  });
}

async function elegirProveedor(modo) {
  setNav("envios");
  if (modo === "recepcion") {
    const data = await api("/api/planta/resumen");
    app().innerHTML = `
      <h1>Recepción de planta</h1>
      <p class="lead">${rolActual() === "despacho"
        ? "En el celular: escaneá los tubos que vuelven. Se guarda un registro pendiente; administración completa los lotes en la PC."
        : "Escaneá los tubos recibidos. Podés cerrar con lotes al confirmar, o usar Completar recepciones para lo que escaneó despacho."}</p>
      ${rolActual() === "admin" ? `<p><a class="btn copper" href="#/planta/completar">Ver recepciones pendientes de completar</a></p>` : ""}
      <div class="grid stats">
        <div class="card stat cargado"><div class="n">${data.total || 0}</div><small>Total en todas las plantas</small></div>
        ${data.sin_planta ? `<div class="card stat vacio"><div class="n">${data.sin_planta}</div><small>En planta sin proveedor</small></div>` : ""}
      </div>
      <div class="grid form plantas-resumen">
        ${(data.plantas || []).map((p) => `
          <a class="card plant-pick ${Number(p.cantidad) ? "" : "vacia"}" href="#/planta/recepcion/${p.id}">
            <strong>${esc(p.nombre)}</strong>
            <div class="n">${p.cantidad}</div>
            <small>${Number(p.cantidad) === 1 ? "tubo cargándose" : "tubos cargándose"}</small>
          </a>`).join("") || `<p class="empty">No hay plantas cargadas. Cargá un proveedor primero.</p>`}
      </div>
      ${puede("admin") ? `<p><a href="#/proveedores">Administrar proveedores</a> · <a href="#/envios/planta">← Volver</a></p>` : `<p><a href="#/envios/planta">← Volver</a></p>`}`;
    return;
  }
  const data = await api("/api/proveedores");
  app().innerHTML = `
    <h1>Despacho a planta</h1>
    <p class="lead">Seleccione el proveedor al que envía los tubos.</p>
    <div class="grid form">
      ${data.proveedores.map((p) => `
        <a class="card" href="#/planta/despacho/${p.id}" style="text-decoration:none">
          <strong>${esc(p.nombre)}</strong>
          <p class="lead">${esc(p.telefono || "Sin teléfono")}</p>
        </a>`).join("") || `<p class="empty">Cargue un proveedor primero.</p>`}
    </div>
    ${puede("admin") ? `<p><a href="#/proveedores">Administrar proveedores</a> · <a href="#/envios/planta">← Volver</a></p>` : `<p><a href="#/envios/planta">← Volver</a></p>`}`;
}

function esMovil() {
  const ua = navigator.userAgent || "";
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) return true;
  if (navigator.maxTouchPoints > 1 && Math.min(window.screen.width, window.screen.height) <= 1024) return true;
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches && window.innerWidth <= 900) return true;
  return false;
}

function scanSafe(fn, ...args) {
  try {
    if (window.GasonorScan && typeof window.GasonorScan[fn] === "function") {
      return window.GasonorScan[fn](...args);
    }
  } catch (_) {}
  return undefined;
}

function persistScanLista() {
  try {
    sessionStorage.setItem("gasonor_scan", JSON.stringify({
      lista: state.scanLista || [],
      modo: state.scanModo || null,
      proveedor: state.scanProveedor || null,
      cliente: state.scanCliente || null,
    }));
  } catch (_) {}
}

function restoreScanLista(esperado) {
  try {
    const raw = sessionStorage.getItem("gasonor_scan");
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.lista)) return;
    if (esperado) {
      if (esperado.modo != null && String(data.modo) !== String(esperado.modo)) return;
      if (esperado.proveedor != null && String(data.proveedor) !== String(esperado.proveedor)) return;
      if (esperado.cliente != null && String(data.cliente) !== String(esperado.cliente)) return;
    }
    if (!(state.scanLista && state.scanLista.length) && data.lista.length) {
      state.scanLista = data.lista;
      state.scanModo = data.modo;
      state.scanProveedor = data.proveedor;
      state.scanCliente = data.cliente;
    }
  } catch (_) {}
}

function clearScanPersist() {
  try { sessionStorage.removeItem("gasonor_scan"); } catch (_) {}
}

/** Confirmación en pantalla (no usa window.confirm: en celular con cámara se cuelga). */
function pedirConfirmacion(mensaje) {
  return new Promise(async (resolve) => {
    try { await scanSafe("stop"); } catch (_) {}
    const prev = document.getElementById("modal-confirm-scan");
    if (prev) prev.remove();
    const wrap = document.createElement("div");
    wrap.id = "modal-confirm-scan";
    wrap.className = "modal-back modal-confirm-scan";
    wrap.innerHTML = `
      <div class="modal card" role="dialog" aria-modal="true">
        <h2>Advertencia</h2>
        <p class="lead" style="white-space:pre-wrap">${esc(mensaje)}</p>
        <div class="toolbar" style="margin-top:14px;flex-wrap:wrap;gap:8px">
          <button type="button" class="btn copper" id="confirm-si">Sí, proseguir</button>
          <button type="button" class="btn ghost" id="confirm-no">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const done = (ok) => {
      wrap.remove();
      resolve(!!ok);
    };
    wrap.querySelector("#confirm-si").onclick = () => done(true);
    wrap.querySelector("#confirm-no").onclick = () => done(false);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) done(false); });
  });
}

function debeConfirmarDespacho(r) {
  return !!(r && (r.requiere_confirmacion || (r.avisos && r.avisos.length) || r.resultado === "advertencia"));
}

async function confirmarAdvertenciaDespacho(r) {
  const avisos = (r && r.avisos) || [];
  const base = (r && r.mensaje) || (avisos.length ? avisos.join(" ") : "");
  if (!base && !(r && r.requiere_confirmacion)) return true;
  const msg = base
    ? (String(base).includes("Proseguir") ? base : `${base}\n\n¿Proseguir igual?`)
    : "Este tubo no está en el estado habitual.\n\n¿Proseguir igual?";
  return pedirConfirmacion(msg);
}

function scanClave(t) {
  if (t.nuevo || t.id == null || t.id === "") return "n:" + (t.codigo_proveedor || t.numero);
  return "id:" + t.id;
}

function quitarDeLista(clave) {
  state.scanLista = state.scanLista.filter((t) => scanClave(t) !== String(clave));
  persistScanLista();
  pintarListaScan();
}

function htmlPropiedadScan(t) {
  if (t.nuevo) {
    return `<button type="button" class="prop-warn" data-reg="${esc(scanClave(t))}" title="Registrar en la base">
      <span class="warn-tri" aria-hidden="true">⚠</span> No registrado
    </button>`;
  }
  const cli = t.propiedad === "cliente";
  return `<span class="badge ${cli ? "cliente" : "empresa"}">${cli ? "Cliente" : "GN"}</span>`;
}

function htmlListaScan() {
  if (!state.scanLista.length) return `<p class="empty">Todavía no hay tubos en la lista.</p>`;
  return `
    <div class="table-wrap">
      <table class="scan-table">
        <thead>
          <tr><th>Nº tubo</th><th>Cód. proveedor</th><th>Propiedad</th><th>Artículo</th><th></th></tr>
        </thead>
        <tbody>
          ${state.scanLista.map((t) => `
            <tr class="${t.nuevo ? "scan-row-nuevo" : ""}">
              <td class="mono">${esc(t.numero || "—")}</td>
              <td class="mono">${esc(t.codigo_proveedor || "—")}</td>
              <td>${htmlPropiedadScan(t)}</td>
              <td>${esc(t.articulo_descripcion || t.articulo_codigo || "")}</td>
              <td><button type="button" class="btn ghost" onclick="quitarDeLista('${esc(scanClave(t))}')">Quitar</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function pintarListaScan() {
  const ul = $("#lista-scan");
  if (ul) ul.innerHTML = htmlListaScan();
  const n = $("#scan-n");
  if (n) n.textContent = String(state.scanLista.length);
  ul?.querySelectorAll("[data-reg]").forEach((btn) => {
    btn.onclick = () => {
      const clave = btn.getAttribute("data-reg");
      const t = state.scanLista.find((x) => scanClave(x) === clave);
      if (t) modalRegistrarDesdeScan(t.codigo_leido || t.codigo_proveedor || t.numero, clave, {
        contexto: String(state.scanModo || "").startsWith("cli-") ? "cliente" : "planta",
      });
    };
  });
}

function htmlBloqueCamara(hint) {
  if (!esMovil()) {
    return `<p class="scan-pc-hint">Estás en <b>PC</b>: usá la carga manual con el <b>número de tubo</b> o el <b>código de proveedor</b>. La cámara solo se muestra en el celular.</p>`;
  }
  return `
    <div class="scan-cam-panel" id="scan-cam-panel" data-activo="0">
      <button class="btn copper btn-cam-lg" type="button" id="btn-cam">Activar escáner continuo</button>
      <p class="scan-hint scan-hint-idle">La cámara queda apagada hasta que la actives. Mientras tanto podés cargar códigos a mano.</p>
      <div class="scan-stage-wrap" id="scan-stage-wrap" hidden>
        <div class="scan-stage">
          <div id="lector"></div>
          <div class="scan-aim" aria-hidden="true">
            <div class="shade"></div>
            <div class="scan-window"></div>
            <div class="scan-laser"></div>
          </div>
        </div>
        <p class="scan-hint">${hint}</p>
        <button class="btn secondary btn-cam-lg" type="button" id="btn-stop">Detener escáner</button>
      </div>
    </div>`;
}

function enlazarCamaraScan(onCode) {
  if (!esMovil()) return;
  const btnCam = $("#btn-cam");
  const btnStop = $("#btn-stop");
  const wrap = $("#scan-stage-wrap");
  const panel = $("#scan-cam-panel");
  const idle = $(".scan-hint-idle");
  const mostrar = (on) => {
    if (wrap) wrap.hidden = !on;
    if (panel) panel.dataset.activo = on ? "1" : "0";
    if (btnCam) btnCam.hidden = !!on;
    if (idle) idle.hidden = !!on;
  };
  if (btnCam) {
    btnCam.onclick = async () => {
      mostrar(true);
      try {
        scanSafe("unlockAudio");
        await scanSafe("start", "lector", onCode);
        toast("Escáner activo — pasá los tubos por la línea roja");
      } catch (err) {
        mostrar(false);
        toast(err.message || "No se pudo abrir la cámara. Usá carga manual.", true);
      }
    };
  }
  if (btnStop) {
    btnStop.onclick = async () => {
      try { await scanSafe("stop"); } catch (_) {}
      mostrar(false);
      toast("Escáner detenido");
    };
  }
}

function agregarALista(tubo, codigo) {
  const code = String(codigo || "").trim();
  if (state.scanLista.some((t) => scanClave(t) === scanClave(tubo) || String(t.codigo_proveedor) === code || String(t.numero) === code)) {
    scanSafe("beep", "dup");
    scanSafe("showLast", "Ya está: " + code, "dup");
    toast("Ya está en la lista", true);
    return false;
  }
  scanSafe("beep", "ok");
  const etiqueta = tubo.nuevo ? "No registrado: " : "Agregado: ";
  const detalle = [tubo.numero, tubo.codigo_proveedor].filter(Boolean).join(" · ") || code;
  scanSafe("showLast", etiqueta + detalle, tubo.nuevo ? "read" : "ok");
  tubo.codigo_leido = code;
  state.scanLista.unshift(tubo);
  persistScanLista();
  pintarListaScan();
  return true;
}

function gasesPorRubro(rubro) {
  if (rubro === "medicinal") {
    return ["Oxígeno", "Aire medicinal", "Óxido nitroso", "Mezcla"];
  }
  return ["Oxígeno", "Nitrógeno", "Argón", "CO2", "Helio", "Athal"];
}

function modalRegistrarDesdeScan(codigoLeido, claveLista, opts = {}) {
  const leido = String(codigoLeido || "").trim();
  const contexto = opts.contexto === "cliente" ? "cliente" : "planta";
  const estadoAlta = contexto === "cliente" ? "cargado" : "vacio";
  abrirModal(`
    <h2 class="modal-warn-title"><span class="warn-tri" aria-hidden="true">⚠</span> Tubo no registrado</h2>
    <p class="lead">Escaneaste <span class="mono">${esc(leido)}</span> (código de proveedor). Podés vincularlo a un tubo GN que ya exista, crearlo, o enviarlo sin registrar.</p>
    <div class="tabs" id="reg-tabs">
      <button type="button" class="active" data-reg-tab="vincular">Vincular existente</button>
      <button type="button" data-reg-tab="crear">Crear nuevo</button>
    </div>

    <div id="reg-pane-vincular">
      <div class="field full">
        <label>Número de tubo (GN / empresa)</label>
        <div class="cli-suggest">
          <input id="reg-busca-tubo" placeholder="Escribí el nº de trazabilidad…" autocomplete="off" inputmode="search">
          <ul id="reg-lista-tubos" hidden></ul>
        </div>
        <p class="lead" style="margin:6px 0 0">Solo tubos de Gasonor (no de cliente). Tocá uno de la lista para vincular el código escaneado.</p>
      </div>
      <div id="reg-tubo-sel" class="card" hidden style="margin:10px 0;padding:10px"></div>
      <div class="field full toolbar">
        <button class="btn copper" type="button" id="reg-vincular" disabled>Vincular y sumar a la lista</button>
      </div>
    </div>

    <form id="form-reg-scan" class="grid form" hidden>
      <div class="field full"><label>El código leído es</label>
        <div class="toolbar">
          <label class="chip"><input type="radio" name="tipo_codigo" value="proveedor" checked> Código de proveedor / barras</label>
          <label class="chip"><input type="radio" name="tipo_codigo" value="numero"> Número de tubo</label>
        </div>
      </div>
      <div class="field"><label>Número de tubo</label><input name="numero" id="reg-numero" placeholder="Nº de trazabilidad" autocomplete="off"></div>
      <div class="field"><label>Código proveedor</label><input name="codigo_proveedor" id="reg-codp" value="${esc(leido)}" required autocomplete="off"></div>
      <div class="field full"><label>Uso</label>
        <div class="chip-row">
          <label class="chip-choice"><input type="radio" name="rubro" value="industrial" checked> Industrial</label>
          <label class="chip-choice"><input type="radio" name="rubro" value="medicinal"> Medicinal</label>
        </div>
      </div>
      <div class="field full"><label>Tipo de gas</label>
        <select name="grupo" id="reg-gas" required></select>
      </div>
      ${contexto === "cliente" ? `
      <div class="field"><label>Lote</label><input name="lote" id="reg-lote" placeholder="Obligatorio si va cargado" autocomplete="off"></div>
      <div class="field"><label>Estado</label>
        <select name="estado"><option value="cargado" selected>Cargado</option><option value="vacio">Vacío</option></select>
      </div>` : `
      <input type="hidden" name="estado" value="vacio">
      <div class="field full"><label>Propiedad</label>
        <select name="propiedad" id="reg-prop">
          <option value="empresa" selected>GN (Gasonor)</option>
          <option value="cliente">Del cliente</option>
        </select>
      </div>
      <div class="field full" id="reg-wrap-cli" hidden>
        <label>Cliente propietario</label>
        <div class="cli-suggest">
          <input id="reg-cli-busca" placeholder="Escribí para buscar…" autocomplete="off">
          <input type="hidden" name="cliente_id" id="reg-cli-id">
          <ul id="reg-cli-lista" hidden></ul>
        </div>
      </div>`}
      <div class="field full toolbar">
        <button class="btn copper" type="submit">Crear y sumar</button>
      </div>
    </form>

    <div class="field full toolbar" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
      <button class="btn ghost" type="button" id="reg-solo-lista">Enviar sin registrar</button>
    </div>`);

  const paneVinc = $("#reg-pane-vincular");
  const formCrear = $("#form-reg-scan");
  let tuboSel = null;

  $("#reg-tabs")?.querySelectorAll("[data-reg-tab]").forEach((btn) => {
    btn.onclick = () => {
      $("#reg-tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      const tab = btn.dataset.regTab;
      paneVinc.hidden = tab !== "vincular";
      formCrear.hidden = tab !== "crear";
    };
  });

  const pintarGas = () => {
    const rubro = document.querySelector('input[name="rubro"]:checked')?.value || "industrial";
    const sel = $("#reg-gas");
    if (!sel) return;
    const gases = gasesPorRubro(rubro);
    sel.innerHTML = gases.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
  };
  document.querySelectorAll('input[name="rubro"]').forEach((r) => { r.onchange = pintarGas; });
  pintarGas();

  const syncTipo = () => {
    const tipo = document.querySelector('input[name="tipo_codigo"]:checked')?.value;
    if (tipo === "numero") {
      $("#reg-numero").value = leido;
      $("#reg-codp").value = "";
      $("#reg-codp").placeholder = "Barras / cód. proveedor";
    } else {
      $("#reg-codp").value = leido;
      $("#reg-numero").value = "";
      $("#reg-numero").placeholder = "Nº de trazabilidad";
    }
  };
  document.querySelectorAll('input[name="tipo_codigo"]').forEach((r) => { r.onchange = syncTipo; });
  syncTipo();

  if ($("#reg-prop")) {
    const syncProp = () => { $("#reg-wrap-cli").hidden = $("#reg-prop").value !== "cliente"; };
    $("#reg-prop").onchange = syncProp;
    syncProp();
    let tcli;
    const buscarCli = async () => {
      const q = $("#reg-cli-busca").value.trim();
      const ul = $("#reg-cli-lista");
      if (q.length < 2) { ul.hidden = true; ul.innerHTML = ""; return; }
      const data = await api("/api/clientes?q=" + encodeURIComponent(q));
      ul.innerHTML = (data.clientes || []).slice(0, 15).map((c) => `<li data-id="${c.id}">${esc(c.nombre)}</li>`).join("") || `<li>Sin coincidencias</li>`;
      ul.hidden = false;
      ul.querySelectorAll("li[data-id]").forEach((li) => {
        li.onclick = () => {
          $("#reg-cli-id").value = li.dataset.id;
          $("#reg-cli-busca").value = li.textContent;
          ul.hidden = true;
        };
      });
    };
    $("#reg-cli-busca").oninput = () => { clearTimeout(tcli); tcli = setTimeout(() => buscarCli().catch(() => {}), 200); };
  }

  const aplicarTuboLista = (tubo, msg) => {
    const actualizado = {
      ...tubo,
      nuevo: false,
      codigo_leido: leido,
      codigo_proveedor: tubo.codigo_proveedor || leido,
    };
    const idx = state.scanLista.findIndex((t) => scanClave(t) === claveLista);
    if (idx >= 0) state.scanLista[idx] = actualizado;
    else state.scanLista.unshift(actualizado);
    cerrarModal();
    pintarListaScan();
    toast(msg || "Tubo sumado a la lista");
  };

  const pintarSel = () => {
    const box = $("#reg-tubo-sel");
    const btn = $("#reg-vincular");
    if (!tuboSel) {
      box.hidden = true;
      box.innerHTML = "";
      btn.disabled = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = `<strong class="mono">${esc(tuboSel.numero)}</strong>
      <div>${esc(tuboSel.articulo_descripcion || tuboSel.grupo || "")}</div>
      <small>Estado: ${esc(ESTADOS[tuboSel.estado] || tuboSel.estado || "—")} · Cód. actual: ${esc(tuboSel.codigo_proveedor || "—")}</small>`;
    btn.disabled = false;
  };

  let tBus;
  const buscarTubos = async () => {
    const q = ($("#reg-busca-tubo").value || "").trim();
    const ul = $("#reg-lista-tubos");
    if (q.length < 1) { ul.hidden = true; ul.innerHTML = ""; return; }
    const qs = new URLSearchParams({ q, propiedad: "empresa" });
    if (contexto === "cliente") qs.set("estado", "cargado");
    else qs.set("estado", "vacio,cargado");
    const data = await api("/api/tubos?" + qs.toString());
    const tubos = (data.tubos || []).slice(0, 20);
    if (!tubos.length) {
      ul.innerHTML = `<li>No hay tubos GN con ese número</li>`;
      ul.hidden = false;
      return;
    }
    ul.innerHTML = tubos.map((t) => `
      <li data-id="${t.id}">
        <strong class="mono">${esc(t.numero)}</strong>
        · ${esc(t.articulo_descripcion || t.grupo || "")}
        <small style="display:block;opacity:.75">${esc(ESTADOS[t.estado] || t.estado)} · prov ${esc(t.codigo_proveedor || "—")}</small>
      </li>`).join("");
    ul.hidden = false;
    ul.querySelectorAll("li[data-id]").forEach((li) => {
      li.onclick = () => {
        tuboSel = tubos.find((t) => String(t.id) === String(li.dataset.id)) || null;
        $("#reg-busca-tubo").value = tuboSel?.numero || q;
        ul.hidden = true;
        pintarSel();
      };
    });
  };
  $("#reg-busca-tubo").oninput = () => {
    tuboSel = null;
    pintarSel();
    clearTimeout(tBus);
    tBus = setTimeout(() => buscarTubos().catch((e) => toast(e.message, true)), 220);
  };

  $("#reg-vincular").onclick = async () => {
    if (!tuboSel?.id) return toast("Elegí un tubo de la lista", true);
    try {
      const r = await api("/api/tubos/vincular", {
        method: "POST",
        body: { tubo_id: tuboSel.id, codigo_proveedor: leido, contexto },
      });
      aplicarTuboLista(r.tubo || r, "Código vinculado al tubo " + (r.tubo?.numero || ""));
    } catch (err) { toast(err.message, true); }
  };

  $("#reg-solo-lista").onclick = () => {
    cerrarModal();
    toast("Queda en la lista como no registrado");
  };

  formCrear.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const numero = String(fd.numero || "").trim();
    const codigo_proveedor = String(fd.codigo_proveedor || "").trim();
    const grupo = String(fd.grupo || "").trim();
    const rubro = String(fd.rubro || "industrial");
    if (!numero) return toast("Ingresá el número de tubo", true);
    if (!codigo_proveedor) return toast("Ingresá el código de proveedor", true);
    if (!grupo) return toast("Elegí el tipo de gas", true);
    if (fd.propiedad === "cliente" && !fd.cliente_id) return toast("Asigná el cliente propietario", true);
    const estado = String(fd.estado || estadoAlta);
    const lote = String(fd.lote || "").trim().toUpperCase();
    if (estado === "cargado" && !lote) return toast("Si va cargado, ingresá el lote", true);
    const desc = `${grupo} ${rubro === "medicinal" ? "MEDICINAL" : "INDUSTRIAL"}`.trim().toUpperCase();
    try {
      const r = await api("/api/tubos", {
        method: "POST",
        body: {
          numero,
          codigo: numero,
          codigo_proveedor,
          grupo,
          descripcion: desc,
          propiedad: fd.propiedad || "empresa",
          cliente_id: fd.cliente_id || null,
          estado,
          lote,
        },
      });
      aplicarTuboLista(r.tubo || r, "Tubo creado y sumado a la lista");
    } catch (err) { toast(err.message, true); }
  };
}

async function procesarCodigo(codigo, modo, proveedorId) {
  codigo = String(codigo || "").trim();
  if (!codigo) return;
  if (state.scanLista.some((t) => String(t.codigo_proveedor) === codigo || String(t.numero) === codigo)) {
    scanSafe("beep", "dup");
    scanSafe("showLast", "Ya está: " + codigo, "dup");
    toast("Ya está en la lista", true);
    return;
  }
  try {
    const r = await api("/api/planta/identificar", { method: "POST", body: { codigo, modo, proveedor_id: proveedorId } });
    if (modo === "despacho" && (r.resultado === "nuevo" || r.resultado === "no_encontrado")) {
      const clave = "n:" + codigo;
      const ok = agregarALista(
        {
          id: null,
          nuevo: true,
          numero: "",
          codigo_proveedor: codigo,
          articulo_descripcion: "No registrado en la base",
          propiedad: "empresa",
          estado: "vacio",
          codigo_leido: codigo,
        },
        codigo,
      );
      if (ok) modalRegistrarDesdeScan(codigo, clave, { contexto: "planta" });
      return;
    }
    if ((r.resultado === "ok" || r.resultado === "advertencia") && r.tubo) {
      if (modo === "despacho" && debeConfirmarDespacho(r)) {
        const sigue = await confirmarAdvertenciaDespacho(r);
        if (!sigue) {
          scanSafe("beep", "fail");
          scanSafe("showLast", codigo + " — cancelado", "fail");
          return;
        }
      }
      agregarALista(r.tubo, codigo);
      if (debeConfirmarDespacho(r)) toast("Sumado con advertencia");
      return;
    }
    if (modo === "despacho" && r.tubo && ["estado_invalido", "ya_en_planta", "esta_vacio", "en_planta", "otro_cliente", "ya_en_cliente"].includes(r.resultado)) {
      const avisos = r.avisos || [r.mensaje || ("Estado: " + (ESTADOS[r.tubo.estado] || r.tubo.estado))];
      const sigue = await confirmarAdvertenciaDespacho({ ...r, avisos, mensaje: avisos.join(" ") + " ¿Proseguir igual?" });
      if (!sigue) {
        scanSafe("beep", "fail");
        return;
      }
      agregarALista(r.tubo, codigo);
      toast("Sumado con advertencia");
      return;
    }
    scanSafe("beep", "fail");
    const msgs = {
      no_encontrado: modo === "recepcion"
        ? "No está despachado a planta. Solo se recepcionan tubos que ya se enviaron."
        : "No está en el sistema",
      ya_en_planta: "Ese tubo ya está en planta",
      estado_invalido: "El tubo no está en empresa",
      no_en_planta: "Ese tubo no figura en planta: hay que despacharlo primero",
      otro_proveedor: "Está en " + (r.tubo?.proveedor_nombre || "otra planta") + ". Entrá a recepción de esa planta.",
      ya_escaneado: "Ya está en un escaneo pendiente" + (r.remito ? " (remito " + r.remito + ")" : "") + ". Administración debe completar los lotes.",
    };
    const msg = msgs[r.resultado] || r.mensaje || "No se pudo leer";
    scanSafe("showLast", codigo + " — " + msg, "fail");
    toast(msg, true);
  } catch (err) {
    scanSafe("beep", "fail");
    scanSafe("showLast", codigo + " — " + (err.message || "Error"), "fail");
    toast(err.message, true);
  }
}

async function vistaScan(modo, proveedorId) {
  setNav("envios");
  restoreScanLista({ modo, proveedor: proveedorId });
  if (state.scanModo !== modo || String(state.scanProveedor) !== String(proveedorId)) {
    state.scanLista = [];
    state.scanModo = modo;
    state.scanProveedor = proveedorId;
    clearScanPersist();
  }
  const provs = (await api("/api/proveedores")).proveedores;
  const prov = provs.find((p) => String(p.id) === String(proveedorId));
  let deuda = [];
  if (modo === "recepcion") {
    deuda = (await api("/api/planta/deuda?proveedor_id=" + proveedorId)).tubos;
  }
  const movil = esMovil();
  app().innerHTML = `
    <h1>${modo === "despacho" ? "Despacho a planta" : "Recepción de planta"}</h1>
    <p class="lead">${esc(prov ? prov.nombre : "Proveedor")} — cargá los tubos a mano o activá el escáner continuo cuando lo necesites.</p>
    ${modo === "despacho"
      ? `<p class="lead">Podés despachar <b>cualquier</b> tubo. Si no está en depósito vacíos o está asignado a un cliente, te pide confirmación.</p>`
      : ""}
    ${modo === "recepcion" ? `<p class="lead">En esta planta hay ${deuda.length} tubo(s) despachado(s) pendientes de recepción.</p>` : ""}
    ${modo === "recepcion" && deuda.length ? `
      <div class="card" style="margin-bottom:12px">
        <h3 style="margin:0 0 8px">Pendientes en esta planta</h3>
        <p class="lead" style="margin:0 0 10px">Tocá <b>Sumar</b> o cargá el código. Al confirmar te pide el <b>número de lote</b>.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Nº tubo</th><th>Cód. proveedor</th><th>Artículo</th><th></th></tr></thead>
          <tbody>
            ${deuda.map((t) => `
              <tr>
                <td class="mono">${esc(t.numero)}</td>
                <td class="mono">${esc(t.codigo_proveedor || "—")}</td>
                <td>${esc(t.articulo_descripcion || t.articulo_codigo || "")}</td>
                <td><button type="button" class="btn secondary" data-add-deuda="${esc(t.codigo_proveedor || t.numero)}">Sumar</button></td>
              </tr>`).join("")}
          </tbody>
        </table></div>
      </div>` : ""}
    <div class="card scan-wrap">
      ${htmlBloqueCamara(modo === "despacho"
        ? "Tocá <b>Iniciar cámara</b>. Sirve número de tubo o código de proveedor. Si no está en la base, vas a poder registrarlo."
        : "Tocá <b>Iniciar cámara</b>. Solo se aceptan tubos <b>ya despachados</b> a este proveedor.")}
      <div id="scan-last" class="scan-last" hidden></div>
      <form id="manual" class="toolbar">
        <div class="field" style="flex:1"><label>Carga manual</label>
          <input name="codigo" placeholder="Número de tubo o código de proveedor" autocomplete="off" autofocus>
        </div>
        <button class="btn" type="submit">Agregar</button>
      </form>
      <div class="scan-count">En lista: <span id="scan-n">${state.scanLista.length}</span></div>
      <div id="lista-scan">${htmlListaScan()}</div>
      <div class="toolbar">
        <button class="btn copper" type="button" id="btn-seguir">${modo === "recepcion" ? "Siguiente: confirmar escaneo" : "Siguiente: remito y confirmar"}</button>
      </div>
    </div>`;
  pintarListaScan();
  enlazarCamaraScan((code) => procesarCodigo(code, modo, proveedorId));
  $("#manual").onsubmit = (e) => {
    e.preventDefault();
    const c = e.target.codigo.value.trim();
    e.target.codigo.value = "";
    if (c) procesarCodigo(c, modo, proveedorId);
  };
  document.querySelectorAll("[data-add-deuda]").forEach((btn) => {
    btn.onclick = () => procesarCodigo(btn.getAttribute("data-add-deuda"), modo, proveedorId);
  });
  $("#btn-seguir").onclick = async () => {
    if (!state.scanLista.length) return toast("La lista está vacía", true);
    persistScanLista();
    if (movil) {
      try { await scanSafe("stop"); } catch (_) {}
    }
    location.hash = `#/planta/${modo}/${proveedorId}/confirmar`;
  };
}

async function vistaConfirmarPlanta(modo, proveedorId) {
  setNav("envios");
  restoreScanLista({ modo, proveedor: proveedorId });
  const provs = (await api("/api/proveedores")).proveedores;
  const prov = provs.find((p) => String(p.id) === String(proveedorId));
  if (!state.scanLista.length) {
    location.hash = `#/planta/${modo}/${proveedorId}`;
    return;
  }
  const esAdmin = rolActual() === "admin";
  const recep = modo === "recepcion";
  const movil = esMovil();
  // Celular / rol despacho: solo escaneo → borrador. Admin en PC completa remito, lote y vto.
  const soloBorrador = recep && (!esAdmin || movil);
  // En celular el remito del despacho es opcional (a veces no tienen el papel a mano).
  const remitoOpcional = !recep && movil;
  const pideLotes = recep && esAdmin && !soloBorrador;
  app().innerHTML = `
    <h1>Confirmar ${recep ? "recepción" : "despacho"}</h1>
    <p class="lead">${esc(prov ? prov.nombre : "")} · ${state.scanLista.length} tubo(s)
      ${soloBorrador ? " · Se enviará a administración" : ""}</p>
    ${soloBorrador ? `<p class="scan-pc-hint">No hace falta remito, lote ni vencimiento acá. Administración los completa en la PC (Completar recepciones).</p>` : ""}
    <div class="card">
      <form id="form-doc" class="grid form">
        ${soloBorrador ? "" : `<div class="field"><label>Nº remito${remitoOpcional ? " (opcional)" : ""}</label><input name="remito" ${remitoOpcional ? "" : "required"} placeholder="${remitoOpcional ? "Opcional" : "Como en el papel"}"></div>`}
        <div class="field"><label>Quién despacha / recibe</label><input value="${esc(state.usuario?.nombre || "")}" disabled></div>
        <div class="field"><label>Fecha</label><input name="fecha" type="date" value="${hoyInput()}" ${esAdmin && !soloBorrador ? "" : "readonly"}></div>
        <div class="field"><label>Hora</label><input name="hora" type="time" value="${horaInput()}" ${esAdmin && !soloBorrador ? "" : "readonly"}></div>
        ${pideLotes ? `
          <div class="field full lote-pregunta">
            <label>¿El número de lote es el mismo para todos los cilindros?</label>
            <div class="toolbar">
              <label class="chip"><input type="radio" name="lote_igual" value="si" checked> Sí, el mismo</label>
              <label class="chip"><input type="radio" name="lote_igual" value="no"> No, son distintos</label>
            </div>
          </div>
          <div class="field" id="lote-unico-wrap">
            <label>Número de lote / trazabilidad de carga</label>
            <input name="lote" required placeholder="Ej: C012-943" autocomplete="off">
          </div>
          <div class="field"><label>Vto. (opcional, a todos)</label><input name="fecha_vto" type="date"></div>
        ` : ""}
        <div class="field full"><label>Observaciones</label><textarea name="observaciones" rows="2" placeholder="${soloBorrador ? "Opcional" : ""}"></textarea></div>
        <div class="field full" id="lotes-lista" hidden>
          <label>Lote de cada tubo</label>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Código</th><th>Artículo</th><th>Lote</th></tr></thead>
              <tbody>
                ${state.scanLista.map((t) => `
                  <tr>
                    <td class="mono">${esc(t.numero || "—")}${t.codigo_proveedor && t.codigo_proveedor !== t.numero ? ` · ${esc(t.codigo_proveedor)}` : ""}</td>
                    <td>${esc(t.articulo_descripcion || "")}</td>
                    <td><input data-lote-id="${t.id}" required placeholder="Lote" autocomplete="off"></td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
        </div>
        <div class="field full">
          <button class="btn copper" type="submit">${soloBorrador ? "Guardar escaneo (sin remito)" : `Guardar ${recep ? "recepción" : "despacho"}`}</button>
        </div>
      </form>
      <div id="lista-scan">${htmlListaScan()}</div>
    </div>`;
  pintarListaScan();
  const aplicarLoteIgual = () => {
    if (!pideLotes) return;
    const igual = ($("#form-doc").lote_igual.value === "si");
    $("#lote-unico-wrap").hidden = !igual;
    $("#lotes-lista").hidden = igual;
    const unico = $("#form-doc").lote;
    if (unico) unico.required = igual;
    document.querySelectorAll("[data-lote-id]").forEach((inp) => { inp.required = !igual; });
  };
  if (pideLotes) {
    document.querySelectorAll("input[name=lote_igual]").forEach((r) => { r.onchange = aplicarLoteIgual; });
    aplicarLoteIgual();
  }
  $("#form-doc").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.proveedor_id = Number(proveedorId);
    fd.tubo_ids = state.scanLista.filter((t) => t.id && !t.nuevo).map((t) => t.id);
    fd.codigos_nuevos = state.scanLista.filter((t) => t.nuevo || !t.id).map((t) => t.codigo_proveedor || t.numero);
    if (recep) {
      if (!fd.tubo_ids.length) return toast("Solo se recepcionan tubos ya despachados.", true);
      if (soloBorrador) {
        fd.borrador = true;
        fd.remito = "";
      } else {
        const igual = fd.lote_igual === "si";
        const lotes = {};
        if (igual) {
          const lote = String(fd.lote || "").trim();
          if (!lote) return toast("Ingresá el número de lote.", true);
          fd.tubo_ids.forEach((id) => { lotes[id] = lote.toUpperCase(); });
          fd.lote = lote.toUpperCase();
        } else {
          let falta = false;
          document.querySelectorAll("[data-lote-id]").forEach((inp) => {
            const v = inp.value.trim();
            if (!v) falta = true;
            lotes[inp.dataset.loteId] = v.toUpperCase();
          });
          if (falta) return toast("Completá el lote de cada tubo.", true);
          fd.lote = "";
        }
        fd.lotes = lotes;
        fd.borrador = false;
      }
    }
    try {
      const url = recep ? "/api/planta/recepcion" : "/api/planta/despacho";
      const r = await api(url, { method: "POST", body: fd });
      if (r.borrador || r.estado === "borrador") {
        toast(`Escaneo guardado: ${r.cantidad} tubo(s). Pendiente de lotes en administración.`);
      } else {
        toast(`Guardado: ${r.cantidad} tubo(s)`);
      }
      state.scanLista = [];
      state.scanModo = null;
      state.scanProveedor = null;
      clearScanPersist();
      location.hash = "#/inicio";
    } catch (err) { toast(err.message, true); }
  };
}

async function vistaCompletarRecepciones() {
  setNav("planta");
  if (rolActual() !== "admin") {
    toast("Solo administración completa las recepciones", true);
    location.hash = "#/inicio";
    return;
  }
  const tab = (parseHash().params.get("tab") || "pendientes");
  const [pend, hist] = await Promise.all([
    api("/api/planta/documentos?estado=borrador&tipo=recepcion"),
    api("/api/planta/documentos?estado=cerrado&tipo=recepcion"),
  ]);
  const pendientes = pend.documentos || [];
  const historial = hist.documentos || [];
  const filas = (docs, modo) => docs.length
    ? docs.map((d) => `
      <tr>
        <td class="mono">${fmtFecha(d.fecha)} ${esc(d.hora || "")}</td>
        <td class="mono">${esc(d.remito || "—")}</td>
        <td>${esc(d.proveedor_nombre || "")}</td>
        <td>${esc(d.usuario_nombre || "—")}</td>
        <td class="mono">${d.cantidad || 0}</td>
        <td class="mono">${modo === "hist" ? (fmtFecha(d.cerrado_en) || "—") : "—"}</td>
        <td>
          <a class="btn ${modo === "hist" ? "secondary" : "copper"} btn-accion"
             href="#/planta/completar/${d.id}">${modo === "hist" ? "Editar" : "Completar"}</a>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="empty">${modo === "hist" ? "Todavía no hay recepciones completadas." : "No hay recepciones pendientes."}</td></tr>`;
  app().innerHTML = `
    <h1>Completar recepciones de planta</h1>
    <p class="lead">Pendientes del celular, y historial de las ya cerradas (podés abrirlas y corregir remito, lote o trazabilidad).</p>
    <div class="tabs">
      <button type="button" data-tab="pendientes" class="${tab === "pendientes" ? "active" : ""}">Pendientes (${pendientes.length})</button>
      <button type="button" data-tab="historial" class="${tab === "historial" ? "active" : ""}">Historial (${historial.length})</button>
    </div>
    <div class="card table-wrap" ${tab === "pendientes" ? "" : "hidden"}>
      <table>
        <thead><tr><th>Fecha</th><th>Remito</th><th>Planta</th><th>Escaneó</th><th>Tubos</th><th>Cerrada</th><th></th></tr></thead>
        <tbody>${filas(pendientes, "pend")}</tbody>
      </table>
    </div>
    <div class="card table-wrap" ${tab === "historial" ? "" : "hidden"}>
      <table>
        <thead><tr><th>Fecha</th><th>Remito</th><th>Planta</th><th>Escaneó</th><th>Tubos</th><th>Cerrada</th><th></th></tr></thead>
        <tbody>${filas(historial, "hist")}</tbody>
      </table>
    </div>
    <p class="toolbar"><a class="btn ghost" href="#/planta/recepcion">Ir a escanear recepción</a></p>`;
  app().querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => { location.hash = "#/planta/completar?tab=" + b.dataset.tab; };
  });
}

async function vistaCerrarRecepcion(docId) {
  setNav("planta");
  if (rolActual() !== "admin") {
    location.hash = "#/inicio";
    return;
  }
  const data = await api("/api/planta/documentos/" + docId);
  const d = data.documento;
  const items = data.items || [];
  if (!d || d.tipo !== "recepcion") {
    toast("Documento no encontrado", true);
    location.hash = "#/planta/completar";
    return;
  }
  const editando = d.estado === "cerrado";
  if (d.estado !== "borrador" && !editando) {
    toast("Ese documento no se puede abrir", true);
    location.hash = "#/planta/completar";
    return;
  }
  const lotesPrev = items.map((t) => String(t.lote_doc || t.lote || "").trim().toUpperCase());
  const lotesOk = lotesPrev.filter(Boolean);
  const mismoLote = lotesOk.length > 0 && lotesOk.every((l) => l === lotesOk[0]);
  const loteComunInit = mismoLote ? lotesOk[0] : "";
  const loteIgualInit = editando ? mismoLote || lotesOk.length === 0 : true;
  const vtos = items.map((t) => String(t.fecha_vto || "").trim()).filter(Boolean);
  const vtoComun = vtos.length && vtos.every((v) => v === vtos[0]) ? vtos[0] : "";

  app().innerHTML = `
    <h1>${editando ? "Editar recepción" : "Completar recepción"} #${d.id}</h1>
    <p class="lead">${esc(d.proveedor_nombre || "")} · Escaneó ${esc(d.usuario_nombre || "")} el ${fmtFecha(d.fecha)}
      ${editando ? ` · <span class="badge empresa">Cerrada ${fmtFecha(d.cerrado_en)}</span>` : ""}</p>
    <div class="card">
      <form id="form-cerrar" class="grid form">
        <div class="field"><label>Nº remito</label><input name="remito" required value="${esc(d.remito || "")}" placeholder="Como en el papel"></div>
        <div class="field"><label>Vto. hidráulica (opcional)</label><input name="fecha_vto" type="date" value="${esc(vtoComun)}"></div>
        <div class="field full lote-pregunta">
          <label>¿El lote de carga es el mismo para todos?</label>
          <div class="chip-row">
            <label class="chip chip-choice"><input type="radio" name="lote_igual" value="si" ${loteIgualInit ? "checked" : ""}> Sí, el mismo lote</label>
            <label class="chip chip-choice"><input type="radio" name="lote_igual" value="no" ${loteIgualInit ? "" : "checked"}> No, uno por tubo</label>
          </div>
        </div>
        <div class="field" id="lote-unico-wrap">
          <label>Lote de carga (aplica a todos)</label>
          <input name="lote" id="lote-comun-cerrar" required placeholder="Ej: C012-943" autocomplete="off" value="${esc(loteComunInit)}">
          <small class="hint">Es el lote del gas / carga, no el número de tubo.</small>
        </div>
        <div class="field full">
          <label>Tubos de esta recepción</label>
          <div class="table-wrap" id="wrap-lineas-cerrar">
            <table class="tabla-cerrar-recep">
              <thead>
                <tr>
                  <th>Cód. proveedor</th>
                  <th>Fecha envío a planta</th>
                  <th>Nº trazabilidad</th>
                  <th>Lote de carga</th>
                </tr>
              </thead>
              <tbody>
                ${items.map((t) => `
                  <tr>
                    <td class="mono">${esc(t.codigo_proveedor_mostrar || t.codigo_proveedor || t.codigo_leido || "—")}</td>
                    <td class="mono">${fmtFecha(t.fecha_envio_planta) || "—"}</td>
                    <td>
                      <input class="inp-traza" data-num-id="${t.id}" required
                        value="${editando ? esc(t.numero || "") : ""}"
                        placeholder="Completar a mano" autocomplete="off"
                        title="Número de trazabilidad (obligatorio)">
                    </td>
                    <td class="celda-lote">
                      <input class="inp-lote" data-lote-id="${t.id}" placeholder="Lote" autocomplete="off"
                        value="${esc(t.lote_doc || t.lote || "")}" title="Lote de carga / gas">
                    </td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>
          <p class="hint" id="hint-lineas"></p>
        </div>
        <div class="field full toolbar actions-iguales">
          <button class="btn copper btn-accion" type="submit">${editando ? `Guardar cambios (${items.length})` : `Cerrar recepción (${items.length})`}</button>
          <a class="btn ghost btn-accion" href="#/planta/completar${editando ? "?tab=historial" : ""}">Volver</a>
        </div>
      </form>
    </div>`;

  const aplicar = () => {
    const igual = (document.querySelector('input[name="lote_igual"]:checked')?.value === "si");
    const wrapUnico = $("#lote-unico-wrap");
    const wrapLineas = $("#wrap-lineas-cerrar");
    const unico = $("#lote-comun-cerrar");
    wrapUnico.hidden = !igual;
    wrapLineas.classList.toggle("lotes-bloqueados", igual);
    if (unico) {
      unico.required = igual;
      unico.disabled = !igual;
    }
    document.querySelectorAll(".inp-lote").forEach((inp) => {
      inp.disabled = igual;
      inp.required = !igual;
    });
    // Nº trazabilidad: siempre editable y obligatorio
    document.querySelectorAll(".inp-traza").forEach((inp) => {
      inp.disabled = false;
      inp.readOnly = false;
      inp.required = true;
    });
    const hint = $("#hint-lineas");
    if (hint) {
      hint.innerHTML = igual
        ? "El <b>nº de trazabilidad</b> se completa a mano en cada línea (obligatorio). El <b>lote</b> es único y se aplica a todos desde arriba."
        : "Completá a mano el <b>nº de trazabilidad</b> y el <b>lote de carga</b> en cada fila (ambos obligatorios).";
    }
  };
  document.querySelectorAll('input[name="lote_igual"]').forEach((r) => { r.onchange = aplicar; });
  aplicar();

  $("#form-cerrar").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const lotes = {};
    const numeros = {};
    const igual = fd.lote_igual === "si";
    if (igual) {
      const lote = String(fd.lote || "").trim().toUpperCase();
      if (!lote) return toast("Ingresá el lote de carga", true);
      items.forEach((t) => { lotes[t.id] = lote; });
    } else {
      let falta = false;
      document.querySelectorAll("[data-lote-id]").forEach((inp) => {
        const v = inp.value.trim().toUpperCase();
        if (!v) falta = true;
        lotes[inp.dataset.loteId] = v;
      });
      if (falta) return toast("Completá el lote de carga de cada tubo", true);
    }
    let faltaNum = false;
    document.querySelectorAll("[data-num-id]").forEach((inp) => {
      const v = inp.value.trim();
      if (!v) faltaNum = true;
      else numeros[inp.dataset.numId] = v;
    });
    if (faltaNum) return toast("El número de trazabilidad es obligatorio en cada tubo", true);
    const remito = String(fd.remito || "").trim();
    if (!remito) return toast("Ingresá el número de remito", true);
    const url = editando
      ? "/api/planta/documentos/" + docId + "/editar"
      : "/api/planta/documentos/" + docId + "/cerrar";
    try {
      const r = await api(url, {
        method: "POST",
        body: { lotes, numeros, lote: igual ? (fd.lote || "") : "", fecha_vto: fd.fecha_vto || "", remito },
      });
      toast(editando
        ? `Recepción actualizada: ${r.cantidad} tubo(s)`
        : `Recepción cerrada: ${r.cantidad} tubo(s) cargados en empresa`);
      location.hash = editando ? "#/planta/completar?tab=historial" : "#/planta/completar";
    } catch (err) { toast(err.message, true); }
  };
}

async function elegirClienteOp(modo) {
  setNav("envios");
  const recep = modo === "recepcion";
  app().innerHTML = `
    <h1>${recep ? "Recepción de cliente" : "Despacho a cliente"}</h1>
    <p class="lead">${recep
      ? "Solo aparecen clientes que tienen tubos en su poder. Tocá uno para cargar / escanear."
      : "Buscá por nombre, CUIT o dirección y tocá el cliente."}</p>
    <div class="card">
      <div class="toolbar cliente-busca-bar">
        <div class="field"><label>Nombre</label>
          <input id="opcli-nombre" placeholder="Escribí el nombre…" autocomplete="off">
        </div>
        <div class="field"><label>CUIT</label>
          <input id="opcli-cuit" placeholder="20-…" autocomplete="off">
        </div>
        <div class="field field-dir"><label>Dirección</label>
          <input id="opcli-dir" placeholder="Calle, barrio…" autocomplete="off">
        </div>
      </div>
      <div id="cli-op-res" class="cli-pick-list" style="margin-top:12px"></div>
    </div>
    <p><a href="#/envios/cliente">← Volver</a></p>`;
  const ir = (id) => {
    location.hash = `#/cliente/${modo}/${id}`;
  };
  const pintarCards = (rows) => {
    const box = $("#cli-op-res");
    if (!box) return;
    if (!rows.length) {
      box.innerHTML = `<p class="empty">${recep
        ? "No hay clientes con tubos en su poder" + (($("#opcli-nombre")?.value || $("#opcli-cuit")?.value || $("#opcli-dir")?.value) ? " para esa búsqueda." : ".")
        : "Sin coincidencias. Seguí escribiendo o probá por dirección."}</p>`;
      return;
    }
    box.innerHTML = rows.map((c) => {
      const n = Number(c.tubos || 0);
      return `
        <button type="button" class="cli-pick" data-cid="${c.id}">
          <span class="cli-pick-main">
            <strong>${esc(c.nombre)}</strong>
            <small>${esc(c.cuit || "Sin CUIT")}${recep ? ` · ${n} tubo${n === 1 ? "" : "s"}` : ""}</small>
            <span class="cli-dir">${esc(c.direccion || "Sin dirección")}</span>
          </span>
          <span class="cli-pick-go">${recep ? "Recibir →" : "Despachar →"}</span>
        </button>`;
    }).join("");
    box.querySelectorAll("[data-cid]").forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        ir(btn.dataset.cid);
      };
    });
  };
  let t;
  const refrescar = async () => {
    const nombre = ($("#opcli-nombre").value || "").trim();
    const cuit = ($("#opcli-cuit").value || "").trim();
    const direccion = ($("#opcli-dir").value || "").trim();
    const qs = new URLSearchParams();
    if (nombre) qs.set("q", nombre);
    if (cuit) qs.set("cuit", cuit);
    if (direccion) qs.set("direccion", direccion);
    if (recep) qs.set("en_cliente", "1");
    const data = await api("/api/clientes" + (qs.toString() ? "?" + qs.toString() : ""));
    pintarCards((data.clientes || []).slice(0, 40));
  };
  ["opcli-nombre", "opcli-cuit", "opcli-dir"].forEach((id) => {
    const el = $("#" + id);
    if (!el) return;
    el.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => refrescar().catch((e) => toast(e.message, true)), 200);
    });
  });
  await refrescar().catch((e) => toast(e.message, true));
}

async function procesarCodigoCliente(codigo, modo, clienteId) {
  codigo = String(codigo || "").trim();
  if (!codigo) return;
  if (state.scanLista.some((t) => String(t.codigo_proveedor) === codigo || String(t.numero) === codigo)) {
    scanSafe("beep", "dup");
    scanSafe("showLast", "Ya está: " + codigo, "dup");
    toast("Ya está en la lista", true);
    return;
  }
  try {
    const r = await api("/api/cliente/identificar", {
      method: "POST",
      body: { codigo, modo, cliente_id: Number(clienteId) },
    });
    if ((r.resultado === "ok" || r.resultado === "advertencia") && r.tubo) {
      if (modo === "despacho" && debeConfirmarDespacho(r)) {
        const sigue = await confirmarAdvertenciaDespacho(r);
        if (!sigue) {
          scanSafe("beep", "fail");
          scanSafe("showLast", codigo + " — cancelado", "fail");
          return;
        }
      }
      agregarALista(r.tubo, codigo);
      if (debeConfirmarDespacho(r)) toast("Sumado con advertencia");
      return;
    }
    if (modo === "despacho" && r.tubo && ["estado_invalido", "ya_en_cliente", "otro_cliente", "esta_vacio", "en_planta"].includes(r.resultado)) {
      const avisos = r.avisos || [r.mensaje || ("Estado: " + (ESTADOS[r.tubo.estado] || r.tubo.estado))];
      const sigue = await confirmarAdvertenciaDespacho({ ...r, avisos, mensaje: avisos.join(" ") + " ¿Proseguir igual?" });
      if (!sigue) {
        scanSafe("beep", "fail");
        return;
      }
      agregarALista(r.tubo, codigo);
      toast("Sumado con advertencia");
      return;
    }
    if (modo === "despacho" && (r.resultado === "no_encontrado" || r.resultado === "nuevo")) {
      const clave = "n:" + codigo;
      const ok = agregarALista(
        {
          id: null,
          nuevo: true,
          numero: "",
          codigo_proveedor: codigo,
          articulo_descripcion: "No registrado en la base",
          propiedad: "empresa",
          estado: "cargado",
          codigo_leido: codigo,
        },
        codigo,
      );
      if (ok) modalRegistrarDesdeScan(codigo, clave, { contexto: "cliente" });
      return;
    }
    scanSafe("beep", "fail");
    const msgs = {
      no_encontrado: "No está en el sistema",
      ya_en_cliente: r.mensaje || ("Ese tubo ya está en " + (r.tubo?.cliente_nombre || "un cliente")),
      otro_cliente: r.mensaje || ("Está asignado a " + (r.tubo?.cliente_nombre || "otro cliente")),
      esta_vacio: r.mensaje || "Ese tubo está vacío: hay que cargarlo antes",
      en_planta: r.mensaje || "Ese tubo está en planta: no se puede despachar a cliente",
      estado_invalido: r.mensaje || (modo === "despacho"
        ? "Solo se despachan tubos cargados en empresa (estado: " + (ESTADOS[r.tubo?.estado] || r.tubo?.estado || "?") + ")"
        : "Estado inválido"),
      no_en_cliente: "Ese tubo no figura en cliente",
    };
    const msg = msgs[r.resultado] || r.mensaje || "No se pudo leer";
    scanSafe("showLast", codigo + " — " + msg, "fail");
    toast(msg, true);
  } catch (err) {
    scanSafe("beep", "fail");
    scanSafe("showLast", codigo + " — " + (err.message || "Error"), "fail");
    toast(err.message, true);
  }
}

async function vistaScanCliente(modo, clienteId) {
  setNav("envios");
  const modoKey = "cli-" + modo;
  restoreScanLista({ modo: modoKey, cliente: clienteId });
  if (state.scanModo !== modoKey || String(state.scanCliente) !== String(clienteId)) {
    state.scanLista = [];
    state.scanModo = modoKey;
    state.scanCliente = clienteId;
    clearScanPersist();
  }
  let cli = null;
  try {
    const cliData = await api("/api/clientes/" + clienteId);
    cli = cliData?.cliente || null;
  } catch (err) {
    toast(err.message || "Cliente no encontrado", true);
    location.hash = `#/cliente/${modo}`;
    return;
  }
  if (!cli) {
    toast("Cliente no encontrado", true);
    location.hash = `#/cliente/${modo}`;
    return;
  }
  let deuda = [];
  if (modo === "recepcion") {
    try {
      deuda = (await api("/api/cliente/deuda?cliente_id=" + clienteId)).tubos || [];
    } catch (err) {
      toast(err.message || "No se pudo cargar la deuda del cliente", true);
      deuda = [];
    }
  }
  const recep = modo === "recepcion";
  app().innerHTML = `
    <h1>${recep ? "Recepción de cliente" : "Despacho a cliente"}</h1>
    <p class="lead">${esc(cli.nombre)} — cargá los tubos a mano o activá el escáner continuo cuando lo necesites.</p>
    ${recep
      ? `<p class="lead">Este cliente tiene <strong>${deuda.length}</strong> tubo(s) en su poder. Solo se aceptan esos.</p>`
      : `<p class="lead">Podés despachar <b>cualquier</b> tubo. Si no está cargado o está en otro cliente, te pide confirmación.</p>`}
    ${recep && deuda.length ? `
      <div class="card" style="margin-bottom:12px">
        <h3 style="margin:0 0 8px">Tubos en su poder</h3>
        <p class="lead" style="margin:0 0 10px">Tocá <b>Sumar</b> o escaneá / cargá el código.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Nº tubo</th><th>Cód.</th><th>Artículo</th><th></th></tr></thead>
          <tbody>
            ${deuda.map((t) => `
              <tr>
                <td class="mono">${esc(t.numero)}</td>
                <td class="mono">${esc(t.codigo_proveedor || "—")}</td>
                <td>${esc(t.articulo_descripcion || t.articulo_codigo || "")}</td>
                <td><button type="button" class="btn secondary" data-add-deuda="${esc(t.codigo_proveedor || t.numero)}">Sumar</button></td>
              </tr>`).join("")}
          </tbody>
        </table></div>
      </div>` : ""}
    <div class="card scan-wrap">
      ${htmlBloqueCamara("Tocá <b>Activar escáner continuo</b> si querés leer con la cámara.")}
      <div id="scan-last" class="scan-last" hidden></div>
      <form id="manual" class="toolbar">
        <div class="field" style="flex:1"><label>Carga manual</label>
          <input name="codigo" placeholder="Número de tubo o código de proveedor" autocomplete="off" autofocus>
        </div>
        <button class="btn" type="submit">Agregar</button>
      </form>
      <div class="scan-count">En lista: <span id="scan-n">${state.scanLista.length}</span></div>
      <div id="lista-scan">${htmlListaScan()}</div>
      <div class="toolbar">
        <button class="btn copper" type="button" id="btn-seguir">Siguiente: confirmar</button>
        <a class="btn ghost" href="#/cliente/${modo}">Cambiar cliente</a>
      </div>
    </div>`;
  pintarListaScan();
  enlazarCamaraScan((code) => procesarCodigoCliente(code, modo, clienteId));
  $("#manual").onsubmit = (e) => {
    e.preventDefault();
    const c = e.target.codigo.value.trim();
    e.target.codigo.value = "";
    if (c) procesarCodigoCliente(c, modo, clienteId);
  };
  document.querySelectorAll("[data-add-deuda]").forEach((btn) => {
    btn.onclick = () => procesarCodigoCliente(btn.getAttribute("data-add-deuda"), modo, clienteId);
  });
  $("#btn-seguir").onclick = async () => {
    if (!state.scanLista.length) return toast("La lista está vacía", true);
    persistScanLista();
    if (esMovil()) {
      try { await scanSafe("stop"); } catch (_) {}
    }
    location.hash = `#/cliente/${modo}/${clienteId}/confirmar`;
  };
}

async function vistaConfirmarCliente(modo, clienteId) {
  setNav("envios");
  const recep = modo === "recepcion";
  restoreScanLista({ modo: "cli-" + modo, cliente: clienteId });
  if (!state.scanLista.length) {
    location.hash = `#/cliente/${modo}/${clienteId}`;
    return;
  }
  const cliData = await api("/api/clientes/" + clienteId).catch(() => null);
  const cli = cliData?.cliente;
  app().innerHTML = `
    <h1>Confirmar ${recep ? "recepción" : "despacho"}</h1>
    <p class="lead">${esc(cli?.nombre || "")} · ${state.scanLista.length} tubo(s)</p>
    <div class="card">
      <form id="form-cli-doc" class="grid form">
        <div class="field"><label>Nº remito / nota</label><input name="remito" placeholder="Opcional"></div>
        <div class="field"><label>Quién opera</label><input value="${esc(state.usuario?.nombre || "")}" disabled></div>
        <div class="field"><label>Fecha</label><input name="fecha" type="date" value="${hoyInput()}"></div>
        <div class="field full"><label>Observaciones</label><textarea name="observaciones" rows="2"></textarea></div>
        <div class="field full"><button class="btn copper" type="submit">Guardar ${recep ? "recepción" : "despacho"}</button></div>
      </form>
      <div id="lista-scan">${htmlListaScan()}</div>
    </div>`;
  pintarListaScan();
  $("#form-cli-doc").onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const tubo_ids = state.scanLista.filter((t) => t.id).map((t) => t.id);
    if (!tubo_ids.length) return toast("No hay tubos válidos en la lista", true);
    const obs = [fd.remito ? "Remito " + fd.remito : "", fd.observaciones || ""].filter(Boolean).join(" · ");
    try {
      const url = recep ? "/api/operaciones/recibir-cliente" : "/api/operaciones/enviar-cliente";
      const body = { tubo_ids, fecha: fd.fecha, observaciones: obs };
      if (!recep) body.cliente_id = Number(clienteId);
      const r = await api(url, { method: "POST", body });
      toast(`Guardado: ${r.cantidad} tubo(s)`);
      state.scanLista = [];
      state.scanModo = null;
      state.scanCliente = null;
      clearScanPersist();
      location.hash = "#/inicio";
    } catch (err) { toast(err.message, true); }
  };
}

function avanceReparto(r) {
  const hechas = Number(r.paradas_hechas || 0);
  const total = Number(r.paradas_total || 0);
  if (!total) return { ok: true, texto: "Sin paradas", clase: "", faltan: 0 };
  if (hechas >= total) return { ok: true, texto: "Completo", clase: "badge-okfact", faltan: 0 };
  return {
    ok: false,
    texto: hechas ? `Incompleto (${hechas}/${total})` : `Sin marcar (0/${total})`,
    clase: "badge-warn-rep",
    faltan: total - hechas,
  };
}

async function vistaReparto(params) {
  setNav("reparto");
  const id = params.get("ver");
  if (id) return vistaRepartoDetalle(id);
  const data = await api("/api/repartos");
  const incompletos = (data.repartos || []).filter((r) => !avanceReparto(r).ok);
  app().innerHTML = `
    <h1>Reparto</h1>
    ${puede("admin") ? `<div class="toolbar"><a class="btn copper" href="#/reparto/nuevo">Armar reparto del día</a>
      <a class="btn ghost" href="#/reparto/permisos">Qué puede ver el chofer</a></div>` : ""}
    ${incompletos.length
      ? `<div class="alerta-reparto" role="alert">⚠ ${incompletos.length} reparto(s) con paradas sin marcar como hechas por el chofer.</div>`
      : ""}
    <div class="card">
      ${data.repartos.length ? `<table>
        <thead><tr><th>Fecha</th><th>Chofer</th><th>Estado</th><th>Paradas</th><th>Avance</th><th></th></tr></thead>
        <tbody>${data.repartos.map((r) => {
          const av = avanceReparto(r);
          return `
          <tr class="${av.ok ? "" : "fila-reparto-pend"}">
            <td class="mono">${fmtFecha(r.fecha)}</td>
            <td>${esc(r.chofer || "Sin asignar")}</td>
            <td>${esc(r.estado)}</td>
            <td class="mono">${Number(r.paradas_hechas || 0)}/${Number(r.paradas_total || 0)}</td>
            <td><span class="badge ${av.clase}">${esc(av.texto)}</span></td>
            <td><a class="btn" href="#/reparto?ver=${r.id}">Abrir</a></td>
          </tr>`;
        }).join("")}</tbody>
      </table>` : `<p class="empty">No hay repartos cargados.</p>`}
    </div>`;
}

function horaCorta(ts) {
  const s = String(ts || "");
  if (s.length >= 16) return s.slice(11, 16);
  return s || "—";
}

function direccionMaps(p) {
  return [p.direccion, p.localidad].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
}

function urlMapsAbrir(q) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
}

function urlMapsEmbed(q) {
  return "https://maps.google.com/maps?q=" + encodeURIComponent(q) + "&z=15&output=embed";
}

function htmlMapaParada(p) {
  const q = direccionMaps(p);
  if (!q) return `<p class="lead" style="margin:8px 0">Sin dirección cargada para el mapa.</p>`;
  return `
    <div class="parada-mapa">
      <iframe title="Mapa" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
        src="${esc(urlMapsEmbed(q))}"></iframe>
      <a class="btn secondary btn-maps" href="${esc(urlMapsAbrir(q))}" target="_blank" rel="noopener">Abrir en Maps</a>
    </div>`;
}

function htmlResumenTubosParada(p) {
  const gn = Number(p.tubos_gn || 0);
  const propios = Number(p.tubos_propios || 0);
  if (!gn && !propios) return `<p class="parada-tubos-resumen">Sin tubos en el cliente ahora</p>`;
  return `<p class="parada-tubos-resumen"><strong>${gn}</strong> GN · <strong>${propios}</strong> propios</p>`;
}

async function vistaRepartoDetalle(id) {
  const data = await api("/api/repartos/" + id);
  const r = data.reparto;
  const pintar = () => {
    const hechas = (data.paradas || []).filter((p) => p.completada).length;
    const total = (data.paradas || []).length;
    const faltan = Math.max(0, total - hechas);
    const completo = total > 0 && faltan === 0;
    app().innerHTML = `
      <h1>Hoja de ruta ${fmtFecha(r.fecha)}</h1>
      <p class="lead">${esc(r.chofer || "Sin chofer asignado")}${r.observaciones ? " · " + esc(r.observaciones) : ""}</p>
      <p class="lead"><strong>${hechas}/${total}</strong> paradas hechas · ${esc(r.estado || "")}</p>
      ${total && !completo
        ? `<div class="alerta-reparto" role="alert">⚠ Advertencia: ${esc(r.chofer || "el chofer")} no marcó todas las paradas. Faltan <strong>${faltan}</strong> de ${total}.</div>`
        : completo
          ? `<div class="ok-reparto">✓ Todas las paradas fueron marcadas como hechas.</div>`
          : ""}
      <p><a href="#/reparto">← Volver</a></p>
      ${(data.paradas || []).map((p, i) => `
        <div class="card parada-card ${p.completada ? "hecha" : "pendiente"}" style="margin-bottom:12px">
          <div class="parada-top">
            <h3>${i + 1}. ${esc(p.nombre)}</h3>
            ${p.completada
              ? `<span class="badge badge-okfact">Hecha ${horaCorta(p.completada_en)}</span>`
              : `<span class="badge badge-warn-rep">Pendiente</span>`}
          </div>
          ${!p.completada ? `<p class="parada-aviso-pend">Esta parada aún no fue marcada como completada.</p>` : ""}
          ${htmlResumenTubosParada(p)}
          ${p.direccion ? `<p>${esc(p.direccion)} ${esc(p.localidad || "")}</p>` : ""}
          ${p.telefono ? `<p>Tel: <a href="tel:${esc(p.telefono)}">${esc(p.telefono)}</a></p>` : ""}
          ${htmlMapaParada(p)}
          ${p.cliente_id && puede("admin", "reparto") ? `
            <div class="parada-ops">
              <a class="btn btn-parada-despacho" href="#/cliente/despacho/${p.cliente_id}">Despacho a este cliente</a>
              ${(Number(p.tubos_gn || 0) + Number(p.tubos_propios || 0)) > 0
                ? `<a class="btn btn-parada-recepcion" href="#/cliente/recepcion/${p.cliente_id}">Recepción de este cliente</a>`
                : `<span class="btn btn-parada-recepcion off" title="Sin tubos en su poder">Sin tubos para recibir</span>`}
            </div>` : ""}
          <ul>${(p.tareas || []).map((t) => `<li>${esc({ recarga_propios: "Recarga envases propios", recambio_gn: "Recambio GN", retiro_equipo: "Retiro de equipo", entrega_equipo: "Entrega de equipo", tarea: "Tarea" }[t.tipo] || t.tipo)}${t.detalle ? " — " + esc(t.detalle) : ""}</li>`).join("")}</ul>
          ${p.tubos && p.tubos.length ? `<p class="lead">Detalle: ${p.tubos.map((t) => esc(t.numero)).join(", ")}</p>` : ""}
          <div class="field parada-comentario">
            <label>Comentario / nota (opcional)</label>
            <textarea data-comentario="${p.id}" rows="2" placeholder="Ej: no había nadie, dejé en portería…">${esc(p.comentario || "")}</textarea>
            <button type="button" class="btn ghost" data-guardar-nota="${p.id}">Guardar nota</button>
          </div>
          ${p.completada
            ? `<div class="parada-ok-box">Completada a las <strong>${horaCorta(p.completada_en)}</strong>
                <button type="button" class="btn ghost" data-parada="${p.id}" data-ok="0">Desmarcar</button>
               </div>`
            : `<button type="button" class="btn btn-parada-ok" data-parada="${p.id}" data-ok="1">✓ Ya pasé · Hecho</button>`}
        </div>`).join("") || `<p class="empty">Sin paradas.</p>`}`;
    const leerNota = (pid) => {
      const ta = app().querySelector(`textarea[data-comentario="${pid}"]`);
      return ta ? String(ta.value || "").trim() : "";
    };
    app().querySelectorAll("[data-guardar-nota]").forEach((b) => {
      b.onclick = async () => {
        const pid = b.dataset.guardarNota;
        try {
          const res = await api(`/api/repartos/${id}/paradas/${pid}`, {
            method: "PUT",
            body: { comentario: leerNota(pid) },
          });
          const idx = data.paradas.findIndex((x) => String(x.id) === String(pid));
          if (idx >= 0 && res.parada) data.paradas[idx] = res.parada;
          toast("Nota guardada");
          pintar();
        } catch (err) { toast(err.message, true); }
      };
    });
    app().querySelectorAll("[data-parada]").forEach((b) => {
      b.onclick = async () => {
        try {
          const body = { completada: b.dataset.ok === "1" };
          if (b.dataset.ok === "1") body.comentario = leerNota(b.dataset.parada);
          const res = await api(`/api/repartos/${id}/paradas/${b.dataset.parada}`, {
            method: "PUT",
            body,
          });
          const idx = data.paradas.findIndex((x) => String(x.id) === String(b.dataset.parada));
          if (idx >= 0 && res.parada) data.paradas[idx] = res.parada;
          r.estado = res.estado || r.estado;
          if (navigator.vibrate) navigator.vibrate(40);
          toast(b.dataset.ok === "1" ? "Parada marcada" : "Parada desmarcada");
          pintar();
        } catch (err) { toast(err.message, true); }
      };
    });
  };
  pintar();
}

async function vistaRepartoNuevo() {
  setNav("reparto");
  const [usus, campos] = await Promise.all([api("/api/usuarios").catch(() => ({ usuarios: [] })), api("/api/reparto/campos")]);
  const choferes = (usus.usuarios || []).filter((u) => u.rol === "reparto" || u.rol === "admin");
  state._paradas = [];
  app().innerHTML = `
    <h1>Armar reparto del día</h1>
    <form id="form-rep" class="card grid form">
      <div class="field"><label>Fecha</label><input name="fecha" type="date" value="${hoyInput()}"></div>
      <div class="field"><label>Chofer / reparto</label>
        <select name="usuario_id"><option value="">Sin asignar</option>${choferes.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join("")}</select>
      </div>
      <div class="field full"><label>Notas</label><input name="observaciones"></div>
    </form>
    <div class="card">
      <h3>Paradas</h3>
      <form id="add-par" class="toolbar">
        <div class="field" style="flex:1"><label>Buscar cliente</label><input id="q-cli" placeholder="Nombre"></div>
        <button class="btn" type="submit">Buscar</button>
      </form>
      <div id="res-cli"></div>
      <div id="paradas"></div>
      <button class="btn copper" type="button" id="guardar-rep">Guardar reparto</button>
    </div>`;
  const pintar = () => {
    $("#paradas").innerHTML = state._paradas.map((p, i) => `
      <div class="card" style="margin:8px 0">
        <strong>${i + 1}. ${esc(p.nombre)}</strong>
        ${(p.tareas || []).map((t) => `<div class="lead">${esc(t.tipo)} ${esc(t.detalle || "")}</div>`).join("")}
        <form data-i="${i}" class="toolbar add-tar">
          <select name="tipo">
            <option value="recarga_propios">Recarga envases propios</option>
            <option value="recambio_gn">Recambio GN</option>
            <option value="retiro_equipo">Retiro de equipo</option>
            <option value="entrega_equipo">Entrega de equipo</option>
            <option value="tarea">Tarea</option>
          </select>
          <input name="detalle" placeholder="Detalle">
          <button class="btn secondary" type="submit">Agregar tarea</button>
        </form>
      </div>`).join("") || `<p class="empty">Agregue clientes.</p>`;
    app().querySelectorAll(".add-tar").forEach((f) => {
      f.onsubmit = (e) => {
        e.preventDefault();
        const i = Number(f.dataset.i);
        const fd = new FormData(f);
        state._paradas[i].tareas.push({ tipo: fd.get("tipo"), detalle: fd.get("detalle") });
        pintar();
      };
    });
  };
  pintar();
  $("#add-par").onsubmit = async (e) => {
    e.preventDefault();
    const q = $("#q-cli").value.trim();
    const r = await api("/api/clientes?q=" + encodeURIComponent(q));
    $("#res-cli").innerHTML = r.clientes.slice(0, 12).map((c) => `<button type="button" class="btn ghost" data-cid="${c.id}" data-nom="${esc(c.nombre)}">${esc(c.nombre)}</button>`).join(" ");
    $("#res-cli").querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        state._paradas.push({ cliente_id: Number(b.dataset.cid), nombre: b.dataset.nom, tareas: [] });
        pintar();
      };
    });
  };
  $("#guardar-rep").onclick = async () => {
    const fd = new FormData($("#form-rep"));
    try {
      await api("/api/repartos", { method: "POST", body: {
        fecha: fd.get("fecha"), usuario_id: fd.get("usuario_id"), observaciones: fd.get("observaciones"),
        paradas: state._paradas,
      }});
      toast("Reparto guardado");
      location.hash = "#/reparto";
    } catch (err) { toast(err.message, true); }
  };
}

async function vistaRepartoPermisos() {
  const data = await api("/api/reparto/campos");
  const c = data.campos || {};
  app().innerHTML = `
    <h1>Información visible para reparto</h1>
    <form id="form-cam" class="card">
      ${["direccion", "telefono", "localidad", "tubos"].map((k) => `
        <label style="display:block;margin:8px 0"><input type="checkbox" name="${k}" ${c[k] ? "checked" : ""}> ${k}</label>
      `).join("")}
      <button class="btn" type="submit">Guardar</button>
    </form>`;
  $("#form-cam").onsubmit = async (e) => {
    e.preventDefault();
    const body = {};
    ["direccion", "telefono", "localidad", "tubos"].forEach((k) => { body[k] = !!e.target[k].checked; });
    await api("/api/reparto/campos", { method: "PUT", body });
    toast("Permisos de reparto actualizados");
  };
}

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function cajaInicial() {
  return {
    modo: "gas",
    gas: null,
    cantidad: 1,
    facturar: false,
    cliente: null,
    nuevo: false,
    descripcion: "",
    monto: "",
    totalOverride: null,
    medioPago: "efectivo",
    filtroHoy: "",
    ultimaId: null,
    precios: [],
    ventas: [],
    resumen: {},
    recientes: [],
  };
}

function etiquetaMedio(m) {
  const k = String(m || "efectivo").toLowerCase();
  if (k === "transferencia") return "Transferencia";
  if (k === "tarjeta") return "Tarjeta";
  if (k === "cheque") return "Cheque";
  if (k === "echeq") return "ECHEQ";
  if (k === "mixto") return "Mixto";
  if (!k) return "";
  return "Efectivo";
}

function htmlMedioPago() {
  const c = state.caja;
  if (c.modo === "salida") return "";
  const medios = [
    ["efectivo", "Efectivo"],
    ["transferencia", "Transfer."],
    ["tarjeta", "Tarjeta"],
    ["cheque", "Cheque"],
    ["echeq", "ECHEQ"],
  ];
  return `
    <div class="caja-medios-inline">
      ${medios.map(([id, nom]) => `
        <button type="button" class="btn big-soft ${c.medioPago === id ? "on" : ""}" data-act="medio" data-medio="${id}">${nom}</button>
      `).join("")}
    </div>`;
}

function precioCaja(tipo, gas) {
  const clave = (tipo === "regulador" ? "reg:" : "gas:") + gas;
  return (state.caja?.precios || []).find((p) => p.clave === clave) || null;
}

function unidadGasCaja(p) {
  const u = String(p?.unidad || "m3").toLowerCase();
  if (u === "kg" || u === "kilo" || u === "kilos") return "kg";
  return "m³";
}

const CANT_GAS_RAPIDA = [0.5, 1, 2, 3, 4, 6, 10];

function parseMonto(valor) {
  let s = String(valor ?? "").trim().replace(/\s/g, "").replace("$", "");
  if (!s) return NaN;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function totalListaCaja() {
  const c = state.caja;
  if (!c || (c.modo !== "gas" && c.modo !== "regulador")) return 0;
  const p = precioCaja(c.modo, c.gas);
  if (!p || !c.gas) return 0;
  return Math.round(Number(c.cantidad) * Number(p.precio) * 100) / 100;
}

function totalCaja() {
  const c = state.caja;
  if (!c) return 0;
  if (c.modo === "gas" || c.modo === "regulador") {
    if (c.totalOverride != null && String(c.totalOverride).trim() !== "") {
      const n = parseMonto(c.totalOverride);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return totalListaCaja();
  }
  return parseMonto(c.monto) || 0;
}

function leerCajaDom() {
  const c = state.caja;
  if (!c) return;
  const d = $("#caja-desc");
  if (d) c.descripcion = d.value;
  const t = $("#caja-total");
  if (t && (c.modo === "gas" || c.modo === "regulador")) {
    const raw = String(t.value || "").trim();
    c.totalOverride = raw || null;
  }
}

function htmlGases(tipo) {
  const lista = (state.caja.precios || []).filter((p) => p.tipo === tipo);
  return `<div class="gas-grid">${lista.map((p) => {
    const sel = state.caja.gas === p.gas ? "sel" : "";
    const precio = Number(p.precio) > 0 ? money(p.precio) : "Sin precio";
    const sub = tipo === "gas" ? `por ${unidadGasCaja(p)}` : "cada uno";
    const nombre = String(p.nombre || "").replace(/^Regulador\s+/i, "");
    return `<button type="button" class="gas-card ${sel}" data-act="gas" data-gas="${esc(p.gas)}">
      <span class="gn">${esc(nombre)}</span>
      <span class="precio">${esc(precio)}</span>
      <small>${sub}</small>
    </button>`;
  }).join("")}</div>`;
}

function fmtCantCaja(n) {
  const x = Math.round(Number(n) * 100) / 100;
  if (!Number.isFinite(x)) return "0";
  return String(x).replace(".", ",");
}

function htmlCantidad(esGas) {
  const n = Math.round(Number(state.caja.cantidad) * 100) / 100;
  const p = esGas ? precioCaja("gas", state.caja.gas) : null;
  const unidad = esGas ? unidadGasCaja(p) : "";
  const rapidos = esGas ? CANT_GAS_RAPIDA : [1, 2, 3];
  const step = esGas ? 0.5 : 1;
  const sufijo = unidad ? ` ${unidad}` : "";
  return `
    <div class="cant-rapida cant-rapida-compact">
      ${rapidos.map((q) => `<button type="button" class="btn big-soft ${n === q ? "on" : ""}" data-act="setcant" data-n="${q}">${fmtCantCaja(q)}</button>`).join("")}
    </div>
    <div class="metro-box metro-box-compact">
      <button type="button" class="btn big-soft" data-act="cant" data-d="${-step}" aria-label="Menos">−</button>
      <div class="n">${fmtCantCaja(n)}${unidad ? `<small>${sufijo}</small>` : ""}</div>
      <button type="button" class="btn big-soft" data-act="cant" data-d="${step}" aria-label="Más">+</button>
    </div>`;
}

function htmlCliente() {
  const c = state.caja.cliente;
  if (c) {
    return `<div class="cliente-elegido"><div><strong>${esc(c.nombre)}</strong><br><small>${esc(c.cuit || "")}</small></div>
      <button type="button" class="btn ghost" data-act="quitar-cli">Cambiar</button></div>`;
  }
  const recientes = state.caja.recientes || [];
  return `
    <p class="caja-label">Cliente</p>
    ${recientes.length ? `<div class="cant-rapida clientes-rapidos">${recientes.map((r) => `
      <button type="button" class="btn big-soft" data-act="cli" data-id="${r.id}" data-nombre="${esc(r.nombre)}" data-cuit="${esc(r.cuit || "")}" data-dir="${esc(r.direccion || "")}">${esc(r.nombre)}</button>
    `).join("")}</div>` : ""}
    <div class="field"><label>Buscar por nombre o CUIT</label>
      <input id="cli-q" type="search" placeholder="Escribí para buscar" autocomplete="off">
    </div>
    <div id="cli-res" class="cant-rapida clientes-rapidos"></div>
    <button type="button" class="btn big-soft" data-act="nuevo">${state.caja.nuevo ? "Cancelar cliente nuevo" : "Cliente nuevo"}</button>
    ${state.caja.nuevo ? `
      <div class="field"><label>Nombre o razón social</label><input id="cli-nom" autocomplete="name"></div>
      <div class="field"><label>CUIT</label><input id="cli-cuit" inputmode="numeric" autocomplete="off"></div>
      <div class="field"><label>Dirección</label><input id="cli-dir" autocomplete="street-address"></div>
    ` : ""}`;
}

function htmlFacturarCaja() {
  if (state.caja.modo === "salida") return "";
  const on = state.caja.facturar;
  return `
    <div class="facturar-mini-wrap">
      <button type="button" class="btn btn-fact-mini ${on ? "on" : ""}" data-act="facturar">
        ${on ? "✓ Con factura" : "Facturar"}
      </button>
    </div>
    ${on ? htmlCliente() : ""}`;
}

function htmlPad() {
  const teclas = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "b"];
  return `<div class="pad">${teclas.map((k) => {
    const label = k === "b" ? "⌫" : k === "," ? "," : k;
    return `<button type="button" data-act="dig" data-k="${k}">${label}</button>`;
  }).join("")}</div>
  <button type="button" class="btn ghost" data-act="dig" data-k="c" style="width:100%;margin-top:6px">Borrar importe</button>`;
}

function htmlAccionCobrar() {
  const c = state.caja;
  if (c.modo === "gas" || c.modo === "regulador") {
    if (!c.gas) return "";
    const lista = totalListaCaja();
    const total = totalCaja();
    const totalTxt = String(total).replace(".", ",");
    const ajustado = Math.abs(total - lista) > 0.009;
    return `
      <div class="caja-accion-bar">
        <div class="caja-accion-total">
          <label for="caja-total">Total ${ajustado ? `<small>(lista ${money(lista)})</small>` : ""}</label>
          <input id="caja-total" class="total-edit-input" inputmode="decimal" value="${esc(totalTxt)}" aria-label="Total a cobrar">
          ${ajustado ? `<button type="button" class="btn ghost btn-reset-total" data-act="reset-total">Volver a lista</button>` : ""}
        </div>
        ${htmlMedioPago()}
        ${htmlFacturarCaja()}
        <button type="button" class="btn btn-grabar" data-act="grabar">Grabar venta</button>
      </div>`;
  }
  if (c.modo === "general") {
    return `
      <div class="caja-accion-bar">
        ${htmlMedioPago()}
        ${htmlFacturarCaja()}
        <button type="button" class="btn btn-grabar" data-act="grabar">Grabar venta</button>
      </div>`;
  }
  return `
    <div class="caja-accion-bar">
      <button type="button" class="btn btn-grabar" style="background:#9b2c2c" data-act="grabar">Grabar salida</button>
    </div>`;
}

function htmlPanelCaja() {
  const c = state.caja;
  if (c.modo === "gas" || c.modo === "regulador") {
    return `
      ${htmlGases(c.modo)}
      ${c.gas ? htmlCantidad(c.modo === "gas") : `<p class="lead caja-hint">Elegí el gas</p>`}
      ${htmlAccionCobrar()}`;
  }
  if (c.modo === "general") {
    return `
      <div class="field"><label>Qué se vendió</label>
        <textarea id="caja-desc" rows="2" style="font-size:1.1rem">${esc(c.descripcion)}</textarea>
      </div>
      <p class="caja-label">Precio ${c.monto ? money(totalCaja()) : ""}</p>
      ${htmlPad()}
      ${htmlAccionCobrar()}`;
  }
  const presets = ["Combustible", "Peaje", "Comida", "Varios"];
  return `
    <div class="cant-rapida cant-rapida-compact">
      ${presets.map((t) => `<button type="button" class="btn big-soft ${c.descripcion === t ? "on" : ""}" data-act="preset" data-txt="${esc(t)}">${esc(t)}</button>`).join("")}
    </div>
    <div class="field"><label>Otro motivo</label>
      <input id="caja-desc" value="${esc(c.descripcion)}" style="font-size:1.1rem">
    </div>
    <p class="caja-label">Importe ${c.monto ? money(totalCaja()) : ""}</p>
    ${htmlPad()}
    ${htmlAccionCobrar()}`;
}

function etiquetaMov(v) {
  if (v.tipo === "salida") return `<span class="badge badge-salida">Salida</span>`;
  if (v.estado_factura === "pendiente") return `<span class="badge badge-fact">Para facturar</span>`;
  if (v.estado_factura === "facturado") return `<span class="badge badge-okfact">Facturado</span>`;
  return `<span class="badge">Contado</span>`;
}

function pintarCobrar() {
  const c = state.caja;
  const modos = [
    ["gas", "Gas"],
    ["regulador", "Regulador"],
    ["general", "Otra"],
    ["salida", "Salida"],
  ];
  const todas = c.ventas || [];
  const pendientes = todas.filter((v) => v.estado_factura === "pendiente");
  const lista = c.filtroHoy === "pendiente" ? pendientes : todas;
  const ultimaId = c.ultimaId || (todas[0] && todas[0].id);
  app().innerHTML = `
    <div class="caja-screen">
      <div class="caja-cobro">
        <div class="caja-cobro-head">
          <h1 class="caja-title">Cobrar</h1>
          <div class="caja-head-links">
            <a class="btn secondary btn-caja-fact" href="#/deudas">Deudas</a>
            <a class="btn secondary btn-caja-fact" href="#/facturar">Facturar</a>
            <a class="btn secondary btn-caja-fact" href="#/facturacion?desde=${hoyInput()}&hasta=${hoyInput()}">Resumen</a>
          </div>
        </div>
        ${htmlBannerDeudas(c.alertas)}
        ${(c.precios || []).some((p) => Number(p.precio) > 0) ? "" : `<div class="banner-fact">Faltan los precios. Pedile al administrador que los cargue en Facturación.</div>`}
        <div class="caja-modos" id="caja-root-modos">
          ${modos.map(([id, nom]) => `<button type="button" class="btn big-soft ${c.modo === id ? "active" : ""}" data-act="modo" data-modo="${id}">${nom}</button>`).join("")}
        </div>
        <div class="card caja-venta" id="caja-root">
          ${htmlPanelCaja()}
        </div>
      </div>
      <div class="card caja-historial">
        <div class="caja-hist-head">
          <h3>Historial del día</h3>
          <div class="cant-rapida filtro-hoy">
            <button type="button" class="btn secondary ${!c.filtroHoy ? "on" : ""}" data-act="filtro-hoy" data-filtro="">Todas (${todas.length})</button>
            <button type="button" class="btn secondary ${c.filtroHoy === "pendiente" ? "on" : ""}" data-act="filtro-hoy" data-filtro="pendiente">A facturar (${pendientes.length})</button>
          </div>
        </div>
        <ul class="lista-dia">
          ${lista.map((v) => {
            const esUltima = Number(v.id) === Number(ultimaId);
            const esPend = v.estado_factura === "pendiente";
            const clases = [
              "venta-dia",
              esUltima ? "ultima" : "",
              esPend ? "para-facturar" : "",
              v.tipo === "salida" ? "es-salida" : "",
            ].filter(Boolean).join(" ");
            return `<li class="${clases}" data-vid="${v.id}">
              <div class="venta-dia-main">
                <div>
                  ${esUltima ? `<span class="badge badge-ultima">Última</span> ` : ""}
                  <strong>${esc(v.hora)}</strong> · ${esc(v.descripcion)}
                  ${v.cliente_nombre ? `<br><small>${esc(v.cliente_nombre)}</small>` : ""}
                  ${v.tipo !== "salida" ? `<br><small>${esc(etiquetaMedio(v.medio_pago))}</small>` : ""}
                </div>
                <div class="venta-dia-monto">
                  ${etiquetaMov(v)}
                  <strong>${v.tipo === "salida" ? "−" : ""}${money(v.total)}</strong>
                </div>
              </div>
              <div class="venta-dia-acciones">
                <button type="button" class="btn ghost" data-act="ed-v" data-id="${v.id}">Editar</button>
                ${esPend ? `<button type="button" class="btn secondary" data-act="quit-fact" data-id="${v.id}">Quitar de facturar</button>` : ""}
                <button type="button" class="btn ghost" data-act="del-v" data-id="${v.id}" style="color:#9b2c2c">Borrar</button>
              </div>
            </li>`;
          }).join("") || `<li class="empty">Todavía no hay movimientos hoy.</li>`}
        </ul>
      </div>
    </div>`;
  const root = app();
  root.onclick = onCajaClick;
  const q = $("#cli-q");
  if (q) {
    let timer;
    q.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const s = q.value.trim();
        const box = $("#cli-res");
        if (!box) return;
        if (s.length < 2) { box.innerHTML = ""; return; }
        try {
          const res = await api("/api/clientes?q=" + encodeURIComponent(s));
          box.innerHTML = res.clientes.slice(0, 8).map((cli) => `
            <button type="button" class="btn big-soft" data-act="cli" data-id="${cli.id}" data-nombre="${esc(cli.nombre)}" data-cuit="${esc(cli.cuit || "")}" data-dir="${esc(cli.direccion || "")}">${esc(cli.nombre)}</button>
          `).join("") || `<p class="empty">No está en la lista. Usá Cliente nuevo.</p>`;
        } catch (err) { toast(err.message, true); }
      }, 250);
    };
  }
}

function onCajaClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn || !state.caja) return;
  leerCajaDom();
  const act = btn.dataset.act;
  const c = state.caja;
  if (act === "modo") {
    c.modo = btn.dataset.modo;
    c.gas = null;
    c.cantidad = 1;
    c.facturar = false;
    c.cliente = null;
    c.nuevo = false;
    c.monto = "";
    c.descripcion = "";
    c.totalOverride = null;
    pintarCobrar();
  } else if (act === "medio") {
    c.medioPago = btn.dataset.medio || "efectivo";
    pintarCobrar();
  } else if (act === "filtro-hoy") {
    c.filtroHoy = btn.dataset.filtro || "";
    pintarCobrar();
  } else if (act === "ed-v") {
    const v = (c.ventas || []).find((x) => String(x.id) === String(btn.dataset.id));
    if (v) abrirEdicionVenta(v, true);
  } else if (act === "quit-fact") {
    (async () => {
      try {
        await api("/api/caja/ventas/" + btn.dataset.id, {
          method: "PUT",
          body: { facturar: false, estado_factura: "no" },
        });
        toast("Quitada de facturar");
        await vistaCobrar();
      } catch (err) { toast(err.message, true); }
    })();
  } else if (act === "del-v") {
    if (!confirm("¿Borrar esta venta de hoy?")) return;
    (async () => {
      try {
        await api("/api/caja/ventas/" + btn.dataset.id, { method: "DELETE" });
        toast("Venta borrada");
        if (Number(c.ultimaId) === Number(btn.dataset.id)) c.ultimaId = null;
        await vistaCobrar();
      } catch (err) { toast(err.message, true); }
    })();
  } else if (act === "gas") {
    c.gas = btn.dataset.gas;
    c.totalOverride = null;
    pintarCobrar();
  } else if (act === "cant") {
    const step = Number(btn.dataset.d || 0);
    const min = c.modo === "gas" ? 0.5 : 1;
    const next = Math.round((Number(c.cantidad) + step) * 100) / 100;
    c.cantidad = Math.max(min, next);
    c.totalOverride = null;
    pintarCobrar();
  } else if (act === "setcant") {
    const min = c.modo === "gas" ? 0.5 : 1;
    c.cantidad = Math.max(min, Math.round(Number(btn.dataset.n) * 100) / 100);
    c.totalOverride = null;
    pintarCobrar();
  } else if (act === "reset-total") {
    c.totalOverride = null;
    pintarCobrar();
  } else if (act === "facturar") {
    c.facturar = !c.facturar;
    if (!c.facturar) { c.cliente = null; c.nuevo = false; }
    pintarCobrar();
  } else if (act === "cli") {
    c.cliente = {
      id: Number(btn.dataset.id),
      nombre: btn.dataset.nombre,
      cuit: btn.dataset.cuit || "",
      direccion: btn.dataset.dir || "",
    };
    c.nuevo = false;
    pintarCobrar();
  } else if (act === "quitar-cli") {
    c.cliente = null;
    pintarCobrar();
  } else if (act === "nuevo") {
    c.nuevo = !c.nuevo;
    c.cliente = null;
    pintarCobrar();
    $("#cli-nom")?.focus();
  } else if (act === "preset") {
    c.descripcion = btn.dataset.txt || "";
    pintarCobrar();
  } else if (act === "dig") {
    const k = btn.dataset.k;
    if (k === "c") c.monto = "";
    else if (k === "b") c.monto = String(c.monto).slice(0, -1);
    else if (k === ",") {
      if (!String(c.monto).includes(",")) c.monto = (c.monto || "0") + ",";
    } else if (String(c.monto).length < 12) c.monto += k;
    pintarCobrar();
  } else if (act === "grabar") {
    grabarCaja();
  }
}

async function grabarCaja() {
  leerCajaDom();
  const c = state.caja;
  if ((c.modo === "gas" || c.modo === "regulador") && !c.gas) {
    toast("Elegí el gas", true);
    return;
  }
  const body = {
    tipo: c.modo,
    gas: c.gas,
    cantidad: c.cantidad,
    facturar: c.facturar && c.modo !== "salida",
    descripcion: c.descripcion,
    medio_pago: c.modo === "salida" ? "" : (c.medioPago || "efectivo"),
  };
  if (c.modo === "general" || c.modo === "salida") body.total = c.monto;
  if ((c.modo === "gas" || c.modo === "regulador") && c.gas) {
    const tot = totalCaja();
    if (tot <= 0) {
      toast("Indicá el total a cobrar", true);
      return;
    }
    body.total = tot;
  }
  if (body.facturar) {
    if (c.nuevo) {
      body.cliente_nuevo = {
        nombre: ($("#cli-nom")?.value || "").trim(),
        cuit: ($("#cli-cuit")?.value || "").trim(),
        direccion: ($("#cli-dir")?.value || "").trim(),
      };
    } else if (c.cliente) body.cliente_id = c.cliente.id;
  }
  try {
    const r = await api("/api/caja/ventas", { method: "POST", body });
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    toast(c.modo === "salida" ? "Salida grabada" : "Venta grabada");
    const modo = c.modo;
    const medio = c.medioPago;
    const ultimaId = r.venta?.id || null;
    state.caja = cajaInicial();
    state.caja.modo = modo;
    state.caja.medioPago = medio || "efectivo";
    state.caja.ultimaId = ultimaId;
    await vistaCobrar();
  } catch (err) { toast(err.message, true); }
}

async function vistaCobrar() {
  setNav("cobrar");
  const prev = state.caja || cajaInicial();
  const [data, alertas] = await Promise.all([
    api("/api/caja/ventas"),
    api("/api/caja/alertas").catch(() => ({ alertas: [] })),
  ]);
  state.caja = {
    ...cajaInicial(),
    modo: prev.modo || "gas",
    medioPago: prev.medioPago || "efectivo",
    filtroHoy: prev.filtroHoy || "",
    ultimaId: prev.ultimaId || null,
    precios: data.precios || [],
    ventas: data.ventas || [],
    resumen: data.resumen || {},
    recientes: data.recientes || [],
    alertas: alertas.alertas || [],
  };
  pintarCobrar();
}

function htmlBannerDeudas(alertas) {
  const lista = alertas || [];
  if (!lista.length) return "";
  const top = lista.slice(0, 5);
  return `
    <a class="banner-deuda" href="#/deudas">
      <strong>${lista.length} cliente${lista.length === 1 ? "" : "s"} con deuda</strong>
      <span>${top.map((a) => `${esc(a.cliente_nombre)} · ${money(a.saldo)} · desde ${esc(fmtFecha(a.desde))} (${a.dias}d)`).join(" · ")}</span>
    </a>`;
}

function facturarInicial() {
  return {
    tipo: "factura_x",
    modoPago: "cuenta",
    medioPago: "efectivo",
    cliente: null,
    items: [],
    obs: "",
    tuboQ: "",
    precios: [],
    cheque: { tipo: "cheque", banco: "", numero: "", librador: "", fecha_emision: "", fecha_pago: "", monto: "" },
  };
}

function totalFacturarItems(items) {
  return Math.round((items || []).reduce((s, it) => s + Number(it.cantidad || 0) * Number(it.precio_unitario || 0), 0) * 100) / 100;
}

function htmlChequeForm(prefix, ch, montoHint) {
  const c = ch || {};
  return `
    <div class="card cheque-form" id="${prefix}-cheque">
      <p class="caja-label">Datos del cheque / ECHEQ</p>
      <div class="grid form">
        <div class="field"><label>Tipo</label>
          <select id="${prefix}-ch-tipo">
            <option value="cheque" ${c.tipo !== "echeq" ? "selected" : ""}>Cheque</option>
            <option value="echeq" ${c.tipo === "echeq" ? "selected" : ""}>ECHEQ</option>
          </select>
        </div>
        <div class="field"><label>Número</label><input id="${prefix}-ch-num" value="${esc(c.numero || "")}" required></div>
        <div class="field"><label>Banco</label><input id="${prefix}-ch-banco" value="${esc(c.banco || "")}"></div>
        <div class="field"><label>Librador</label><input id="${prefix}-ch-lib" value="${esc(c.librador || "")}"></div>
        <div class="field"><label>Emisión</label><input id="${prefix}-ch-emi" type="date" value="${esc(c.fecha_emision || "")}"></div>
        <div class="field"><label>Fecha de pago</label><input id="${prefix}-ch-pago" type="date" value="${esc(c.fecha_pago || "")}"></div>
        <div class="field"><label>Monto</label><input id="${prefix}-ch-monto" inputmode="decimal" value="${esc(c.monto || (montoHint != null ? String(montoHint) : ""))}"></div>
      </div>
    </div>`;
}

function leerChequeForm(prefix) {
  return {
    tipo: $("#" + prefix + "-ch-tipo")?.value || "cheque",
    numero: $("#" + prefix + "-ch-num")?.value || "",
    banco: $("#" + prefix + "-ch-banco")?.value || "",
    librador: $("#" + prefix + "-ch-lib")?.value || "",
    fecha_emision: $("#" + prefix + "-ch-emi")?.value || "",
    fecha_pago: $("#" + prefix + "-ch-pago")?.value || "",
    monto: $("#" + prefix + "-ch-monto")?.value || "",
  };
}

async function vistaFacturar(params) {
  setNav("facturar");
  const f = state.facturar || facturarInicial();
  const precios = f.precios?.length
    ? f.precios
    : ((await api("/api/caja/ventas").catch(() => ({ precios: [] }))).precios || []);
  state.facturar = { ...facturarInicial(), ...f, precios };
  const ventaId = params.get("venta_id");
  if (ventaId && !state.facturar._fromVenta) {
    try {
      const data = await api("/api/caja/ventas/" + ventaId + "/a-comprobante", {
        method: "POST",
        body: { tipo: "factura_x" },
      });
      toast("Comprobante " + (data.comprobante?.numero_txt || "") + " creado a cuenta corriente");
      location.hash = "#/deudas?cliente_id=" + data.comprobante.cliente_id;
      return;
    } catch (err) {
      toast(err.message, true);
    }
  }
  pintarFacturar();
}

function pintarFacturar() {
  const f = state.facturar;
  const total = totalFacturarItems(f.items);
  const gases = (f.precios || []).filter((p) => p.tipo === "gas");
  app().innerHTML = `
    <h1>Facturar</h1>
    <p class="lead">Comprobante interno · cuenta corriente o contado · podés despachar tubos al cliente al grabar.</p>
    <div class="toolbar">
      <div class="field"><label>Tipo</label>
        <select id="fac-tipo">
          <option value="factura_x" ${f.tipo === "factura_x" ? "selected" : ""}>Factura X</option>
          <option value="factura_a" ${f.tipo === "factura_a" ? "selected" : ""}>Factura A</option>
          <option value="factura_b" ${f.tipo === "factura_b" ? "selected" : ""}>Factura B</option>
          <option value="remito_interno" ${f.tipo === "remito_interno" ? "selected" : ""}>Remito interno</option>
        </select>
      </div>
      <div class="field" style="flex:1.4"><label>Cliente</label>
        <input id="fac-cli-q" placeholder="Buscar cliente…" value="">
        <div id="fac-cli-sug" class="cli-live-list" hidden></div>
      </div>
      ${f.cliente ? `<div class="cli-elegido"><strong>${esc(f.cliente.nombre)}</strong><small>${esc(f.cliente.cuit || "")}</small>
        <button type="button" class="btn ghost" data-fac="quit-cli">Quitar</button></div>` : ""}
    </div>

    <div class="card">
      <p class="caja-label">Agregar gas / regulador rápido</p>
      <div class="gas-grid gas-grid-mini">
        ${gases.map((p) => `<button type="button" class="gas-card" data-fac="add-gas" data-clave="${esc(p.clave)}" data-nom="${esc(p.nombre)}" data-precio="${p.precio}">
          <span class="gn">${esc(p.nombre)}</span><span class="precio">${money(p.precio)}</span>
        </button>`).join("") || `<p class="empty">Sin precios cargados</p>`}
      </div>
      <div class="toolbar" style="margin-top:12px">
        <div class="field" style="flex:1"><label>Línea libre</label><input id="fac-desc" placeholder="Descripción"></div>
        <div class="field"><label>Cant.</label><input id="fac-cant" inputmode="decimal" value="1" style="width:80px"></div>
        <div class="field"><label>Precio</label><input id="fac-pu" inputmode="decimal" value="0" style="width:110px"></div>
        <button type="button" class="btn secondary" data-fac="add-linea">Sumar línea</button>
      </div>
      <div class="toolbar">
        <div class="field" style="flex:1"><label>Tubo (nº / cód. proveedor)</label>
          <input id="fac-tubo-q" placeholder="Escanear o escribir…" value="${esc(f.tuboQ || "")}">
        </div>
        <button type="button" class="btn copper" data-fac="add-tubo">Agregar tubo</button>
      </div>
      <div id="fac-tubo-hits" class="cli-live-list" hidden></div>
    </div>

    <div class="card table-wrap">
      <table>
        <thead><tr><th>Descripción</th><th>Cant.</th><th>P. unit.</th><th>Subtotal</th><th></th></tr></thead>
        <tbody>
          ${f.items.map((it, i) => `
            <tr>
              <td>${esc(it.descripcion)}${it.tubo_id ? ` <span class="badge cargado">Tubo</span>` : ""}</td>
              <td class="mono">${esc(it.cantidad)}</td>
              <td>${money(it.precio_unitario)}</td>
              <td><strong>${money(Number(it.cantidad) * Number(it.precio_unitario))}</strong></td>
              <td><button type="button" class="btn ghost" data-fac="del-item" data-i="${i}">Quitar</button></td>
            </tr>`).join("") || `<tr><td colspan="5" class="empty">Sin líneas</td></tr>`}
        </tbody>
      </table>
      <p style="text-align:right;margin:10px 0 0;font-size:1.25rem"><strong>Total ${money(total)}</strong></p>
    </div>

    <div class="card">
      <div class="toolbar">
        <button type="button" class="btn big-soft ${f.modoPago === "cuenta" ? "on" : ""}" data-fac="modo" data-m="cuenta">Cuenta corriente</button>
        <button type="button" class="btn big-soft ${f.modoPago === "contado" ? "on" : ""}" data-fac="modo" data-m="contado">Contado</button>
      </div>
      ${f.modoPago === "contado" ? `
        <div class="caja-medios-inline" style="margin:10px 0">
          ${[["efectivo","Efectivo"],["transferencia","Transfer."],["tarjeta","Tarjeta"],["cheque","Cheque"],["echeq","ECHEQ"]].map(([id,n]) =>
            `<button type="button" class="btn big-soft ${f.medioPago === id ? "on" : ""}" data-fac="medio" data-m="${id}">${n}</button>`
          ).join("")}
        </div>
        ${f.medioPago === "cheque" || f.medioPago === "echeq" ? htmlChequeForm("fac", { ...f.cheque, tipo: f.medioPago }, total) : ""}
      ` : `<p class="lead">Queda como deuda del cliente hasta que se cobre.</p>`}
      <div class="field full"><label>Observaciones</label><input id="fac-obs" value="${esc(f.obs || "")}"></div>
      <button type="button" class="btn btn-grabar" data-fac="grabar" ${!f.cliente || !f.items.length ? "disabled" : ""}>
        ${f.modoPago === "contado" ? "Grabar cobrado" : "Grabar a cuenta"} ${f.items.some((x) => x.tubo_id) ? "+ despachar tubos" : ""}
      </button>
    </div>`;

  const root = app();
  root.onclick = onFacturarClick;
  $("#fac-tipo").onchange = () => { state.facturar.tipo = $("#fac-tipo").value; };
  const q = $("#fac-cli-q");
  let tCli;
  q.oninput = () => {
    clearTimeout(tCli);
    tCli = setTimeout(async () => {
      const term = q.value.trim();
      const box = $("#fac-cli-sug");
      if (term.length < 2) { box.hidden = true; return; }
      try {
        const data = await api("/api/clientes?q=" + encodeURIComponent(term));
        const rows = data.clientes || data || [];
        const list = Array.isArray(rows) ? rows : [];
        if (!list.length) {
          box.innerHTML = `<li class="empty-li">Sin resultados</li>`;
          box.hidden = false;
          return;
        }
        box.innerHTML = list.slice(0, 12).map((c) =>
          `<li data-fac="pick-cli" data-id="${c.id}" data-nombre="${esc(c.nombre)}" data-cuit="${esc(c.cuit || "")}">
            <strong>${esc(c.nombre)}</strong><small>${esc(c.cuit || "")}</small><span class="cli-dir">${esc(c.direccion || "")}</span>
          </li>`
        ).join("");
        box.hidden = false;
      } catch (e) { toast(e.message, true); }
    }, 220);
  };
  const tq = $("#fac-tubo-q");
  let tTub;
  tq.oninput = () => {
    state.facturar.tuboQ = tq.value;
    clearTimeout(tTub);
    tTub = setTimeout(() => buscarTubosFacturar(tq.value).catch((e) => toast(e.message, true)), 250);
  };
  tq.onkeydown = (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      agregarTuboFacturar(tq.value).catch((e) => toast(e.message, true));
    }
  };
}

async function buscarTubosFacturar(term) {
  const box = $("#fac-tubo-hits");
  if (!box) return;
  const q = String(term || "").trim();
  if (q.length < 1) { box.hidden = true; return; }
  const data = await api("/api/caja/buscar-tubo?q=" + encodeURIComponent(q));
  const tubos = data.tubos || [];
  if (!tubos.length) {
    box.innerHTML = `<li class="empty-li">Sin tubos</li>`;
    box.hidden = false;
    return;
  }
  box.innerHTML = tubos.map((t) =>
    `<li data-fac="pick-tubo" data-id="${t.id}" data-num="${esc(t.numero)}" data-desc="${esc(t.articulo_descripcion || "")}" data-estado="${esc(t.estado || "")}">
      <strong>${esc(t.numero)}</strong>
      <small>${esc(t.articulo_descripcion || "")} · ${esc(t.estado || "")}</small>
      <span class="cli-dir">${esc(t.codigo_proveedor_mostrar || t.codigo_proveedor || "")}</span>
    </li>`
  ).join("");
  box.hidden = false;
}

async function agregarTuboFacturar(codigo) {
  const q = String(codigo || "").trim();
  if (!q) return;
  const data = await api("/api/caja/buscar-tubo?q=" + encodeURIComponent(q));
  const t = (data.tubos || [])[0];
  if (!t) { toast("Tubo no encontrado", true); return; }
  pushTuboFacturar(t);
}

function pushTuboFacturar(t) {
  const f = state.facturar;
  if (f.items.some((it) => Number(it.tubo_id) === Number(t.id))) {
    toast("Ese tubo ya está en la factura", true);
    return;
  }
  f.items.push({
    descripcion: `Tubo ${t.numero} · ${t.articulo_descripcion || ""}`.trim(),
    cantidad: 1,
    precio_unitario: 0,
    tubo_id: t.id,
  });
  f.tuboQ = "";
  pintarFacturar();
  toast("Tubo agregado");
}

function onFacturarClick(ev) {
  const btn = ev.target.closest("[data-fac]");
  if (!btn) return;
  const act = btn.getAttribute("data-fac");
  const f = state.facturar;
  if (act === "quit-cli") {
    f.cliente = null;
    pintarFacturar();
  } else if (act === "pick-cli") {
    f.cliente = { id: Number(btn.dataset.id), nombre: btn.dataset.nombre, cuit: btn.dataset.cuit || "" };
    pintarFacturar();
  } else if (act === "add-gas") {
    f.items.push({
      descripcion: btn.dataset.nom,
      cantidad: 1,
      precio_unitario: Number(btn.dataset.precio) || 0,
      precio_caja_clave: btn.dataset.clave,
    });
    pintarFacturar();
  } else if (act === "add-linea") {
    const desc = $("#fac-desc")?.value?.trim();
    const cant = parseMonto($("#fac-cant")?.value) || 1;
    const pu = parseMonto($("#fac-pu")?.value) || 0;
    if (!desc) { toast("Escribí la descripción", true); return; }
    f.items.push({ descripcion: desc, cantidad: cant, precio_unitario: pu });
    pintarFacturar();
  } else if (act === "add-tubo") {
    agregarTuboFacturar($("#fac-tubo-q")?.value).catch((e) => toast(e.message, true));
  } else if (act === "pick-tubo") {
    pushTuboFacturar({
      id: Number(btn.dataset.id),
      numero: btn.dataset.num,
      articulo_descripcion: btn.dataset.desc,
      estado: btn.dataset.estado,
    });
  } else if (act === "del-item") {
    f.items.splice(Number(btn.dataset.i), 1);
    pintarFacturar();
  } else if (act === "modo") {
    f.modoPago = btn.dataset.m;
    pintarFacturar();
  } else if (act === "medio") {
    f.medioPago = btn.dataset.m;
    if (btn.dataset.m === "cheque" || btn.dataset.m === "echeq") f.cheque.tipo = btn.dataset.m;
    pintarFacturar();
  } else if (act === "grabar") {
    grabarFacturar().catch((e) => toast(e.message, true));
  }
}

async function grabarFacturar() {
  const f = state.facturar;
  if (!f.cliente) { toast("Elegí un cliente", true); return; }
  if (!f.items.length) { toast("Agregá líneas", true); return; }
  f.tipo = $("#fac-tipo")?.value || f.tipo;
  f.obs = $("#fac-obs")?.value || "";
  const body = {
    tipo: f.tipo,
    cliente_id: f.cliente.id,
    modo_pago: f.modoPago,
    medio_pago: f.medioPago,
    observaciones: f.obs,
    items: f.items,
  };
  if (f.modoPago === "contado" && (f.medioPago === "cheque" || f.medioPago === "echeq")) {
    body.cheque = leerChequeForm("fac");
    body.medio_pago = body.cheque.tipo || f.medioPago;
  }
  const r = await api("/api/caja/comprobantes", { method: "POST", body });
  const n = r.comprobante?.numero_txt || "";
  const desp = (r.tubos_despachados || []).length;
  toast(`Comprobante ${n} grabado` + (desp ? ` · ${desp} tubo(s) despachado(s)` : ""));
  state.facturar = facturarInicial();
  if (f.modoPago === "cuenta") location.hash = "#/deudas?cliente_id=" + f.cliente.id;
  else pintarFacturar();
}

async function vistaDeudas(params) {
  setNav("deudas");
  const clienteId = params.get("cliente_id");
  const q = params.get("q") || "";
  if (clienteId) return vistaCuentaCorriente(clienteId);
  const data = await api("/api/caja/deudas" + (q ? "?q=" + encodeURIComponent(q) : ""));
  app().innerHTML = `
    <h1>Deudas</h1>
    <p class="lead">Clientes con saldo pendiente y desde cuándo.</p>
    <div class="toolbar">
      <div class="field" style="flex:1"><label>Buscar</label><input id="deu-q" value="${esc(q)}" placeholder="Cliente…"></div>
      <button type="button" class="btn secondary" id="deu-buscar">Buscar</button>
      <a class="btn" href="#/facturar">Nueva factura</a>
    </div>
    <div class="card"><small>Total adeudado</small><div class="n" style="font-size:1.6rem">${money(data.total)}</div>
      <small>${data.n_clientes || 0} cliente(s)</small></div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Cliente</th><th>Desde</th><th>Días</th><th>Comp.</th><th>Saldo</th><th></th></tr></thead>
        <tbody>
          ${(data.deudas || []).map((d) => `
            <tr class="${Number(d.dias) >= 30 ? "fila-deuda-vieja" : ""}">
              <td><strong>${esc(d.cliente_nombre)}</strong><br><small>${esc(d.cliente_cuit || "")}</small></td>
              <td>${esc(fmtFecha(d.desde))}</td>
              <td class="mono">${esc(d.dias)}</td>
              <td class="mono">${esc(d.n_comprobantes)}</td>
              <td><strong>${money(d.saldo)}</strong></td>
              <td><a class="btn secondary" href="#/deudas?cliente_id=${d.cliente_id}">Ver / Cobrar</a></td>
            </tr>`).join("") || `<tr><td colspan="6" class="empty">No hay deudas abiertas.</td></tr>`}
        </tbody>
      </table>
    </div>`;
  $("#deu-buscar").onclick = () => {
    const term = $("#deu-q").value.trim();
    location.hash = "#/deudas" + (term ? "?q=" + encodeURIComponent(term) : "");
  };
}

async function vistaCuentaCorriente(clienteId) {
  setNav("deudas");
  const data = await api("/api/caja/cuenta-corriente/" + clienteId);
  const cli = data.cliente || {};
  const abiertos = data.abiertos || [];
  state.cobroDeuda = {
    cliente_id: Number(clienteId),
    medio: "efectivo",
    montos: Object.fromEntries(abiertos.map((c) => [c.id, String(c.saldo)])),
    cheque: { tipo: "cheque", banco: "", numero: "", librador: "", fecha_emision: "", fecha_pago: "", monto: "" },
  };
  const pintar = () => {
    const st = state.cobroDeuda;
    const totalSel = Math.round(
      Object.entries(st.montos).reduce((s, [, v]) => s + (parseMonto(v) || 0), 0) * 100
    ) / 100;
    app().innerHTML = `
      <p><a href="#/deudas">← Deudas</a></p>
      <h1>${esc(cli.nombre)}</h1>
      <p class="lead">Cuenta corriente · saldo ${money(data.saldo)}</p>
      <div class="card">
        <h3 style="margin-top:0">Cobrar deudas</h3>
        ${abiertos.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th></th><th>Comprobante</th><th>Fecha</th><th>Total</th><th>Saldo</th><th>A cobrar</th></tr></thead>
            <tbody>
              ${abiertos.map((c) => `
                <tr>
                  <td><input type="checkbox" class="deu-chk" data-id="${c.id}" ${st.montos[c.id] != null ? "checked" : ""}></td>
                  <td>${esc(c.tipo_label || c.tipo)} ${esc(c.numero_txt)}</td>
                  <td>${esc(fmtFecha(c.fecha))}</td>
                  <td>${money(c.total)}</td>
                  <td>${money(c.saldo)}</td>
                  <td><input class="deu-monto" data-id="${c.id}" inputmode="decimal" value="${esc(st.montos[c.id] ?? "")}" ${st.montos[c.id] == null ? "disabled" : ""} style="width:110px"></td>
                </tr>`).join("")}
            </tbody>
          </table></div>
          <div class="caja-medios-inline" style="margin:12px 0">
            ${[["efectivo","Efectivo"],["transferencia","Transfer."],["tarjeta","Tarjeta"],["cheque","Cheque"],["echeq","ECHEQ"]].map(([id,n]) =>
              `<button type="button" class="btn big-soft ${st.medio === id ? "on" : ""}" data-deu="medio" data-m="${id}">${n}</button>`
            ).join("")}
          </div>
          ${st.medio === "cheque" || st.medio === "echeq" ? htmlChequeForm("deu", { ...st.cheque, tipo: st.medio }, totalSel) : ""}
          <button type="button" class="btn btn-grabar" data-deu="cobrar" ${totalSel <= 0 ? "disabled" : ""}>Cobrar ${money(totalSel)}</button>
        ` : `<p class="empty">Sin comprobantes abiertos.</p>`}
      </div>
      <div class="grid two">
        <div class="card table-wrap">
          <h3>Comprobantes</h3>
          <table>
            <thead><tr><th>Fecha</th><th>Nº</th><th>Estado</th><th>Total</th><th>Saldo</th></tr></thead>
            <tbody>
              ${(data.comprobantes || []).map((c) => `
                <tr>
                  <td>${esc(fmtFecha(c.fecha))}</td>
                  <td>${esc(c.tipo_label || c.tipo)} ${esc(c.numero_txt)}</td>
                  <td><span class="badge">${esc(c.estado)}</span></td>
                  <td>${money(c.total)}</td>
                  <td>${money(c.saldo)}</td>
                </tr>`).join("") || `<tr><td colspan="5" class="empty">Sin comprobantes</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="card table-wrap">
          <h3>Cobros</h3>
          <table>
            <thead><tr><th>Fecha</th><th>Medio</th><th>Total</th></tr></thead>
            <tbody>
              ${(data.cobros || []).map((c) => `
                <tr>
                  <td>${esc(fmtFecha(c.fecha))} ${esc(c.hora || "")}</td>
                  <td>${esc(etiquetaMedio(c.medio_pago))}</td>
                  <td>${money(c.total)}</td>
                </tr>`).join("") || `<tr><td colspan="3" class="empty">Sin cobros</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    app().onclick = (ev) => {
      const b = ev.target.closest("[data-deu]");
      if (!b) return;
      if (b.getAttribute("data-deu") === "medio") {
        leerMontosDeudaDom();
        st.medio = b.dataset.m;
        if (b.dataset.m === "cheque" || b.dataset.m === "echeq") st.cheque.tipo = b.dataset.m;
        pintar();
      } else if (b.getAttribute("data-deu") === "cobrar") {
        cobrarDeudaCliente().catch((e) => toast(e.message, true));
      }
    };
    document.querySelectorAll(".deu-chk").forEach((chk) => {
      chk.onchange = () => {
        const id = chk.dataset.id;
        const open = abiertos.find((x) => String(x.id) === String(id));
        if (chk.checked) st.montos[id] = String(open?.saldo ?? "");
        else delete st.montos[id];
        pintar();
      };
    });
    document.querySelectorAll(".deu-monto").forEach((inp) => {
      inp.oninput = () => { st.montos[inp.dataset.id] = inp.value; };
    });
  };
  function leerMontosDeudaDom() {
    document.querySelectorAll(".deu-monto").forEach((inp) => {
      if (!inp.disabled) state.cobroDeuda.montos[inp.dataset.id] = inp.value;
    });
  }
  async function cobrarDeudaCliente() {
    leerMontosDeudaDom();
    const st = state.cobroDeuda;
    const aplicaciones = Object.entries(st.montos)
      .map(([id, v]) => ({ comprobante_id: Number(id), monto: parseMonto(v) }))
      .filter((a) => a.monto > 0);
    if (!aplicaciones.length) { toast("Indicá montos a cobrar", true); return; }
    const body = {
      cliente_id: st.cliente_id,
      medio_pago: st.medio,
      aplicaciones,
    };
    if (st.medio === "cheque" || st.medio === "echeq") {
      body.cheque = leerChequeForm("deu");
      body.medio_pago = body.cheque.tipo || st.medio;
    }
    await api("/api/caja/cobros", { method: "POST", body });
    toast("Cobro registrado");
    return vistaCuentaCorriente(clienteId);
  }
  pintar();
}

async function vistaCheques(params) {
  setNav("cheques");
  const estado = params.get("estado") || "";
  const tipo = params.get("tipo") || "";
  const q = new URLSearchParams();
  if (estado) q.set("estado", estado);
  if (tipo) q.set("tipo", tipo);
  const data = await api("/api/caja/cheques" + (q.toString() ? "?" + q : ""));
  const filtrosEst = [
    ["", "Todos"],
    ["en_cartera", "En cartera"],
    ["endosado", "Endosados"],
    ["depositado", "Depositados"],
    ["cobrado", "Cobrados"],
    ["rechazado", "Rechazados"],
  ];
  app().innerHTML = `
    <h1>Cheques</h1>
    <p class="lead">Cartera de cheques y ECHEQ · cargar, endosar y cambiar estado.</p>
    <div class="toolbar">
      ${filtrosEst.map(([id, nom]) =>
        `<a class="btn secondary ${estado === id ? "on" : ""}" href="#/cheques?estado=${id}${tipo ? "&tipo=" + tipo : ""}">${nom}</a>`
      ).join("")}
      <a class="btn secondary ${tipo === "cheque" ? "on" : ""}" href="#/cheques?tipo=cheque${estado ? "&estado=" + estado : ""}">Cheque</a>
      <a class="btn secondary ${tipo === "echeq" ? "on" : ""}" href="#/cheques?tipo=echeq${estado ? "&estado=" + estado : ""}">ECHEQ</a>
      <button type="button" class="btn" id="ch-nuevo">Cargar cheque</button>
    </div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Tipo</th><th>Nº</th><th>Banco</th><th>Cliente</th><th>Monto</th><th>Pago</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${(data.cheques || []).map((c) => `
            <tr>
              <td>${esc(c.tipo === "echeq" ? "ECHEQ" : "Cheque")}</td>
              <td class="mono">${esc(c.numero)}</td>
              <td>${esc(c.banco || "")}</td>
              <td>${esc(c.cliente_nombre || "—")}</td>
              <td><strong>${money(c.monto)}</strong></td>
              <td>${esc(c.fecha_pago ? fmtFecha(c.fecha_pago) : "—")}</td>
              <td><span class="badge">${esc(c.estado)}</span></td>
              <td class="toolbar" style="margin:0">
                ${c.estado === "en_cartera" || c.estado === "endosado" ? `<button type="button" class="btn secondary" data-ch="endosar" data-id="${c.id}">Endosar</button>` : ""}
                ${c.estado !== "depositado" && c.estado !== "cobrado" && c.estado !== "rechazado" ? `<button type="button" class="btn ghost" data-ch="estado" data-id="${c.id}" data-e="depositado">Depositar</button>` : ""}
                ${c.estado === "depositado" ? `<button type="button" class="btn ghost" data-ch="estado" data-id="${c.id}" data-e="cobrado">Cobrado</button>` : ""}
                ${c.estado !== "rechazado" && c.estado !== "cobrado" ? `<button type="button" class="btn ghost" data-ch="estado" data-id="${c.id}" data-e="rechazado" style="color:#9b2c2c">Rechazar</button>` : ""}
              </td>
            </tr>`).join("") || `<tr><td colspan="8" class="empty">Sin cheques</td></tr>`}
        </tbody>
      </table>
    </div>
    <div id="ch-modal" class="modal-backdrop" hidden></div>`;
  $("#ch-nuevo").onclick = () => abrirAltaCheque();
  app().onclick = (ev) => {
    const b = ev.target.closest("[data-ch]");
    if (!b) return;
    const act = b.getAttribute("data-ch");
    const id = b.dataset.id;
    if (act === "endosar") abrirEndoso(id);
    else if (act === "estado") {
      (async () => {
        try {
          await api("/api/caja/cheques/" + id, { method: "PUT", body: { estado: b.dataset.e } });
          toast("Estado actualizado");
          vistaCheques(params);
        } catch (e) { toast(e.message, true); }
      })();
    }
  };
}

function abrirAltaCheque() {
  const box = $("#ch-modal");
  box.hidden = false;
  box.innerHTML = `
    <div class="modal card">
      <h2>Cargar cheque / ECHEQ</h2>
      ${htmlChequeForm("new", { tipo: "cheque" })}
      <div class="toolbar" style="margin-top:12px">
        <button type="button" class="btn" id="ch-save">Guardar</button>
        <button type="button" class="btn secondary" id="ch-cancel">Cancelar</button>
      </div>
    </div>`;
  box.onclick = (ev) => { if (ev.target === box) box.hidden = true; };
  $("#ch-cancel").onclick = () => { box.hidden = true; };
  $("#ch-save").onclick = async () => {
    try {
      const body = leerChequeForm("new");
      if (!body.numero) { toast("Falta el número", true); return; }
      await api("/api/caja/cheques", { method: "POST", body });
      toast("Cheque cargado");
      box.hidden = true;
      vistaCheques(new URLSearchParams());
    } catch (e) { toast(e.message, true); }
  };
}

function abrirEndoso(id) {
  const box = $("#ch-modal");
  box.hidden = false;
  box.innerHTML = `
    <div class="modal card">
      <h2>Endosar cheque</h2>
      <div class="field"><label>Endosatario</label><input id="end-nom" required></div>
      <div class="field"><label>Fecha</label><input id="end-fecha" type="date" value="${hoyInput()}"></div>
      <div class="field"><label>Observaciones</label><input id="end-obs"></div>
      <div class="toolbar">
        <button type="button" class="btn" id="end-ok">Confirmar endoso</button>
        <button type="button" class="btn secondary" id="end-cancel">Cancelar</button>
      </div>
    </div>`;
  box.onclick = (ev) => { if (ev.target === box) box.hidden = true; };
  $("#end-cancel").onclick = () => { box.hidden = true; };
  $("#end-ok").onclick = async () => {
    try {
      const endosatario = $("#end-nom").value.trim();
      if (!endosatario) { toast("Indicá el endosatario", true); return; }
      await api("/api/caja/cheques/" + id + "/endosar", {
        method: "POST",
        body: { endosatario, fecha: $("#end-fecha").value, observaciones: $("#end-obs").value },
      });
      toast("Cheque endosado");
      box.hidden = true;
      vistaCheques(new URLSearchParams(location.hash.split("?")[1] || ""));
    } catch (e) { toast(e.message, true); }
  };
}

function claseFilaVenta(v) {
  if (v.tipo === "salida") return "fila-salida";
  if (v.estado_factura === "pendiente") return "fila-facturar";
  if (v.estado_factura === "facturado") return "fila-facturado";
  return "";
}

async function vistaFacturacion(params) {
  setNav("facturacion");
  const esAdmin = rolActual() === "admin";
  const desde = params.get("desde") || hoyInput();
  const hasta = params.get("hasta") || desde;
  const estado = params.get("estado") || "";
  const q = new URLSearchParams({ desde, hasta });
  if (estado) q.set("estado", estado);
  const data = await api("/api/caja/ventas?" + q.toString());
  const precios = data.precios || [];
  const gases = precios.filter((p) => p.tipo === "gas");
  const r = data.resumen || {};
  const esHoy = desde === hoyInput() && hasta === hoyInput();
  const nVentas = (data.ventas || []).filter((v) => v.tipo !== "salida").length;
  const filtros = [
    ["", "Del período"],
    ["pendiente", "Para facturar"],
    ["facturado", "Facturadas"],
    ["contado", "Contado"],
    ["salida", "Salidas"],
  ];
  app().innerHTML = `
    <h1>Facturación</h1>
    <p class="lead">Resumen de cobros del día/periodo. También: <a href="#/facturar">Facturar</a> · <a href="#/deudas">Deudas</a> · <a href="#/cheques">Cheques</a> · <a href="#/cobrar">Cobrar</a>.</p>
    ${r.pendientes_total ? `<a class="banner-fact" href="#/facturacion?estado=pendiente&desde=2020-01-01&hasta=${hoyInput()}">${r.pendientes_total} remito${r.pendientes_total === 1 ? "" : "s"} para facturar · ${money(r.pendientes_importe)}</a>` : ""}
    <div id="banner-deudas-fact"></div>
    <div class="resumen-caja resumen-fact">
      <div class="card resumen-titulo"><small>${esHoy ? "Hoy" : "Período"}</small><div class="n">${esc(fmtFecha(desde))}${desde !== hasta ? " – " + esc(fmtFecha(hasta)) : ""}</div><small>${nVentas} venta${nVentas === 1 ? "" : "s"}</small></div>
      <div class="card"><small>Total vendido</small><div class="n">${money(r.ventas)}</div></div>
      <div class="card"><small>Efectivo</small><div class="n">${money(r.efectivo)}</div></div>
      <div class="card"><small>Transf. / tarjeta</small><div class="n">${money((r.transferencia || 0) + (r.tarjeta || 0))}</div></div>
      <div class="card"><small>Para facturar</small><div class="n">${money(r.para_facturar)}</div><small>${r.n_para_facturar || 0} pendiente${(r.n_para_facturar || 0) === 1 ? "" : "s"}</small></div>
      <div class="card"><small>Salidas de caja</small><div class="n">${money(r.salidas)}</div></div>
      <div class="card"><small>Queda en caja</small><div class="n">${money(r.en_caja)}</div></div>
    </div>
    <form id="form-fechas" class="toolbar">
      <div class="field"><label>Desde</label><input type="date" name="desde" value="${esc(desde)}"></div>
      <div class="field"><label>Hasta</label><input type="date" name="hasta" value="${esc(hasta)}"></div>
      <button class="btn" type="submit">Ver</button>
      <a class="btn ghost" href="#/facturacion?desde=${hoyInput()}&hasta=${hoyInput()}">Hoy</a>
      ${esAdmin ? `<a class="btn secondary" href="/api/caja/ventas.csv?desde=${esc(desde)}&hasta=${esc(hasta)}">Exportar CSV</a>` : ""}
      <a class="btn copper" href="#/cobrar">Ir a cobrar</a>
      <a class="btn" href="#/facturar">Nueva factura</a>
      <a class="btn secondary" href="#/deudas">Deudas</a>
      <a class="btn secondary" href="#/cheques">Cheques</a>
    </form>
    <div class="tabs">
      ${filtros.map(([id, nom]) => `<a class="btn ${estado === id ? "" : "secondary"}" href="#/facturacion?desde=${esc(desde)}&hasta=${esc(hasta)}${id ? "&estado=" + id : ""}">${nom}</a>`).join("")}
    </div>
    <div class="card table-wrap">
      <table>
        <thead><tr><th>Fecha</th><th>Detalle</th><th>Cliente</th><th>Pago</th><th>Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${(data.ventas || []).map((v) => `
            <tr class="${claseFilaVenta(v)}">
              <td class="mono">${fmtFecha(v.fecha)} ${esc(v.hora || "")}</td>
              <td>${esc(v.descripcion)}<br><small>${esc(v.usuario_nombre || "")}</small></td>
              <td>${esc(v.cliente_nombre || "—")}${v.cliente_cuit ? `<br><small>${esc(v.cliente_cuit)}</small>` : ""}</td>
              <td>${v.tipo === "salida" ? "—" : esc(etiquetaMedio(v.medio_pago))}</td>
              <td class="mono">${v.tipo === "salida" ? "−" : ""}${money(v.total)}</td>
              <td>${etiquetaMov(v)}</td>
              <td>
                <button type="button" class="btn ghost" data-edit-v="${v.id}">Editar</button>
                ${esAdmin ? `<button type="button" class="btn secondary" data-tot-v="${v.id}">Ajustar $</button>` : ""}
                ${v.estado_factura === "pendiente" && v.cliente_id ? `<button type="button" class="btn" data-cc-v="${v.id}">A cuenta corriente</button>` : ""}
                ${esAdmin && v.estado_factura === "pendiente" ? `<button type="button" class="btn copper" data-fact-v="${v.id}">Facturado</button>` : ""}
              </td>
            </tr>`).join("") || `<tr><td colspan="7" class="empty">No hay movimientos en este período.</td></tr>`}
        </tbody>
      </table>
    </div>
    ${esAdmin ? `
    <div class="card" style="margin-top:14px">
      <h3>Precios que ve el cobrador</h3>
      <p class="lead">Gases por m³ (0,5 · 1 · 2 · 3 · 4 · 6 · 10). El CO2 se cobra por kilo; podés cambiarlo a m³ si hace falta. Regulador por unidad.</p>
      <form id="form-precios">
        <div class="precio-grid precio-grid-4" style="margin-bottom:8px"><strong>Gas</strong><strong>Unidad</strong><strong>Precio</strong><strong>Regulador</strong></div>
        ${gases.map((g) => {
          const reg = precios.find((p) => p.clave === "reg:" + g.gas) || { precio: 0 };
          const u = unidadGasCaja(g) === "kg" ? "kg" : "m3";
          const esCo2 = g.gas === "co2";
          return `<div class="precio-grid precio-grid-4">
            <div>${esc(g.nombre)}</div>
            <div class="field">${esCo2 ? `
              <select name="unidad:${esc(g.clave)}">
                <option value="kg" ${u === "kg" ? "selected" : ""}>por kg</option>
                <option value="m3" ${u === "m3" ? "selected" : ""}>por m³</option>
              </select>` : `<input type="hidden" name="unidad:${esc(g.clave)}" value="m3"><span class="mono">por m³</span>`}
            </div>
            <div class="field"><input name="${esc(g.clave)}" inputmode="decimal" value="${esc(g.precio)}" placeholder="${u === "kg" ? "$ / kg" : "$ / m³"}"></div>
            <div class="field"><input name="reg:${esc(g.gas)}" inputmode="decimal" value="${esc(reg.precio)}"></div>
          </div>`;
        }).join("")}
        <div class="toolbar" style="margin-top:12px"><button class="btn copper" type="submit">Guardar precios</button></div>
      </form>
    </div>` : ""}`;
  $("#form-fechas").onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    location.hash = `#/facturacion?desde=${fd.get("desde")}&hasta=${fd.get("hasta")}${estado ? "&estado=" + estado : ""}`;
  };
  if (esAdmin) {
    $("#form-precios").onsubmit = async (e) => {
      e.preventDefault();
      const raw = Object.fromEntries(new FormData(e.target).entries());
      const preciosBody = {};
      const unidades = {};
      Object.entries(raw).forEach(([k, v]) => {
        if (k.startsWith("unidad:")) unidades[k.slice(7)] = v;
        else preciosBody[k] = v;
      });
      try {
        await api("/api/caja/precios", { method: "PUT", body: { precios: preciosBody, unidades } });
        toast("Precios guardados");
        route();
      } catch (err) { toast(err.message, true); }
    };
  }
  const porId = Object.fromEntries((data.ventas || []).map((v) => [v.id, v]));
  document.querySelectorAll("[data-edit-v]").forEach((b) => {
    b.onclick = () => abrirEdicionVenta(porId[b.dataset.editV]);
  });
  document.querySelectorAll("[data-tot-v]").forEach((b) => {
    b.onclick = () => abrirAjusteTotal(porId[b.dataset.totV]);
  });
  document.querySelectorAll("[data-fact-v]").forEach((b) => {
    b.onclick = async () => {
      try {
        await api("/api/caja/ventas/" + b.dataset.factV, { method: "PUT", body: { estado_factura: "facturado", facturar: true } });
        toast("Marcada como facturada");
        route();
      } catch (err) { toast(err.message, true); }
    };
  });
  document.querySelectorAll("[data-cc-v]").forEach((b) => {
    b.onclick = async () => {
      try {
        const r = await api("/api/caja/ventas/" + b.dataset.ccV + "/a-comprobante", { method: "POST", body: { tipo: "factura_x" } });
        toast("Comprobante " + (r.comprobante?.numero_txt || "") + " en cuenta corriente");
        location.hash = "#/deudas?cliente_id=" + r.comprobante.cliente_id;
      } catch (err) { toast(err.message, true); }
    };
  });
  api("/api/caja/alertas").then((a) => {
    const el = $("#banner-deudas-fact");
    if (el) el.innerHTML = htmlBannerDeudas(a.alertas || []);
  }).catch(() => {});
}

function refrescarTrasEditarVenta(desdeCobrar) {
  if (desdeCobrar || (location.hash || "").startsWith("#/cobrar")) return vistaCobrar();
  return route();
}

function abrirAjusteTotal(v, desdeCobrar) {
  if (!v) return;
  const totTxt = String(v.total ?? "").replace(".", ",");
  abrirModal(`
    <h2>Ajustar total cobrado</h2>
    <p class="lead">${esc(v.descripcion)}${v.cliente_nombre ? `<br><small>${esc(v.cliente_nombre)}</small>` : ""}</p>
    <p>Actual: <strong>${money(v.total)}</strong>${Number(v.cantidad) ? ` · ${esc(fmtCantCaja(v.cantidad))} × ${money(v.precio_unitario)}` : ""}</p>
    <form id="form-aj-tot" class="grid form">
      <div class="field full"><label>Total a cobrar</label>
        <input name="total" class="total-edit-input" inputmode="decimal" value="${esc(totTxt)}" required>
      </div>
      <div class="field full"><button class="btn copper" type="submit">Guardar total</button></div>
    </form>`);
  const form = $("#form-aj-tot");
  form.total.focus();
  form.total.select();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const raw = String(form.total.value || "").trim();
    if (!raw) return toast("Indicá el total", true);
    try {
      await api("/api/caja/ventas/" + v.id, {
        method: "PUT",
        body: {
          total: raw,
          cantidad: v.cantidad,
          descripcion: v.descripcion,
        },
      });
      cerrarModal();
      toast("Total actualizado");
      await refrescarTrasEditarVenta(desdeCobrar);
    } catch (err) { toast(err.message, true); }
  };
}

function abrirEdicionVenta(v, desdeCobrar) {
  if (!v) return;
  const esCobrador = rolActual() === "cobrador";
  const fact = v.estado_factura === "pendiente" || v.estado_factura === "facturado" || v.facturar;
  const totTxt = String(v.total ?? "").replace(".", ",");
  const puTxt = String(v.precio_unitario ?? "").replace(".", ",");
  const medio = String(v.medio_pago || "efectivo").toLowerCase() || "efectivo";
  abrirModal(`
    <h2>Modificar venta</h2>
    <p class="lead">Podés cambiar el total, el medio de pago y si va o no a facturar.</p>
    <form id="form-ed-v" class="grid form">
      <div class="field full"><label>Descripción</label><input name="descripcion" value="${esc(v.descripcion)}" required></div>
      <div class="field"><label>Cantidad</label><input name="cantidad" inputmode="decimal" value="${esc(v.cantidad)}"></div>
      <div class="field"><label>Precio unitario</label><input name="precio_unitario" inputmode="decimal" value="${esc(puTxt)}"></div>
      <div class="field full"><label>Total a cobrar</label><input name="total" class="total-edit-input" inputmode="decimal" value="${esc(totTxt)}"></div>
      ${v.tipo === "salida" ? "" : `
        <div class="field full"><label>Cómo pagó</label>
          <select name="medio_pago">
            <option value="efectivo" ${medio === "efectivo" ? "selected" : ""}>Efectivo</option>
            <option value="transferencia" ${medio === "transferencia" ? "selected" : ""}>Transferencia</option>
            <option value="tarjeta" ${medio === "tarjeta" ? "selected" : ""}>Tarjeta</option>
          </select>
        </div>
        <div class="field"><label>Factura</label>
          <select name="facturar">
            <option value="0" ${fact ? "" : "selected"}>Contado</option>
            <option value="1" ${fact ? "selected" : ""}>Va facturado</option>
          </select>
        </div>
        <div class="field"><label>Estado</label>
          <select name="estado_factura">
            <option value="pendiente" ${v.estado_factura === "pendiente" ? "selected" : ""}>Para facturar</option>
            ${esCobrador ? "" : `<option value="facturado" ${v.estado_factura === "facturado" ? "selected" : ""}>Facturado</option>`}
            <option value="no" ${v.estado_factura === "no" ? "selected" : ""}>No factura</option>
          </select>
        </div>
        <div class="field full"><label>Cliente (nombre o CUIT, si cambia)</label><input id="ed-cli-q" placeholder="${esc(v.cliente_nombre || "Buscar cliente")}"></div>
        <div id="ed-cli-res" class="cant-rapida"></div>
        <input type="hidden" name="cliente_id" id="ed-cli-id" value="${v.cliente_id || ""}">
      `}
      <div class="field full"><button class="btn copper" type="submit">Guardar cambios</button></div>
    </form>`);
  const form = $("#form-ed-v");
  const q = $("#ed-cli-q");
  if (q) {
    let timer;
    q.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const s = q.value.trim();
        const box = $("#ed-cli-res");
        if (!box || s.length < 2) { if (box) box.innerHTML = ""; return; }
        const res = await api("/api/clientes?q=" + encodeURIComponent(s));
        box.innerHTML = res.clientes.slice(0, 8).map((c) => `<button type="button" class="btn ghost" data-pick="${c.id}">${esc(c.nombre)}</button>`).join("");
        box.querySelectorAll("[data-pick]").forEach((b) => {
          b.onclick = () => {
            $("#ed-cli-id").value = b.dataset.pick;
            q.value = b.textContent;
            box.innerHTML = "";
          };
        });
      }, 250);
    };
  }
  let editandoTotal = false;
  form.total.addEventListener("focus", () => { editandoTotal = true; });
  form.total.addEventListener("blur", () => { editandoTotal = false; });
  const syncDesdeUnitario = () => {
    if (editandoTotal || document.activeElement === form.total) return;
    const cant = parseMonto(form.cantidad.value) || 0;
    const pu = parseMonto(form.precio_unitario.value) || 0;
    form.total.value = String(Math.round(cant * pu * 100) / 100).replace(".", ",");
  };
  const syncDesdeTotal = () => {
    const cant = parseMonto(form.cantidad.value) || 0;
    const tot = parseMonto(form.total.value) || 0;
    if (cant > 0) form.precio_unitario.value = String(Math.round((tot / cant) * 100) / 100).replace(".", ",");
  };
  form.cantidad.addEventListener("input", syncDesdeUnitario);
  form.precio_unitario.addEventListener("input", syncDesdeUnitario);
  form.total.addEventListener("input", syncDesdeTotal);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form).entries());
    const body = {
      descripcion: fd.descripcion,
      cantidad: fd.cantidad,
      precio_unitario: fd.precio_unitario,
      total: fd.total,
    };
    if (v.tipo !== "salida") {
      body.medio_pago = fd.medio_pago || "efectivo";
      body.facturar = fd.facturar === "1";
      body.estado_factura = fd.estado_factura;
      if (fd.cliente_id) body.cliente_id = Number(fd.cliente_id);
    }
    try {
      await api("/api/caja/ventas/" + v.id, { method: "PUT", body });
      cerrarModal();
      toast("Venta actualizada");
      await refrescarTrasEditarVenta(desdeCobrar);
    } catch (err) { toast(err.message, true); }
  };
}

async function route() {
  try {
    if (window.GasonorScan) await GasonorScan.stop().catch(() => {});
    if (!state.usuario) {
      mostrarLogin(true);
      return;
    }
    mostrarLogin(false);
    if (app()) app().onclick = null;
    aplicarPermisos();
    const { path, params } = parseHash();
    const parts = path.split("/").filter(Boolean);
    const seccion = parts[0] || "inicio";
    if (rolActual() === "cobrador" && !["cobrar", "facturacion", "facturar", "deudas", "cheques"].includes(seccion)) {
      location.hash = "#/cobrar";
      return;
    }
    if (rolActual() === "despacho") {
      const okPlanta = seccion === "planta" && (parts[1] === "despacho" || parts[1] === "recepcion");
      const okEnviosPlanta = seccion === "envios" && parts[1] === "planta";
      if (seccion !== "inicio" && !okPlanta && !okEnviosPlanta) {
        location.hash = "#/inicio";
        return;
      }
    }
    if (seccion === "cobrar") {
      if (rolActual() !== "admin" && rolActual() !== "cobrador") return vistaInicio();
      return vistaCobrar();
    }
    if (seccion === "facturacion") {
      if (rolActual() !== "admin" && rolActual() !== "cobrador") return vistaInicio();
      return vistaFacturacion(params);
    }
    if (seccion === "inicio") return vistaInicio();
    if (seccion === "catalogo" || seccion === "tubos" || seccion === "articulos") {
      if (!puede("admin")) return vistaInicio();
      return vistaCatalogo(params);
    }
    if (seccion === "tubo" && parts[1]) {
      if (!puede("admin")) return vistaInicio();
      return vistaTubo(parts[1]);
    }
    if (seccion === "clientes") {
      if (!puede("admin")) return vistaInicio();
      if (parts[1] && /^\d+$/.test(parts[1])) return vistaClienteFicha(parts[1], params);
      return vistaClientes(params);
    }
    if (seccion === "operaciones") {
      if (!puede("admin")) return vistaInicio();
      return vistaOperaciones(params);
    }
    if (seccion === "envios") {
      if (!puede("admin", "despacho", "reparto")) return vistaInicio();
      const tipo = parts[1] === "cliente" ? "cliente" : "planta";
      if (tipo === "cliente" && !puede("admin", "reparto")) return vistaInicio();
      if (tipo === "planta" && !puede("admin", "despacho")) return vistaInicio();
      return vistaEnvios(tipo);
    }
    if (seccion === "informe") return vistaInforme(params);
    if (seccion === "movimientos") return vistaMovimientos(params);
    if (seccion === "config") return vistaConfig();
    if (seccion === "proveedores") {
      if (!puede("admin")) return vistaInicio();
      if (parts[1] && /^\d+$/.test(parts[1])) return vistaProveedorFicha(parts[1], params);
      return vistaProveedores();
    }
    if (seccion === "usuarios") {
      if (!puede("admin")) return vistaInicio();
      return vistaUsuarios();
    }
    if (seccion === "planta") {
      const modo = parts[1];
      const pid = parts[2];
      const conf = parts[3];
      if (modo === "completar") {
        if (!puede("admin")) return vistaInicio();
        if (pid) return vistaCerrarRecepcion(pid);
        return vistaCompletarRecepciones();
      }
      if (modo === "despacho" || modo === "recepcion") {
        if (!puede("admin", "despacho")) return vistaInicio();
        if (pid && conf === "confirmar") return vistaConfirmarPlanta(modo, pid);
        if (pid) return vistaScan(modo, pid);
        return elegirProveedor(modo);
      }
      return elegirProveedor("despacho");
    }
    if (seccion === "cliente") {
      if (!puede("admin", "reparto")) return vistaInicio();
      const modo = parts[1];
      const cid = parts[2];
      const conf = parts[3];
      if (modo === "despacho" || modo === "recepcion") {
        if (cid && conf === "confirmar") return vistaConfirmarCliente(modo, cid);
        if (cid) return vistaScanCliente(modo, cid);
        return elegirClienteOp(modo);
      }
      return elegirClienteOp("despacho");
    }
    if (seccion === "reparto") {
      if (parts[1] === "nuevo") return vistaRepartoNuevo();
      if (parts[1] === "permisos") return vistaRepartoPermisos();
      return vistaReparto(params);
    }
    return vistaInicio();
  } catch (err) {
    app().innerHTML = `<div class="card"><h2>No se pudo cargar</h2><p>${esc(err.message)}</p></div>`;
  }
}

$("#busqueda-global").onsubmit = (e) => {
  e.preventDefault();
  const q = $("#q-global").value.trim();
  location.hash = "#/catalogo" + (q ? "?q=" + encodeURIComponent(q) : "");
};

function tickReloj() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  $("#reloj").textContent = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

$("#btn-menu")?.addEventListener("click", () => {
  document.querySelector(".sidebar")?.classList.toggle("open");
});
document.querySelectorAll(".sidebar nav a").forEach((a) => {
  a.addEventListener("click", () => document.querySelector(".sidebar")?.classList.remove("open"));
});
$("#btn-salir")?.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: {} }).catch(() => {});
  state.usuario = null;
  state.caja = null;
  document.body.classList.remove("modo-cobrador");
  const busq = $("#busqueda-global");
  if (busq) busq.hidden = false;
  mostrarLogin(true);
});
$("#form-login")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target).entries());
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(fd),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || "No se pudo entrar");
    state.usuario = data.usuario;
    mostrarLogin(false);
    if (rolActual() === "cobrador") {
      aplicarPermisos();
      const okCaja = ["#/cobrar", "#/facturar", "#/deudas", "#/cheques", "#/facturacion"].some((p) => (location.hash || "").startsWith(p));
      if (!okCaja) location.hash = "#/cobrar";
      else route();
      return;
    }
    await cargarCatalogos().catch(() => {});
    route();
  } catch (err) { toast(err.message, true); }
});

window.quitarDeLista = quitarDeLista;
window.addEventListener("hashchange", route);
tickReloj();
setInterval(tickReloj, 15000);

(async function arranque() {
  try {
    const s = await fetch("/api/sesion", { credentials: "same-origin" }).then((r) => r.json());
    state.usuario = s.usuario || null;
  } catch (_) {
    state.usuario = null;
  }
  if (!state.usuario) {
    mostrarLogin(true);
    return;
  }
  mostrarLogin(false);
  if (rolActual() === "cobrador") {
    aplicarPermisos();
    const okCaja = ["#/cobrar", "#/facturar", "#/deudas", "#/cheques", "#/facturacion"].some((p) => (location.hash || "").startsWith(p));
    if (!okCaja) location.hash = "#/cobrar";
    else route();
    return;
  }
  await cargarCatalogos().then(route).catch((err) => toast(err.message, true));
})();
