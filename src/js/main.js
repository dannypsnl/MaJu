import "./ui/status.js";
import "./ui/files.js";
import "./ui/graph.js";
import "./ui/diff.js";
import "./ui/command-log.js";

import * as jj from "./jj/cli.js";
import { open, refresh, state, subscribe } from "./state.js";
import { draw, mount, onLayout, relayout } from "./ui/panels.js";

Neutralino.init();

mount("graph");

let queued = false;
jj.onRan(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    draw();
  });
});

Neutralino.events.on("windowFocus", refresh);

Neutralino.events.on("windowClose", () => Neutralino.app.exit());

const save = (key, value) => Neutralino.storage.setData(key, value).catch(() => {});

async function saved(key) {
  try {
    return (await Neutralino.storage.getData(key)) || null;
  } catch {
    return null;
  }
}

onLayout((sizes) => save("layout", JSON.stringify(sizes)));

let remembered = null;
subscribe(() => {
  if (state.root === remembered) return;
  remembered = state.root;
  const name = state.root?.split("/").filter(Boolean).pop();
  Neutralino.window.setTitle(name ? `MaJu — ${name}` : "MaJu").catch(() => {});
  save("root", state.root ?? "");
});

async function start() {
  const sizes = await saved("layout");
  if (sizes) {
    try {
      relayout(JSON.parse(sizes));
    } catch {
    }
  }
  await open((await saved("root")) ?? NL_CWD);
}

start();
