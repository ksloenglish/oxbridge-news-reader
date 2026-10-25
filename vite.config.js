import { defineConfig } from "vite";
import { buildIdentity } from "./src/build-info.js";

const { stamp, year } = buildIdentity();

// GitHub Pages project site. Locally this stays "/" unless VITE_BASE_PATH is set.
// The Pages workflow sets VITE_BASE_PATH=/${repository.name}/.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  define: {
    __KSLO_BUILD__: JSON.stringify(stamp),
    __KSLO_YEAR__: JSON.stringify(year),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
