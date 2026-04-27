import path from "node:path";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const proxyTarget = process.env.VITE_APP_SERVER_URL || process.env.API_PROXY_TARGET || "http://127.0.0.1:58557";
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string };
const appVersion = packageJson.version ?? "0.0.0";
const publicBase = process.env.VITE_APP_PUBLIC_URL || "/";

// 1. Config ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export default defineConfig({
  base: publicBase,
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 59_176,
    proxy: {
      "/api": proxyTarget,
      "/v1": proxyTarget,
      "/backend-api": proxyTarget,
      "/health": proxyTarget,
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 59_176,
  },
  build: {
    outDir: "build",
    assetsDir: "assets",
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/@tanstack/react-query")) {
            return "vendor-query";
          }
          if (id.includes("node_modules/recharts")) {
            return "vendor-charts";
          }
          return undefined;
        },
      },
    },
  },
});
