# Gasonor

Sitio web oficial de **Gasonor S.R.L.** — Droguería de gases medicinales e industriales en Rosario.

El público ve el mismo sitio. El personal entra de forma camuflada:

- Mantener el **logo** del encabezado ~2 segundos, o tocarlo **5 veces** seguidas
- O tocar el **año** del copyright en el pie (`© 2026`)

Eso abre `/acceso` → login → sistema en `/app` (despacho, recepción, reparto), con datos en Turso.

## Stack

- [Astro](https://astro.build) 6
- Tailwind CSS 4
- Turso (libSQL) para la base
- Deploy en Vercel (páginas públicas estáticas + APIs)

## Desarrollo local

Copiar `.env.example` a `.env` y completar:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `AUTH_SECRET` (cadena larga aleatoria)

```bash
npm install
npm run migrate
npm run dev
```

Abrir [http://localhost:4321](http://localhost:4321)

- Sitio público: `/`
- Acceso interno: logo (mantener / 5 toques) o año del pie → `/acceso`
- Programa: `/app/`

`npm run migrate` sube el catálogo local (`data/gaschor.db` del sistema de escritorio) a Turso. Hay que haber abierto al menos una vez `start.bat` en el proyecto de trazabilidad para generar esa base.

## Deploy en Vercel

1. Repositorio [LDiStefanoR/Gasonor](https://github.com/LDiStefanoR/Gasonor)
2. Framework Preset: **Astro**
3. Build Command: `npm run build`
4. Node.js: **22.x**
5. Variables de entorno (Production y Preview):
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `AUTH_SECRET`

No subas el archivo `.env` al repositorio.

## Roles

| Usuario inicial | Clave | Uso |
|---|---|---|
| admin | gasonor | Sistema completo |
| despacho | despacho | Planta: escanear, despachar, recibir |
| reparto | reparto | Hoja de ruta del día |

Cambiá estas claves en Usuarios apenas esté en internet.

## Estructura

- `src/pages/` — Sitio público + `/acceso` + `/app`
- `src/pages/api/` — APIs del programa interno
- `public/interno/` — Interfaz de trazabilidad (cámara, sonidos, remitos)
- `public/assets/` — Imágenes del sitio público
