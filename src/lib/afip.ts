/**
 * Factura electrónica AFIP / ARCA (WSAA + WSFEv1) para Vercel/Turso.
 * Usa node-forge para firmar el CMS del ticket WSAA.
 */
import forge from "node-forge";
import { all } from "./db";

const URLS = {
  homo: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  prod: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
} as const;

const CBTE: Record<string, number> = { factura_a: 1, factura_b: 6, factura_c: 11 };

type AfipCfg = {
  ambiente: "homo" | "prod";
  cuit: string;
  pto: number;
  cert: string;
  key: string;
  condicion: string;
};

type TokenCache = { token: string; sign: string; vence: number };
const TOKEN: Record<string, TokenCache> = {};

export class AfipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AfipError";
  }
}

function xmlEsc(texto: unknown) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function texts(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

function uno(xml: string, name: string) {
  return texts(xml, name)[0] || "";
}

async function cfgFromDb(): Promise<AfipCfg> {
  const rows = await all("SELECT clave, valor FROM config");
  const map: Record<string, string> = {};
  for (const r of rows) map[String(r.clave)] = String(r.valor ?? "");
  let ambiente = (map.afip_ambiente || "homo").trim().toLowerCase();
  if (ambiente !== "prod" && ambiente !== "homo") ambiente = "homo";
  const cuit = String(map.afip_cuit || map.cuit || "").replace(/\D/g, "");
  let pto = parseInt(String(map.afip_pto_vta || "1").trim() || "1", 10);
  if (!Number.isFinite(pto) || pto < 1) pto = 1;
  return {
    ambiente: ambiente as "homo" | "prod",
    cuit,
    pto,
    cert: (map.afip_cert || "").trim(),
    key: (map.afip_key || "").trim(),
    condicion: (map.afip_condicion || map.condicion_iva || "").trim().toLowerCase(),
  };
}

export async function resumenAfip() {
  const c = await cfgFromDb();
  const rows = await all("SELECT clave, valor FROM config");
  const map: Record<string, string> = {};
  for (const r of rows) map[String(r.clave)] = String(r.valor ?? "");
  return {
    afip_ambiente: c.ambiente,
    afip_cuit: c.cuit,
    afip_pto_vta: String(c.pto),
    afip_condicion: c.condicion,
    afip_cert_ok: c.cert.includes("BEGIN CERTIFICATE") ? "1" : "",
    afip_key_ok: c.key.includes("PRIVATE KEY") ? "1" : "",
    iva_alicuota: map.iva_alicuota || "21",
    precios_con_iva: map.precios_con_iva || "1",
    afip_iva_id: map.afip_iva_id || "",
  };
}

function firmarCms(tra: string, certPem: string, keyPem: string): string {
  try {
    const cert = forge.pki.certificateFromPem(certPem);
    const key = forge.pki.privateKeyFromPem(keyPem);
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(tra, "utf8");
    p7.addCertificate(cert);
    p7.addSigner({
      key,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime, value: new Date() },
      ],
    });
    // WSAA exige CMS attached (contenido dentro del PKCS7), como en afip.py.
    p7.sign({ detached: false });
    const asn1 = p7.toAsn1();
    const der = forge.asn1.toDer(asn1).getBytes();
    return forge.util.encode64(der);
  } catch (e) {
    throw new AfipError("El certificado o la clave privada de AFIP no se pueden usar.");
  }
}

async function postSoap(url: string, body: string, soapAction: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: soapAction,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new AfipError(`No se pudo conectar con AFIP (${res.status}).`);
  return text;
}

function arNow() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

