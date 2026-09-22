import { resolve } from "node:path";

import { defineConfig } from "vite";

import neutralino from "./scripts/vite-plugin-neutralino.js";
import purescript from "./scripts/vite-plugin-purescript.js";

// `resources/` is what the Neutralino server serves (`documentRoot`), so it doubles
// as Vite's build output. It also holds two things Vite does not generate — the
// client library that `neu update` downloads, and the app icons — hence
// `publicDir` pointing at it in dev and `emptyOutDir: false` on build.
export default defineConfig({
  plugins: [neutralino(), purescript()],
  root: "src",
  resolve: {
    // spago writes to output/, which is outside `root`. Imports name it "purs/".
    alias: { "purs/": `${resolve(import.meta.dirname, "output")}/` },
  },
  publicDir: "../resources",
  build: {
    outDir: "../resources",
    emptyOutDir: false,
    copyPublicDir: false, // publicDir *is* outDir; copying it onto itself is a no-op at best
  },
  server: {
    port: 5173,
    strictPort: true, // neu waits on this exact port, so failing loudly beats silently moving
    watch: {
      /*
          publicDir is also outDir, so a production build run while the dev server
          is up writes straight into the directory it watches. That reads as a
          change to a served file and forces a full page reload.
      */
      ignored: ["**/resources/index.html", "**/resources/assets/**"],
    },
  },
});
