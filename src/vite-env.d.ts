/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STORAGE?: 'supabase' | 'azure'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
