import * as jj from "./jj/cli.js";
import { layout } from "purs/Jj.Graph/index.js";

export const state = {
  root: null,
  repo: false,
  error: null,
  changes: [],
  graph: { width: 0, places: [] },
  selected: null,
  files: [],
  file: null,
  diff: "",
  workspaces: [],
  refs: {},
  remotes: [],
};

const watchers = new Set();

export function subscribe(watcher) {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

export function changed() {
  for (const watcher of watchers) watcher(state);
}

export const here = () =>
  state.changes.find((change) => change.current)?.change ?? null;

export const at = (id) =>
  state.changes.find((change) => change.change === id) ?? null;

export function absolute(path) {
  const parts = (path.startsWith("/") ? path : `${state.root}/${path}`).split(
    "/",
  );
  const out = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0) out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

let ticket = 0;
let asking = 0;

export async function open(root) {
  state.root = root;
  state.selected = null;
  state.file = null;
  await refresh();
}

export async function refresh() {
  if (!state.root) return;
  const mine = ++ticket;
  const where = state.root;
  state.repo = await jj.isRepo(where);
  if (mine !== ticket) return;
  if (!state.repo) {
    Object.assign(state, {
      changes: [],
      graph: { width: 0, places: [] },
      files: [],
      diff: "",
      workspaces: [],
      refs: {},
      remotes: [],
      error: null,
    });
    changed();
    return;
  }
  const [logged, listed, named, hosts] = await Promise.all([
    jj.log(where),
    jj.workspaces(where),
    jj.refs(where),
    jj.remotes(where),
  ]);
  if (mine !== ticket) return;
  state.error =
    logged.error || listed.error || named.error || hosts.error || null;
  state.changes = logged.changes;
  state.workspaces = listed.workspaces;
  state.refs = named.refs;
  state.remotes = hosts.remotes;
  state.graph = layout(
    logged.changes.map((change) => ({
      change: change.change,
      parents: change.parents,
    })),
  );
  if (!logged.changes.some((change) => change.change === state.selected)) {
    state.selected = here();
    state.file = null;
  }
  changed();
  await load();
}

async function load() {
  const asked = state.selected;
  if (!state.root || !asked) {
    state.files = [];
    state.diff = "";
    changed();
    return;
  }
  const mine = ++asking;
  const [listed, shown] = await Promise.all([
    jj.changed(state.root, asked),
    jj.diff(state.root, asked, state.file),
  ]);
  if (mine !== asking || asked !== state.selected) return;
  if (listed.error || shown.error) state.error = listed.error || shown.error;
  state.files = listed.files;
  state.diff = shown.text;
  if (state.file && !listed.files.some((file) => file.path === state.file))
    state.file = null;
  changed();
}

export function select(change) {
  if (state.selected === change) return;
  state.selected = change;
  state.file = null;
  state.files = [];
  state.diff = "";
  changed();
  load();
}

export function look(path) {
  state.file = path;
  changed();
  load();
}

export async function act(promise) {
  const result = await promise;
  await refresh();
  if (result.ok) return;
  state.error = result.error || "jj failed";
  changed();
}
