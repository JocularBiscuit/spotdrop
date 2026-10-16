import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const api = `http://127.0.0.1:${process.env.PORT ?? 5280}`;

// MapLibre loads its web worker (and the module it imports) by a computed URL the bundler can't see.
// Ship both files as-is under /maplibre/ and point MapLibre at them (see MapView.tsx).
const MAPLIBRE_DIST = path.resolve("node_modules/maplibre-gl/dist");
const MAPLIBRE_FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
function maplibreWorker(): Plugin {
  return {
    name: "maplibre-worker",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/^\/maplibre\/([\w.-]+\.mjs)/)?.[1];
        if (!name || !MAPLIBRE_FILES.includes(name)) return next();
        res.setHeader("Content-Type", "text/javascript");
        res.end(fs.readFileSync(path.join(MAPLIBRE_DIST, name)));
      });
    },
    generateBundle() {
      for (const name of MAPLIBRE_FILES) {
        this.emitFile({ type: "asset", fileName: `maplibre/${name}`, source: fs.readFileSync(path.join(MAPLIBRE_DIST, name)) });
      }
    },
  };
}

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss(), maplibreWorker()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: { port: 5173, proxy: { "/api": api, "/media": api } },
});
