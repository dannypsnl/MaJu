import "./ui/status.js";
import "./ui/files.js";
import "./ui/graph.js";
import "./ui/diff.js";
import "./ui/command-log.js";

import { basename } from "pathe";

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

const save = (key, value) =>
  Neutralino.storage.setData(key, value).catch(() => {});

async function saved(key) {
  try {
    return (await Neutralino.storage.getData(key)) || null;
  } catch {
    return null;
  }
}

onLayout((sizes) => save("layout", JSON.stringify(sizes)));

const menu = () =>
  Neutralino.window.setMainMenu([
    {
      id: "app",
      text: "MaJu",
      menuItems: [
        { id: "quit", text: "Quit MaJu", shortcut: "q", action: "terminate:" },
      ],
    },
    {
      id: "file",
      text: "File",
      menuItems: [
        { id: "open", text: "Open Repository…", shortcut: "o" },
        { text: "-" },
        {
          id: "refresh",
          text: "Refresh",
          shortcut: "r",
          isDisabled: !state.root,
        },
      ],
    },
  ]);

let remembered = null;
subscribe(() => {
  if (state.root === remembered) return;
  remembered = state.root;
  const name = state.root ? basename(state.root) || state.root : null;
  const title = name ? `MaJu — ${name}` : "MaJu";
  Neutralino.window.setTitle(title).catch(() => {
    console.error("failed to set title");
  });
  save("root", state.root ?? "");
  menu();
});

async function start() {
  const sizes = await saved("layout");
  if (sizes) {
    try {
      relayout(JSON.parse(sizes));
    } catch {}
  }
  // Only reopen what the user picked last time; a fresh install starts with nothing to open. The empty state can point them at File › Open Repository.
  const root = await saved("root");
  if (root) await open(root);
}

await menu();
start();

async function ask_and_change_root() {
  const picked = await Neutralino.os.showFolderDialog("Open Repository", {
    defaultPath: state.root ?? NL_CWD,
  });
  if (picked) await open(picked);
}

Neutralino.events.on("mainMenuItemClicked", (event) => {
  switch (event.detail.id) {
    case "open":
      ask_and_change_root();
      break;

    case "refresh":
      refresh();
      break;
  }
});
