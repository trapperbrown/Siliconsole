import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import defaults from "../shared/config/defaults.json" with { type: "json" };

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) } },
  clearScreen: false,
  server: {
    port: defaults.devServer.port,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: defaults.devServer.port + 1 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    fs: { allow: [".."] },
  },
});
