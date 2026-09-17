import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "icons.svg",
        "icon-192.png",
        "icon-512.png",
        "maskable-512.png",
        "apple-touch-icon-180.png",
      ],
      manifest: {
        id: "/",
        name: "JATH Solar Tracker",
        short_name: "JATH Solar",
        description:
          "JATH Solar Tracker: battery, consumption, generated, grid + costs.",
        lang: "en",
        dir: "ltr",
        categories: ["utilities", "lifestyle"],
        theme_color: "#1a1b26",
        background_color: "#1a1b26",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone"],
        orientation: "portrait",
        scope: "/",
        start_url: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        screenshots: [
          {
            src: "screenshots/wide-1280x720.png",
            sizes: "1280x720",
            type: "image/png",
            form_factor: "wide",
          },
          {
            src: "screenshots/narrow-750x1334.png",
            sizes: "750x1334",
            type: "image/png",
            form_factor: "narrow",
          },
        ],
      },
      workbox: {
        runtimeCaching: [],
      },
    }),
  ],
});
