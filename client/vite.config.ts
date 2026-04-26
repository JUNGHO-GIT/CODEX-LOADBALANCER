/**
 * @file vite.config.ts
 * @description codex-loadbalancer client vite config
 * @author Jungho
 * @since 2026-04-26
 */

import fs from "node:fs";
import path from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, loadEnv, type UserConfig } from "vite";
import viteCompression from "vite-plugin-compression";

// 1. config ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
export default defineConfig(({
  command,
  mode,
}) => {
  // 1-1. init
  const dirName: string = import.meta.dirname;
  const rootDir: string = path.resolve(dirName);
  const envMode: string = mode === "production" ? "production" : "development";
  const isProd: boolean = envMode === "production";
  const isDev: boolean = !isProd;
  const isBuild: boolean = command === "build";

  // 1-2. env load
  const rawEnv: Record<string, string> = loadEnv(envMode, rootDir, "");
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(rawEnv).filter(([key]) => key.startsWith("VITE_")),
  ) as Record<string, string>;

  // 1-3. env file merge
  const noop: () => void = () => {};
  const noopSet: (target: Record<string, string>, key: string, value: string) => void = () => {};
  const setEnv: (target: Record<string, string>, key: string, value: string) => void = (target, key, value) => {
    target[key] = value;
  };

  const mergeEnvFromFile: (filePath: string) => void = (filePath) => {
    const exists: boolean = fs.existsSync(filePath);
    const merge: () => void = () => {
      fs.readFileSync(filePath, { encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => Boolean(line) && !line.startsWith("#"))
      .forEach((line) => {
        const cleaned: string = line.startsWith("export ") ? line.slice(7).trim() : line;
        const idx: number = cleaned.indexOf("=");
        const hasEq: boolean = idx > 0;
        const key: string = hasEq ? cleaned.slice(0, idx).trim() : "";
        const rawVal: string = hasEq ? cleaned.slice(idx + 1).trim() : "";
        const val: string = rawVal.startsWith("\"") && rawVal.endsWith("\"") ? rawVal.slice(1, -1) : rawVal;
        const shouldSet: boolean = hasEq && key.startsWith("VITE_");
        (shouldSet ? setEnv : noopSet)(env, key, val);
      });
    };
    (exists ? merge : noop)();
  };

  mergeEnvFromFile(path.join(rootDir, `.env-${envMode}`));

  // 1-4. derived values
  const baseUrl: string = env.VITE_APP_PUBLIC_URL || "/";
  const publicUrl: string = env.VITE_APP_PUBLIC_URL || "/";
  const backendUrl: string = env.VITE_APP_SERVER_URL || "http://127.0.0.1:58557";

  // 1-5. plugins
  const plugins: NonNullable<UserConfig["plugins"]> = [
    svelte(),
    ...(isProd && isBuild ? [
      viteCompression({
        verbose: false,
        disable: false,
        threshold: 10_240,
        algorithm: "brotliCompress",
        ext: ".br",
        deleteOriginFile: false,
      }),
    ] : []),
  ];

  // 1-6. define
  const defineEnv: Record<string, string> = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)] as const),
  ) as Record<string, string>;

  // 1-7. final config
  const config: UserConfig = {
    base: baseUrl,
    plugins: plugins,
    define: {
      ...defineEnv,
      "process.env.NODE_ENV": JSON.stringify(envMode),
      "process.env.PUBLIC_URL": JSON.stringify(publicUrl),
      "import.meta.env.MODE": JSON.stringify(mode),
      "import.meta.env.DEV": JSON.stringify(isDev),
      "import.meta.env.PROD": JSON.stringify(isProd),
      "import.meta.env.BASE_URL": JSON.stringify(publicUrl),
    },
    envDir: rootDir,
    resolve: {
      alias: {
        "@": path.resolve(dirName, "./src"),
        "@assets": path.resolve(dirName, "./src/assets"),
        "@interfaces": path.resolve(dirName, "./src/interfaces"),
        "@pages": path.resolve(dirName, "./src/pages"),
        "@stores": path.resolve(dirName, "./src/stores"),
        "@exportComponents": path.resolve(dirName, "./src/exports/ExportComponents"),
        "@exportLayouts": path.resolve(dirName, "./src/exports/ExportLayouts"),
        "@exportPages": path.resolve(dirName, "./src/exports/ExportPages"),
        "@exportScripts": path.resolve(dirName, "./src/exports/ExportScripts"),
      },
    },
    css: {
      modules: {
        localsConvention: "camelCase",
      },
    },
    build: {
      outDir: "build",
      assetsDir: "assets",
      sourcemap: false,
      minify: isProd ? "esbuild" : false,
      target: "es2015",
      cssMinify: true,
      chunkSizeWarningLimit: 2048,
      reportCompressedSize: false,
      rollupOptions: {
        output: {
          manualChunks: (id: string): string | undefined => {
            let chunkName: string | undefined;
            if (id.includes("node_modules/svelte") || id.includes("node_modules/lucide-svelte")) {
              chunkName = "svelte";
            }
            return chunkName;
          },
          assetFileNames: (assetInfo) => {
            const info: string[] = assetInfo.name ? assetInfo.name.split(".") : [];
            const extType: string | undefined = info.at(-1);
            const fileName = extType === "css" ? "assets/css/[name].[hash][extname]" : "assets/[name].[hash][extname]";
            return fileName;
          },
          chunkFileNames: "assets/js/[name].[hash].js",
          entryFileNames: "assets/js/[name].[hash].js",
        },
      },
      assetsInlineLimit: 4096,
    },
    esbuild: isProd ? {
      drop: ["console", "debugger"],
      legalComments: "none",
    } : {},
    server: {
      port: 59_176,
      open: true,
      host: true,
      cors: true,
      proxy: {
        "/api": backendUrl,
        "/health": backendUrl,
      },
    },
    preview: {
      port: 59_176,
      open: false,
    },
    optimizeDeps: {
      include: ["svelte", "lucide-svelte"],
    },
  };

  return config;
});
