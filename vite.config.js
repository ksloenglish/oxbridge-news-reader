import { defineConfig } from "vite";

// GitHub Pages project site. Locally this stays "/" unless VITE_BASE_PATH is set.
// The Pages workflow sets VITE_BASE_PATH=/${repository.name}/.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
