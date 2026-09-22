import { div, li, span, ul } from "../lib/tiny.js";
import * as jj from "../jj/cli.js";
import { act, at, look, state } from "../state.js";
import { add, focus } from "./panels.js";

const cursor = () => state.files.findIndex((file) => file.path === state.file);

export const files = add({
  id: "files",
  host: "left",
  flex: "2 1 0",
  title: () => {
    const change = at(state.selected);
    if (!change) return "Files";
    return change.current ? "Files — working copy" : `Files — ${change.change}`;
  },
  count: () => (state.files.length ? String(state.files.length) : ""),

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
    if (state.files.length === 0) return div({ dataset: { part: "empty" } }, "No changes");
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
        ),
      ),
    );
  },
});
