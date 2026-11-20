import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Aarogya Drishti",
        short_name: "Aarogya",
        theme_color: "#0f766e",
        background_color: "#f0fdfa",
        display: "standalone",
        start_url: "/",
        icons: []
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{html,js,css,woff,woff2,svg,png,json,mp3,ogg,webp}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: ({ request }) => request.destination === "font", handler: "CacheFirst", options: { cacheName: "aarogya-fonts", expiration: { maxEntries: 30, maxAgeSeconds: 31536000 } } },
          { urlPattern: ({ request, url }) => request.destination === "audio" && url.pathname.includes("/education/"), handler: "CacheFirst", options: { cacheName: "aarogya-audio", expiration: { maxEntries: 30, maxAgeSeconds: 2592000 } } },
          { urlPattern: ({ url }) => url.pathname.includes("/education/") && !url.pathname.includes("/education/manage/"), handler: "StaleWhileRevalidate", options: { cacheName: "aarogya-education", expiration: { maxEntries: 50, maxAgeSeconds: 2592000 } } },
          { urlPattern: ({ request }) => request.destination === "audio", handler: "CacheFirst", options: { cacheName: "aarogya-audio", expiration: { maxEntries: 30, maxAgeSeconds: 2592000 } } }
        ]
      }
    })
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("origin", "http://localhost:5173");
          });
        }
      }
    }
  }
});
