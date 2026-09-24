import { createHmac, pbkdf2Sync, scryptSync, timingSafeEqual } from "node:crypto";
import { hashSync, compareSync } from "bcryptjs";
import type { APIContext } from "astro";
import { one } from "./db";

export const COOKIE = "gasonor_sesion";
export const ROLES = ["admin", "despacho", "reparto", "cobrador"] as const;
export type Rol = (typeof ROLES)[number] | string;

export const ROLES_INFO = [
  { id: "admin", nombre: "Administrador", detalle: "Acceso al sistema completo: usuarios, catálogo, informes y planta." },
  { id: "despacho", nombre: "Despacho", detalle: "Despacha y recepciona en planta, gestiona catálogo y remitos." },
  { id: "reparto", nombre: "Reparto", detalle: "Hoja de ruta del día, marca paradas, y puede despachar / recibir tubos de cliente desde el celular." },
  { id: "cobrador", nombre: "Cobrador", detalle: "Solo cobra: gases, reguladores, ventas y salidas de efectivo." },
];

export type Usuario = {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
  activo: number;
};

function secret() {
  return import.meta.env.AUTH_SECRET || process.env.AUTH_SECRET || "gasonor-cambiar-en-produccion";
}

export function hashPassword(password: string) {
  return hashSync(password, 10);
}

export function verifyPassword(stored: string, password: string) {
  if (!stored) return false;
  if (stored.startsWith("$2")) return compareSync(password, stored);
  if (stored.startsWith("scrypt:")) {
    const [meta, salt, hex] = stored.split("$");
    const [, n, r, p] = meta.split(":");
    const derived = scryptSync(password, salt, hex.length / 2, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    try {
      return timingSafeEqual(Buffer.from(hex, "hex"), derived);
    } catch {
      return false;
    }
  }
  if (stored.startsWith("pbkdf2:")) {
    const [meta, salt, hex] = stored.split("$");
    const parts = meta.split(":");
    const iters = Number(parts[2] || 600000);
    const digest = parts[1] || "sha256";
    const derived = pbkdf2Sync(password, salt, iters, hex.length / 2, digest);
    const expected = Buffer.from(hex, "hex");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }
  return false;
}

function b64url(buf: Buffer | string) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sign(payload: { uid: number; exp: number }) {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret()).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

function unsign(token: string): { uid: number; exp: number } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(createHmac("sha256", secret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!json.uid || json.exp < Date.now()) return null;
    return json;
  } catch {
    return null;
  }
}

export function setSession(ctx: APIContext, uid: number) {
  const token = sign({ uid, exp: Date.now() + 14 * 24 * 60 * 60 * 1000 });
  ctx.cookies.set(COOKIE, token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
    maxAge: 14 * 24 * 60 * 60,
  });
}

export function clearSession(ctx: APIContext) {
  ctx.cookies.delete(COOKIE, { path: "/" });
}

export function normalizarRol(rol: string): string {
  const r = (rol || "").trim();
  if (r === "despacho_total" || r === "despacho_general" || r === "despacho") return "despacho";
  return r;
}

export async function usuarioSesion(ctx: APIContext): Promise<Usuario | null> {
  const token = ctx.cookies.get(COOKIE)?.value;
  if (!token) return null;
  const data = unsign(token);
  if (!data) return null;
  const row = await one("SELECT id, usuario, nombre, rol, activo FROM usuarios WHERE id=? AND activo=1", [data.uid]);
  if (!row) return null;
  return {
    id: Number(row.id),
    usuario: String(row.usuario),
    nombre: String(row.nombre),
    rol: normalizarRol(String(row.rol)),
    activo: Number(row.activo),
  };
}

export function puede(u: Usuario | null | undefined, ...roles: string[]) {
  if (!u) return false;
  const r = normalizarRol(String(u.rol));
  if (r === "admin") return true;
  return roles.some((need) => {
    if (need === "despacho") return r === "despacho";
    return r === need;
  });
}

export function puedeConceptos(u: Usuario | null | undefined) {
  return puede(u, "admin", "despacho");
}
