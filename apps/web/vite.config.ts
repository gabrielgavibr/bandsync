/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const API_TARGET = process.env.VITE_API_PROXY ?? "http://localhost:8787";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "BandSync",
        short_name: "BandSync",
        description: "Your band. Your music. In sync.",
        theme_color: "#0b0f14",
        background_color: "#0b0f14",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        lang: "en",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Never cache API responses or WebSocket upgrades; the app shell is precached.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: API_TARGET, ws: true, changeOrigin: false },
    },
  },
  build: { sourcemap: true, target: "es2022" },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
    css: false,
  },
});
