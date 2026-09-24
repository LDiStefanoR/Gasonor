// @ts-check
import { defineConfig } from "astro/config";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  output: "static",
  adapter: vercel(),
  server: {
    host: true,
    port: 4321,
  },
  vite: {
    plugins: [tailwindcss(), basicSsl()],
    server: {
      host: true,
    },
  },
});
