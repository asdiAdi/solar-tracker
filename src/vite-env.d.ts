/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LAT?: string;
  readonly VITE_LON?: string;
  readonly VITE_TIMEZONE?: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_X_API_KEY: string;
}
