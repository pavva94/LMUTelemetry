/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLOUD_ONLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
