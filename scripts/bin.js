import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/*
    What npm links into node_modules/.bin is a shell script on Unix and a .cmd file
    on Windows, and Node refuses to spawn a .cmd without a shell. Every package
    these scripts call is itself a Node program, though, so each one is run as
    `node <its bin script>` instead: one command line that works on every host and
    never goes through a shell's quoting rules.
*/
const require = createRequire(import.meta.url);

function entry(pkg, name = pkg) {
  const manifest = require.resolve(`${pkg}/package.json`);
  const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
  return join(dirname(manifest), typeof bin === "string" ? bin : bin[name]);
}

export function runSync(pkg, name, args, options = {}) {
  const { status, error } = spawnSync(process.execPath, [entry(pkg, name), ...args], {
    stdio: "inherit",
    ...options,
  });
  if (error) throw error;
  if (status !== 0) throw new Error(`${name} ${args.join(" ")} exited with ${status}`);
}

export function run(pkg, name, args, options = {}) {
  return spawn(process.execPath, [entry(pkg, name), ...args], { stdio: "inherit", ...options });
}
