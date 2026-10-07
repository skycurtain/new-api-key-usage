import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueJsx from "@vitejs/plugin-vue-jsx";
import vueDevTools from "vite-plugin-vue-devtools";

/** 后端母体端口（与根 .env 的 PORT / AGENTS 约定一致） */
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:18456";

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueJsx(), vueDevTools()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      // 契约：/api/* 专属接口；SPA 路由不进 /api（公共约定 §2）
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
