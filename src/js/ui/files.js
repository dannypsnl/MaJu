import { button, div, li, span, ul } from "../lib/tiny.js";
import * as jj from "../jj/cli.js";
import { act, at, look, state } from "../state.js";
import { add, focus, press } from "./panels.js";

const cursor = () => state.files.findIndex((file) => file.path === state.file);

/*
    Where a file can go from here: one step along the graph, in either direction. A
    direction the graph does not offer at all is left out, but one that exists and is
    merely refused comes back with the reason, so the button can say why rather than
    vanish — jj will not rewrite an immutable commit, and neither a merge nor a fork
    has one neighbour to mean.
*/
function neighbours() {
  const here = at(state.selected);
  if (!here) return [];

  const step = (ways, sign, way) => {
    if (ways.length === 0) return null;
    const to = ways.length === 1 ? ways[0] : null;
    const why = here.immutable
      ? `${here.change} is immutable`
      : !to
        ? `this change has several ${way} changes`
        : to.immutable
          ? `${to.change} is immutable`
          : null;
    return { to, sign, way, why };
  };

  return [
    step(
      state.changes.filter((change) => change.parents.includes(state.selected)),
      "\u2191",
      "newer",
    ),
    step(here.parents.map(at).filter(Boolean), "\u2193", "older"),
  ].filter(Boolean);
}

const moved = (to, path) =>
  act(jj.moveFile(state.root, state.selected, to.change, path));

const shift = (path) =>
  neighbours().map(({ to, sign, way, why }) =>
    button(
      {
        dataset: { part: "shift" },
        type: "button",
        disabled: Boolean(why),
        title: why
          ? `Cannot move ${path}: ${why}`
          : `Move ${path} to the ${way} change ${to.change}`,
        onclick: (event) => {
          event.stopPropagation();
          press(event.currentTarget, () => moved(to, path));
        },
      },
      sign,
    ),
  );

export const files = add({
  id: "files",
  host: "left",
  flex: "2 1 0",
  title: () => "Working Copy",
  count: () => (state.files.length ? String(state.files.length) : ""),

  actions: () => [
    {
      text: "Squash",
      when: () => state.selected,
      run: () => act(jj.squash(state.root, state.selected)),
    },
    {
      text: "Absorb",
      when: () => state.selected,
      run: () => act(jj.absorb(state.root, state.selected)),
    },
  ],

  move(by) {
    if (state.files.length === 0) return;
    const now = cursor();
    const next = now < 0 ? (by > 0 ? 0 : state.files.length - 1) : now + by;
    look(state.files[Math.min(Math.max(next, 0), state.files.length - 1)].path);
  },

  point(event) {
    const row = event.target.closest('[data-part="file"]');
    if (row) look(row.dataset.path);
  },

  verbs: () => [
    ...neighbours().map(({ to, way, why }) => ({
      text: `Move This File To The ${way === "newer" ? "Newer" : "Older"} Change`,
      when: () => state.file && !why,
      run: () => moved(to, state.file),
    })),
    {
      text: "Absorb This File Into Ancestors",
      when: () => state.file && state.selected,
      run: () => act(jj.absorb(state.root, state.selected, state.file)),
    },
    { separator: true },
    {
      text: "Show Whole Change",
      when: () => state.file,
      run: () => look(null),
    },
    {
      text: "Copy Path",
      key: "y",
      when: () => state.file,
      run: () => Neutralino.clipboard.writeText(state.file),
    },
  ],

  render() {
    if (state.files.length === 0)
      return div({ dataset: { part: "empty" } }, "No changes");
    return ul(
      { dataset: { part: "files" } },
      ...state.files.map((file) =>
        li(
          {
            dataset: {
              part: "file",
              kind: file.status,
              path: file.path,
              ...(file.path === state.file ? { selected: "" } : {}),
            },
            title: file.path,
            onclick: () => {
              focus("files");
              look(file.path);
            },
          },
          span({ dataset: { part: "status" } }, file.status),
          span({ dataset: { part: "path" } }, file.path),
          ...shift(file.path),
        ),
      ),
    );
  },
});
