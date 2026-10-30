/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** The moving and transport front page's own address, once live (docs/HOMEPAGES.md). */
  readonly VITE_TRANSPORT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
