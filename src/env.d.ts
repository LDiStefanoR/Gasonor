/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly TURSO_DATABASE_URL: string;
  readonly TURSO_AUTH_TOKEN: string;
  readonly AUTH_SECRET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
