import { createLogger, defineConfig, type Logger } from "vite";
import react from "@vitejs/plugin-react";

const resetErrorCodes = ["ECONNABORTED", "ECONNRESET", "EPIPE"];
const viteLogger = createLogger();

const quietProxyResetLogger: Logger = {
  ...viteLogger,
  error(message, options) {
    const code = options?.error && "code" in options.error ? options.error.code : undefined;
    if (message.includes("ws proxy socket error:") && resetErrorCodes.includes(String(code))) {
      return;
    }
    viteLogger.error(message, options);
  },
};

function configureProxy(proxy: { on: (event: "error", handler: (error: NodeJS.ErrnoException) => void) => void }) {
  proxy.on("error", (error) => {
    if (resetErrorCodes.includes(error.code || "")) {
      return;
    }
    console.warn("[vite] proxy error:", error.message);
  });
}

export default defineConfig({
  customLogger: quietProxyResetLogger,
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
