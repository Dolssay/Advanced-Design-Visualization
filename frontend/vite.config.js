import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

// One Vite project serves every demo as its own page:
//   /            landing page      (index.html)
//   /demo1/      GTB777 WebViz     (demo1/index.html)
//   /demo2/      eVTOL sizing      (demo2/index.html)
//
// API calls use the same path in every environment. In dev, Vite forwards
// /api/* to the backend unchanged; in the container, nginx does the same.
// So `fetch("/api/v1/evtol/size")` hits the FastAPI route "/api/v1/evtol/size".
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.BACKEND_URL || "http://localhost:8000";

  return {
    server: {
      port: 5173,
      proxy: {
        "/api": { target: backend, changeOrigin: true }
      }
    },
    preview: {
      port: 4173,
      proxy: {
        "/api": { target: backend, changeOrigin: true }
      }
    },
    build: {
      outDir: "dist",
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          demo1: resolve(__dirname, "demo1/index.html"),
          demo2: resolve(__dirname, "demo2/index.html")
        }
      }
    }
  };
});
