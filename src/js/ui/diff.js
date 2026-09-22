import { div, span } from "../lib/tiny.js";
import { at, state } from "../state.js";
import { add, draw } from "./panels.js";

const FOLDED = 600;
const LINES = 4000;
const STEP = 20;

const opened = new Map();

function kind(line) {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

const NAMED = /^diff --git a\/(?:.*) b\/(.*)$/;

function cut(text) {
  const files = [];
  let file = null;
  let heading = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = {
        path: NAMED.exec(line)?.[1] ?? null,
        note: null,
        adds: 0,
        dels: 0,
        lines: [],
      };
      files.push(file);
      heading = true;
      continue;
    }
    if (!file) continue;
    if (
      heading &&
      !line.startsWith("@@") &&
      !line.startsWith("Binary files ")
    ) {
      if (line.startsWith("new file")) file.note = "new file";
      else if (line.startsWith("deleted file")) file.note = "deleted";
      else if (line.startsWith("rename to ")) file.note = "renamed";
      if (line.startsWith("+++ ") && line !== "+++ /dev/null")
        file.path = line.slice(6);
      else if (line.startsWith("--- ") && line !== "--- /dev/null")
        file.path ??= line.slice(6);
      continue;
    }
    heading = false;
    if (line.startsWith("+")) file.adds += 1;
    else if (line.startsWith("-")) file.dels += 1;
    file.lines.push(line);
  }
  for (const one of files) {
    while (one.lines.length && one.lines.at(-1) === "") one.lines.pop();
  }
  return files;
}

const shows = (file) => opened.get(file.path) ?? file.lines.length <= FOLDED;

function section(file) {
  const open = shows(file);
  const head = div(
    {
      dataset: { part: "file-head" },
      onclick: () => {
        opened.set(file.path, !open);
        draw();
      },
    },
    span({ dataset: { part: "twist" } }, open ? "▾" : "▸"),
    span({ dataset: { part: "path" } }, file.path ?? "(unnamed)"),
    ...(file.note ? [span({ dataset: { part: "note" } }, file.note)] : []),
    span({ dataset: { part: "adds" } }, `+${file.adds}`),
    span({ dataset: { part: "dels" } }, `−${file.dels}`),
  );
  if (!open) {
    return div({ dataset: { part: "file-diff" } }, head);
  }
  const shown = file.lines.slice(0, LINES);
  return div(
    { dataset: { part: "file-diff", open: "" } },
    head,
    div(
      { dataset: { part: "lines" } },
      ...shown.map((line) =>
        div({ dataset: { part: "line", kind: kind(line) } }, line || " "),
      ),
      ...(file.lines.length > shown.length
        ? [
            div(
              { dataset: { part: "line", kind: "more" } },
              `… ${file.lines.length - shown.length} more lines`,
            ),
          ]
        : []),
    ),
  );
}

export const diff = add({
  id: "diff",
  host: "right",
  flex: "3 1 0",
  title: () => "Diff",
  count: () => state.file ?? state.selected ?? "",

  move(by) {
    this.body.scrollTop += by * STEP;
  },

  render() {
    if (!state.selected)
      return div({ dataset: { part: "empty" } }, "Nothing selected");
    const files = cut(state.diff);
    if (files.length === 0) {
      const change = at(state.selected);
      return div(
        { dataset: { part: "empty" } },
        change?.empty ? "Empty change" : "No changed files",
      );
    }
    return div({ dataset: { part: "diff" } }, ...files.map(section));
  },
});
