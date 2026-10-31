/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_OSM_CLIENT_ID?: string;
  readonly VITE_CHECK_INTERVAL_MONTHS?: string;
}