function fmtIsoAr(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}-03:00`;
}

async function login(cfg: AfipCfg): Promise<{ token: string; sign: string }> {
  if (!cfg.cuit || !cfg.cert.includes("BEGIN CERTIFICATE") || !cfg.key.includes("PRIVATE KEY")) {
    throw new AfipError("Falta completar AFIP en Empresa: CUIT, certificado y clave privada.");
  }
  const clave = `${cfg.ambiente}:${cfg.cuit}:${cfg.cert.length}`;
  const guardado = TOKEN[clave];
  if (guardado && guardado.vence > Date.now() + 5 * 60 * 1000) {
    return { token: guardado.token, sign: guardado.sign };
  }
  const ahora = arNow();
  const gen = new Date(ahora.getTime() - 10 * 60 * 1000);
  const exp = new Date(ahora.getTime() + 12 * 60 * 60 * 1000);
  const tra =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<loginTicketRequest version="1.0"><header>' +
    `<uniqueId>${Math.floor(Date.now() / 1000)}</uniqueId>` +
    `<generationTime>${fmtIsoAr(gen)}</generationTime>` +
    `<expirationTime>${fmtIsoAr(exp)}</expirationTime>` +
    "</header><service>wsfe</service></loginTicketRequest>";
  const cms = firmarCms(tra, cfg.cert, cfg.key);
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">' +
    "<soapenv:Header/><soapenv:Body><wsaa:loginCms>" +
    `<wsaa:in0>${cms}</wsaa:in0>` +
    "</wsaa:loginCms></soapenv:Body></soapenv:Envelope>";
  const xml = await postSoap(URLS[cfg.ambiente].wsaa, body, "");
  const fault = uno(xml, "faultstring");
  if (fault) throw new AfipError(`AFIP rechazó el acceso: ${fault}`);
  let interno = uno(xml, "loginCmsReturn");
  if (!interno) throw new AfipError("AFIP no devolvió el ticket de acceso.");
  interno = interno.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const token = uno(interno, "token");
  const sign = uno(interno, "sign");
  if (!token || !sign) throw new AfipError("AFIP no autorizó el certificado.");
  const expTxt = uno(interno, "expirationTime");
  let vence = Date.now() + 10 * 60 * 60 * 1000;
  if (expTxt) {
    const t = Date.parse(expTxt);
    if (Number.isFinite(t)) vence = t;
  }
  TOKEN[clave] = { token, sign, vence };
  return { token, sign };
}

async function wsfe(cfg: AfipCfg, inner: string, action: string): Promise<string> {
  const { token, sign } = await login(cfg);
  let body =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:ar="http://ar.gov.afip.dif.FEV1/">' +
    "<soapenv:Header/><soapenv:Body>" +
    `<ar:${action}>` +
    "<ar:Auth>" +
    `<ar:Token>${xmlEsc(token)}</ar:Token>` +
    `<ar:Sign>${xmlEsc(sign)}</ar:Sign>` +
    `<ar:Cuit>${cfg.cuit}</ar:Cuit>` +
    "</ar:Auth>" +
    `${inner}` +
    `</ar:${action}>` +
    "</soapenv:Body></soapenv:Envelope>";
  if (action === "FEDummy") {
    body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
      'xmlns:ar="http://ar.gov.afip.dif.FEV1/">' +
      "<soapenv:Header/><soapenv:Body><ar:FEDummy/></soapenv:Body></soapenv:Envelope>";
  }
  const xml = await postSoap(URLS[cfg.ambiente].wsfe, body, `http://ar.gov.afip.dif.FEV1/${action}`);
  const fault = uno(xml, "faultstring");
  if (fault) throw new AfipError(`AFIP: ${fault}`);
  return xml;
}

export async function probarAfip() {
  const cfg = await cfgFromDb();
  await login(cfg);
  const root = await wsfe(cfg, "", "FEDummy");
  return {
    ok: true,
    ambiente: cfg.ambiente === "homo" ? "homologación" : "producción",
    appserver: uno(root, "AppServer") || "ok",
    dbserver: uno(root, "DbServer") || "ok",
    authserver: uno(root, "AuthServer") || "ok",
  };
}

async function ultimo(cfg: AfipCfg, cbte: number) {
  const root = await wsfe(
    cfg,
    `<ar:PtoVta>${cfg.pto}</ar:PtoVta><ar:CbteTipo>${cbte}</ar:CbteTipo>`,
    "FECompUltimoAutorizado",
  );
  const errores = texts(root, "Msg");
  const nro = uno(root, "CbteNro");
  if (!nro && errores.length) throw new AfipError("AFIP: " + errores.slice(0, 3).join(" "));
  if (!nro) throw new AfipError("AFIP no informó el último número de comprobante.");
  return parseInt(nro, 10);
}

async function alicuotaIva(): Promise<number> {
  const rows = await all("SELECT clave, valor FROM config");
  const map: Record<string, string> = {};
  for (const r of rows) map[String(r.clave)] = String(r.valor ?? "");
  let pct = parseFloat(String(map.iva_alicuota || "21").replace(",", "."));
  if (!Number.isFinite(pct) || pct < 0) pct = 21;
  return pct;
}

async function ivaId(pct: number): Promise<number> {
  const rows = await all("SELECT clave, valor FROM config");
  const map: Record<string, string> = {};
  for (const r of rows) map[String(r.clave)] = String(r.valor ?? "");
  const raw = String(map.afip_iva_id || "").trim();
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  if (Math.abs(pct - 10.5) < 0.05) return 4;
  if (Math.abs(pct - 27) < 0.05) return 6;
  if (pct <= 0) return 3;
  return 5;
}

