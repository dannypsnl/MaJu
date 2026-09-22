import { div, span } from "../lib/tiny.js";
import * as jj from "../jj/cli.js";
import { act, at, here, open, refresh, state } from "../state.js";
import { add } from "./panels.js";

async function openRepo() {
  const where = await Neutralino.os.showFolderDialog("Open Repository", {
    defaultPath: state.root ?? NL_CWD,
  });
  if (where) await open(where);
}

export const status = add({
  id: "status",
  host: "left",
  flex: "0 0 auto",
  title: () => "Status",

  verbs: () => [
    { text: "Open Repository…", run: openRepo },
    { text: "Refresh", key: "r", when: () => state.root, run: refresh },
    { separator: true },
    {
      text: "Undo Last Operation",
      key: "u",
      when: () => state.repo,
      run: () => act(jj.undo(state.root)),
    },
  ],

  render() {
    if (!state.root) {
      return div({ dataset: { part: "empty" } }, "No repository open");
    }
    const name = state.root.split("/").filter(Boolean).pop();
    if (!state.repo) {
      return div(
        { dataset: { part: "empty" } },
        `${name} is not a jj workspace`,
      );
    }
    const change = at(here());
    const line = div(
      { dataset: { part: "line" } },
      span({ dataset: { part: "where" } }, name),
      span({ dataset: { part: "arrow" } }, "→"),
      span({ dataset: { part: "id" } }, here() ?? "—"),
      span(
        { dataset: { part: "title" } },
        change ? change.description || "(no description set)" : "",
      ),
    );
    if (!state.error) return line;
    return div({}, line, div({ dataset: { part: "error" } }, state.error));
  },
});
