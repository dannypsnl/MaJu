import { readFileSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";

/*
    The two scripts that bootstrap the Neutralinojs client are injected here rather
    than written into src/index.html, because `neu run` rewrites whatever file
    `cli.frontendLibrary.patchFile` points at — in place, on disk — and only restores
    it if the CLI exits cleanly. Leaving that key out of the config disables the
    patching, and this plugin covers what the patching was there to do.

    In production the framework core serves the page and handles both paths itself.
    In development Vite serves the page instead, so `__neutralino_globals.js` — which
    defines NL_PORT, NL_TOKEN and friends — has to be fetched from the core, whose
    port is random per run and published in .tmp/auth_info.json.
*/

const AUTH_INFO = ".tmp/auth_info.json";
const GLOBALS_DEV_PATH = "/neutralino-globals.js";
const GLOBALS_PROD_PATH = "/__neutralino_globals.js";
const CLIENT_PATH = "/js/neutralino.js";

const RETRY_TIMEOUT_MS = 10_000;
const RETRY_INTERVAL_MS = 100;

/*
    The token in the globals is handed out once per run of the framework core
    (`tokenSecurity: one-time`), and WebKit asks for a script twice — once from
    its preload scanner, once to run it — so the second request would come back
    without a token. The dev server fetches once per core run and serves that
    body to every request; a new run writes new auth info, which is the cue to
    fetch again.
*/
let served = { auth: null, body: null };

async function fetchGlobals() {
  const deadline = Date.now() + RETRY_TIMEOUT_MS;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const auth = readFileSync(AUTH_INFO, "utf8");
      if (served.auth === auth) return served.body;
      const { nlPort } = JSON.parse(auth);
      const response = await fetch(`http://127.0.0.1:${nlPort}${GLOBALS_PROD_PATH}`);
      if (response.ok) {
        served = { auth, body: await response.text() };
        return served.body;
      }
      lastError = new Error(`core responded ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }

  throw lastError ?? new Error("timed out");
}

export default function neutralino() {
  let assetsDir = null;

  return {
    name: "neutralino",

    configResolved(config) {
      if (config.command !== "build") return;

      const dir = resolve(config.root, config.build.outDir, config.build.assetsDir);
      // The delete below is recursive, so refuse anything outside the project.
      assetsDir = dir.startsWith(process.cwd() + sep) ? dir : null;
    },

    buildStart() {
      // The output directory is the framework core's documentRoot, so it also holds
      // the client library and the icons and cannot be emptied wholesale. Clearing
      // just Vite's own output keeps every build's hashed files from piling up in
      // the directory `neu build` packages.
      if (assetsDir) {
        rmSync(assetsDir, { recursive: true, force: true });
      }
    },

    configureServer(server) {
      server.middlewares.use(GLOBALS_DEV_PATH, async (_req, res) => {
        res.setHeader("Content-Type", "text/javascript");
        // The token is handed out once per run, so this must never be cached.
        res.setHeader("Cache-Control", "no-store");
        try {
          res.end(await fetchGlobals());
        } catch (error) {
          res.statusCode = 503;
          res.end(`throw new Error("Neutralino globals unavailable: ${error.message}");`);
        }
      });
    },

    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const tags = [{ tag: "script", attrs: { src: CLIENT_PATH }, injectTo: "body" }];
        if (ctx.server) {
          tags.unshift({ tag: "script", attrs: { src: GLOBALS_DEV_PATH }, injectTo: "body" });
        }
        return tags;
      },
    },
  };
}