function importes(total: number, cbte: number, alicuota: number) {
  const t = Math.round(total * 100) / 100;
  if (cbte === 11 || alicuota <= 0) return { total: t, neto: t, iva: 0 };
  const factor = 1 + alicuota / 100;
  const neto = Math.round((t / factor) * 100) / 100;
  const iva = Math.round((t - neto) * 100) / 100;
  return { total: t, neto, iva };
}

export async function emitirAfip(opts: {
  tipo: string;
  cliente: { cuit?: string | null; nombre?: string };
  fecha: string;
  total: number;
}) {
  const cfg = await cfgFromDb();
  let tipo = opts.tipo;
  if (cfg.condicion.includes("monotribut")) tipo = "factura_c";
  const cbte = CBTE[tipo];
  if (!cbte) throw new AfipError("Para facturar en blanco elegí factura A, B o C.");
  const doc = String(opts.cliente?.cuit || "").replace(/\D/g, "");
  if (cbte === 1 && doc.length !== 11) throw new AfipError("La factura A necesita el CUIT del cliente.");
  const docTipo = doc.length === 11 ? 80 : 99;
  const docNro = docTipo === 80 ? doc : "0";
  const alic = await alicuotaIva();
  const { total: impTotal, neto: impNeto, iva: impIva } = importes(opts.total, cbte, alic);
  if (impTotal <= 0) throw new AfipError("El total de la factura tiene que ser mayor a cero.");
  const nro = (await ultimo(cfg, cbte)) + 1;
  let fch = String(opts.fecha || "").slice(0, 10).replace(/-/g, "");
  if (fch.length !== 8) {
    const d = arNow();
    const p = (n: number) => String(n).padStart(2, "0");
    fch = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  }
  let ivaXml = "";
  if (cbte !== 11 && impIva > 0) {
    const id = await ivaId(alic);
    ivaXml =
      `<ar:Iva><ar:AlicIva><ar:Id>${id}</ar:Id>` +
      `<ar:BaseImp>${impNeto.toFixed(2)}</ar:BaseImp>` +
      `<ar:Importe>${impIva.toFixed(2)}</ar:Importe>` +
      "</ar:AlicIva></ar:Iva>";
  }
  const det =
    "<ar:FeCAEReq><ar:FeCabReq>" +
    "<ar:CantReg>1</ar:CantReg>" +
    `<ar:PtoVta>${cfg.pto}</ar:PtoVta>` +
    `<ar:CbteTipo>${cbte}</ar:CbteTipo>` +
    "</ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>" +
    "<ar:Concepto>1</ar:Concepto>" +
    `<ar:DocTipo>${docTipo}</ar:DocTipo>` +
    `<ar:DocNro>${docNro}</ar:DocNro>` +
    `<ar:CbteDesde>${nro}</ar:CbteDesde>` +
    `<ar:CbteHasta>${nro}</ar:CbteHasta>` +
    `<ar:CbteFch>${fch}</ar:CbteFch>` +
    `<ar:ImpTotal>${impTotal.toFixed(2)}</ar:ImpTotal>` +
    "<ar:ImpTotConc>0</ar:ImpTotConc>" +
    `<ar:ImpNeto>${impNeto.toFixed(2)}</ar:ImpNeto>` +
    "<ar:ImpOpEx>0</ar:ImpOpEx>" +
    `<ar:ImpIVA>${impIva.toFixed(2)}</ar:ImpIVA>` +
    "<ar:ImpTrib>0</ar:ImpTrib>" +
    "<ar:MonId>PES</ar:MonId>" +
    "<ar:MonCotiz>1</ar:MonCotiz>" +
    `${ivaXml}` +
    "</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>";
  const root = await wsfe(cfg, det, "FECAESolicitar");
  const resultado = uno(root, "Resultado");
  const cae = uno(root, "CAE");
  let vto = uno(root, "CAEFchVto");
  const msgs = texts(root, "Msg");
  if (resultado !== "A" || !cae) {
    throw new AfipError(msgs.slice(0, 4).join(" ") || "AFIP no autorizó el comprobante.");
  }
  if (/^\d{8}$/.test(vto)) vto = `${vto.slice(0, 4)}-${vto.slice(4, 6)}-${vto.slice(6, 8)}`;
  return {
    cae,
    cae_vto: vto,
    numero: nro,
    numero_txt: `${String(cfg.pto).padStart(5, "0")}-${String(nro).padStart(8, "0")}`,
    punto_venta: String(cfg.pto),
    tipo_afip: String(cbte),
    neto: impNeto,
    iva: impIva,
    alicuota: alic,
  };
}
