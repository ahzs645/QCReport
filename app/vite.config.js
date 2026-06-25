import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Relative base so the built static bundle works when opened/served from anywhere.
  base: "./",
  server: {
    // The shared core lives one level up in ../scripts/lib — allow Vite to read it.
    fs: { allow: [path.resolve(here, "..")] },
  },
});
