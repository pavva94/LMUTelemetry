import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function configureProxy(proxy: { on: (event: "error", handler: (error: NodeJS.ErrnoException) => void) => void }) {
  proxy.on("error", (error) => {
    if (["ECONNABORTED", "ECONNRESET", "EPIPE"].includes(error.code || "")) {
      return;
    }
    console.warn("[vite] proxy error:", error.message);
  });
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        configure: configureProxy,
      },
      "/ws": {
        target: "ws://127.0.0.1:8000",
        ws: true,
        changeOrigin: true,
        configure: configureProxy,
      },
    },
  },
});
