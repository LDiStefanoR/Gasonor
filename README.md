# Gasonor

Sitio web oficial de **Gasonor S.R.L.** — Droguería de gases medicinales e industriales en Rosario.

## Stack

- [Astro](https://astro.build) 6
- Tailwind CSS 4
- Sitio estático (`output: static`)

## Desarrollo local

```bash
npm install
npm run dev
```

Abrir [http://localhost:4321](http://localhost:4321)

## Build

```bash
npm run build
npm run preview
```

## Deploy en Vercel

1. Importar el repositorio [LDiStefanoR/Gasonor](https://github.com/LDiStefanoR/Gasonor)
2. Framework Preset: **Astro**
3. Build Command: `npm run build`
4. Output Directory: `dist`
5. Node.js: **22.x** (requerido por Astro 6)

No requiere variables de entorno para el deploy estático.

## Estructura

- `src/pages/` — Páginas del sitio
- `src/components/` — Header, Footer, etc.
- `public/assets/` — Imágenes y recursos
- `dist/` — Salida de producción (generada, no commitear)
