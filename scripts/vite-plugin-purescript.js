import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/*
    spago builds the whole workspace at once and writes to output/ at the
    workspace root, so the build runs there whichever package Vite is serving.
    The root is the nearest ancestor whose spago.yaml has a `workspace:` key —
    the monorepo root today, the package itself once it is a repo of its own.
*/
function workspaceRoot(from) {
  let dir = resolve(from);
  for (;;) {
    const config = resolve(dir, "spago.yaml");
    if (existsSync(config) && /^workspace:/m.test(readFileSync(config, "utf8"))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`no spago workspace above ${from}`);
    dir = up;
  }
}

export default function purescript({ sources = "src/purs" } = {}) {
  const root = workspaceRoot(process.cwd());

  // Serialized: two spago runs at once contend for output/, and saving
  // several files at once would start exactly that.
  let pending = Promise.resolve();

  const compile = () => {
    pending = pending.then(
      () =>
        new Promise((done) => {
          // `spago` from PATH: npm puts the workspace's node_modules/.bin there.
          const spago = spawn("spago", ["build"], { cwd: root, stdio: "inherit" });
          spago.on("close", done);
          spago.on("error", done);
        }),
    );
    return pending;
  };

  return {
    name: "purescript",

    buildStart: compile,

    configureServer(server) {
      server.watcher.add(resolve(sources));
      server.watcher.on("change", (file) => {
        if (file.endsWith(".purs")) compile();
      });
    },
  };
}
