import { contextMenu } from "../lib/context-menu.js";
import { button, div, input, li, span, textarea, ul } from "../lib/tiny.js";
import * as jj from "../jj/cli.js";
import { gutter, width } from "../jj/gutter.js";
import { absolute, act, at, here, open, select, state } from "../state.js";
import { add, draw, focus, press, spin, spins } from "./panels.js";
import { refresh } from "../state.js";
let rebasing = null;
let dragging = null;
let prompting = null;

/*
    Marks are a second, plural selection, kept apart from state.selected so that
    Files and Diff keep following the one change under the cursor while a merge is
    being assembled. They live only in this panel, and only as long as their change
    does: jj rewrites change ids all the time, and a mark whose change is gone is
    forgotten rather than carried around as a stale id.
*/
const marked = new Set();

function marks() {
  for (const id of marked) if (!at(id)) marked.delete(id);
  return [...marked];
}

function mark(id) {
  if (!marked.delete(id)) marked.add(id);
  draw();
}

const title = (change) => change.description || "(no description set)";

const cursor = () =>
  state.changes.findIndex((change) => change.change === state.selected);

const on = () => at(state.selected);

const spacesAt = (id) =>
  state.workspaces.filter((space) => space.change === id);

function drifted(label) {
  const [name, remote] = label.split("@");
  const ref = state.refs[name];
  const there = ref?.remotes?.[remote];
  return !(ref?.local && there?.tracked && ref.local === there.change);
}

function standing(name, change) {
  const remotes = Object.entries(state.refs[name]?.remotes ?? {});
  if (state.remotes.length === 0) {
    return {
      mark: "local",
      why: `${name} is only here \u2014 no git remote is set`,
    };
  }
  if (remotes.length === 0) {
    const to = state.remotes[0].name;
    return {
      mark: "push",
      remote: to,
      why: `${name} has not been pushed to ${to}`,
    };
  }
  const loose = remotes.find(([, where]) => !where.tracked);
  if (loose && !remotes.some(([, where]) => where.tracked)) {
    return {
      mark: "track",
      remote: loose[0],
      why: `${name}@${loose[0]} is not tracked`,
    };
  }
  const behind = remotes.filter(
    ([, where]) => where.tracked && where.change !== change,
  );
  if (behind.length === 0) return null;
  return {
    mark: "push",
    remote: behind[0][0],
    why: `${name} is ahead of ${behind.map(([remote]) => remote).join(", ")}`,
  };
}

let dismiss = null;

function settle() {
  dismiss?.abort();
  dismiss = null;
  prompting = null;
}

const cancel = () => {
  settle();
  rebasing = null;
  draw();
};

function asking(next) {
  dismiss?.abort();
  prompting = next;
  dismiss = new AbortController();
  for (const elsewhere of ["click", "contextmenu"]) {
    document.addEventListener(
      elsewhere,
      (event) => {
        if (!event.target.closest('[data-part="asking"]')) cancel();
      },
      { capture: true, signal: dismiss.signal },
    );
  }
  draw();
}

function onto(source, destination, event) {
  rebasing = null;
  contextMenu(event, [
    {
      text: "Rebase Onto",
      run: () => act(jj.rebaseOne(state.root, source, destination)),
    },
    {
      text: "Rebase With Descendants Onto",
      run: () => act(jj.rebaseTree(state.root, source, destination)),
    },
    { separator: true },
    {
      text: "Squash Into",
      run: () => act(jj.squashInto(state.root, source, destination)),
    },
  ]);
}

function takes(change, held = dragging) {
  if (!held) return false;
  if (held.kind === "change") return held.id !== change.change;
  if (held.kind === "space") return held.at !== change.change;
  return !change.bookmarks.includes(held.id);
}

function choose(change, event) {
  if (rebasing && rebasing !== change) {
    onto(rebasing, change, event);
    return;
  }
  settle();
  select(change);
}

function line(change, place, lanes) {
  const node = li(
    {
      dataset: {
        part: "change",
        change: change.change,
        ...(change.change === state.selected ? { selected: "" } : {}),
        ...(marked.has(change.change) ? { marked: "" } : {}),
        destination: String(Boolean(rebasing) && rebasing !== change.change),
      },
      draggable: true,
      onclick: (event) => {
        focus("graph");
        if (event.metaKey || event.ctrlKey) mark(change.change);
        else choose(change.change, event);
      },
      ondragstart: (event) => {
        dragging = { kind: "change", id: change.change };
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", change.change);
      },
      ondragend: () => {
        dragging = null;
        node.removeAttribute("data-drop");
      },
      ondragover: (event) => {
        if (!takes(change)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      ondragenter: () => {
        if (takes(change)) node.setAttribute("data-drop", "");
      },
      ondragleave: (event) => {
        if (!node.contains(event.relatedTarget))
          node.removeAttribute("data-drop");
      },
      ondrop: (event) => {
        const held = dragging;
        dragging = null;
        node.removeAttribute("data-drop");
        if (!takes(change, held)) return;
        if (held.kind === "change") onto(held.id, change.change, event);
        // `jj edit` run from the workspace's own root is what moves that
        // workspace, so the path — not state.root — is the cwd here.
        else if (held.kind === "space")
          act(jj.edit(absolute(held.path), change.change));
        else act(jj.moveBookmark(state.root, held.id, change.change));
      },
    },
    gutter(place, lanes, change),
    ...spacesAt(change.change).map((space) =>
      span({
        dataset: { part: "at", current: String(change.current) },
        draggable: true,
        title: `${space.path}\nDrag ${space.name}@ onto another change to work on it there`,
        textContent: `${space.name}@`,
        ondragstart: (event) => {
          event.stopPropagation();
          dragging = { kind: "space", id: space.name, at: change.change, path: space.path };
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", `${space.name}@`);
        },
        ondragend: () => {
          dragging = null;
        },
      }),
    ),
    span({ dataset: { part: "id" }, textContent: change.change }),
    ...change.bookmarks.map((bookmark) => {
      const how = standing(bookmark, change.change);
      return span(
        {
          dataset: { part: "bookmark", ...(how ? { [how.mark]: "" } : {}) },
          draggable: true,
          title: how?.why ?? `Drag ${bookmark} onto another change to move it`,
          ondragstart: (event) => {
            event.stopPropagation();
            dragging = { kind: "bookmark", id: bookmark };
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", bookmark);
          },
          ondragend: () => {
            dragging = null;
          },
          oncontextmenu: (event) => {
            event.stopPropagation();
            contextMenu(event, bookmarkVerbs(bookmark, change));
          },
        },
        ...ahead(bookmark, how),
        bookmark,
        ...behind(how),
      );
    }),
    ...change.remotes.filter(drifted).map((label) =>
      span({
        dataset: { part: "bookmark", remote: "" },
        textContent: label,
        title: state.refs[label.split("@")[0]]?.remotes[label.split("@")[1]]
          ?.tracked
          ? `${label} is tracked`
          : `${label} is not tracked`,
        oncontextmenu: (event) => {
          event.stopPropagation();
          contextMenu(event, remoteVerbs(label));
        },
      }),
    ),
    span({ dataset: { part: "title" }, textContent: title(change) }),
  );
  if (change.conflict) {
    node.append(
      span({ dataset: { part: "conflict" }, textContent: "conflict" }),
    );
  }
  return node;
}

function ahead(bookmark, how) {
  if (how?.mark !== "push") return [];
  // Per bookmark and remote: two chips can be pushing at once, and each spins alone.
  const id = `push\u0000${bookmark}\u0000${how.remote}`;
  const turning = spins(id);
  return [
    button({
      dataset: { part: "push", ...(turning ? { running: "" } : {}) },
      type: "button",
      disabled: turning,
      title: turning
        ? `Pushing ${bookmark} to ${how.remote}\u2026`
        : `Push ${bookmark} to ${how.remote}`,
      onclick: (event) => {
        event.stopPropagation();
        spin(id, () => act(jj.pushBookmark(state.root, bookmark, how.remote)));
      },
    }),
  ];
}

const behind = (how) =>
  how && how.mark !== "push" ? [span({ dataset: { part: "star" } }, "*")] : [];

function bookmarkVerbs(name, change) {
  const how = standing(name, change.change);
  const remotes = Object.entries(state.refs[name]?.remotes ?? {});
  const items = [];
  if (how?.mark === "local") {
    items.push({
      text: "Set Remote\u2026",
      run: () => addingRemote(change.change),
    });
  }
  if (how?.mark === "track") {
    items.push({
      text: `Track ${name}@${how.remote}`,
      run: () => act(jj.trackBookmark(state.root, name, how.remote)),
    });
  }
  for (const remote of state.remotes) {
    items.push({
      text: `Push ${name} to ${remote.name}`,
      run: () => act(jj.pushBookmark(state.root, name, remote.name)),
    });
  }
  for (const [remote] of remotes.filter(([, where]) => where.tracked)) {
    items.push({
      text: `Untrack ${name}@${remote}`,
      run: () => act(jj.untrackBookmark(state.root, name, remote)),
    });
  }
  items.push({ separator: true });
  items.push({
    text: `Delete Bookmark ${name}`,
    danger: true,
    run: () => act(jj.deleteBookmark(state.root, name)),
  });
  return items;
}

function remoteVerbs(label) {
  const [name, remote] = label.split("@");
  const tracked = state.refs[name]?.remotes?.[remote]?.tracked;
  return [
    tracked
      ? {
          text: `Untrack ${label}`,
          run: () => act(jj.untrackBookmark(state.root, name, remote)),
        }
      : {
          text: `Track ${label}`,
          run: () => act(jj.trackBookmark(state.root, name, remote)),
        },
  ];
}

const ROWS = { least: 3, most: 12 };

function ask() {
  // A description is prose and wants Enter to mean a new line, so submitting
  // moves to the modifier. Every other prompt is one short value, where Enter
  // submitting is the whole point.
  const many = Boolean(prompting.many);
  const submit = () => {
    const { change, run } = prompting;
    const value = field.value;
    settle();
    act(run(change, value));
  };

  const field = (many ? textarea : input)({
    dataset: { part: "field" },
    ...(many
      ? {
          rows: Math.min(
            Math.max(prompting.value.split("\n").length, ROWS.least),
            ROWS.most,
          ),
        }
      : { type: "text" }),
    value: prompting.value,
    placeholder: prompting.placeholder,
    oninput: () => {
      prompting.value = field.value;
    },
    onkeydown: (event) => {
      event.stopPropagation();
      if (event.key === "Escape") cancel();
      else if (event.key === "Enter" && (!many || event.metaKey || event.ctrlKey))
        submit();
    },
  });

  queueMicrotask(() => field.focus());
  return li(
    { dataset: { part: "asking" } },
    field,
    ...(many
      ? [span({ dataset: { part: "hint" } }, "\u2318\u21a9 to save, esc to cancel")]
      : []),
  );
}

async function describing(change) {
  asking({
    change: change.change,
    value: await jj.description(state.root, change.change),
    placeholder: "Description",
    many: true,
    run: (id, value) => jj.describe(state.root, id, value),
  });
}

const naming = (change) =>
  asking({
    change: change.change,
    value: "",
    placeholder: "Bookmark name",
    run: (id, value) =>
      value
        ? jj.moveBookmark(state.root, value, id)
        : Promise.resolve({ ok: true }),
  });

const addingRemote = (change) =>
  asking({
    change,
    value: "",
    placeholder: "Remote URL, added as origin",
    run: (id, value) =>
      value
        ? jj.addRemote(state.root, "origin", value)
        : Promise.resolve({ ok: true }),
  });

async function addWorkspace(change) {
  const where = await Neutralino.os.showFolderDialog("New Workspace", {
    defaultPath: state.root,
  });
  if (!where) return;
  const name = where.split("/").filter(Boolean).pop();
  await act(jj.addWorkspace(state.root, name, where, change));
}

function workspaceVerbs(change) {
  const spaces = spacesAt(change.change);
  if (spaces.length === 0) {
    return [
      { text: "Add Workspace Here…", run: () => addWorkspace(change.change) },
    ];
  }
  return spaces.flatMap((space) => [
    {
      text: `Open Workspace ${space.name}`,
      when: () =>
        space.change !== here() || absolute(space.path) !== state.root,
      run: () => open(absolute(space.path)),
    },
    {
      text: `Forget Workspace ${space.name}`,
      danger: true,
      when: () => absolute(space.path) !== state.root,
      run: () => act(jj.forgetWorkspace(state.root, space.name)),
    },
  ]);
}

function verbs(change) {
  const id = change.change;
  // jj refuses to rewrite an immutable commit, so the verbs that would are shown
  // greyed rather than left to fail — the menu is where the reason belongs.
  const mutable = () => !change.immutable;
  return [
    {
      text: "Edit",
      key: "e",
      when: mutable,
      run: () => act(jj.edit(state.root, id)),
    },
    {
      // Marks, when there are any, are the selection this acts on — several of
      // them is what makes the new change a merge, in marking order, since that
      // is the order jj reads its parents in.
      text: "New Child",
      key: "n",
      run: () => {
        const parents = marks().length > 0 ? marks() : [id];
        marked.clear();
        return act(jj.create(state.root, ...parents));
      },
    },
    {
      text: marked.has(id) ? "Unmark" : "Mark",
      key: " ",
      run: () => mark(id),
    },
    {
      text: "Clear Marks",
      when: () => marks().length > 0,
      run: () => {
        marked.clear();
        draw();
      },
    },
    { separator: true },
    {
      text: "Describe…",
      key: "d",
      when: mutable,
      run: () => describing(change),
    },
    { text: "Set Bookmark…", key: "b", run: () => naming(change) },
    { separator: true },
    {
      text: "Copy Change ID",
      key: "y",
      run: () => Neutralino.clipboard.writeText(id),
    },
    { separator: true },
    {
      text: "Squash Into Parent",
      key: "s",
      when: mutable,
      run: () => act(jj.squash(state.root, id)),
    },
    {
      text: "Absorb Into Ancestors",
      when: mutable,
      run: () => act(jj.absorb(state.root, id)),
    },
    {
      text: rebasing === id ? "Rebasing… pick a destination" : "Rebase…",
      key: "r",
      when: () => rebasing !== id && mutable(),
      run: () => {
        rebasing = id;
        draw();
      },
    },
    { separator: true },
    ...workspaceVerbs(change),
    { separator: true },
    {
      text: "Abandon Change",
      key: "a",
      danger: true,
      when: mutable,
      run: () => act(jj.abandon(state.root, id)),
    },
  ];
}

export const graph = add({
  id: "graph",
  host: "left",
  flex: "3 1 0",
  title: () =>
    rebasing ? `Rebasing ${rebasing} — pick a destination` : "Graph",
  count: () => (state.changes.length ? String(state.changes.length) : ""),

  actions: () => [
    {
      text: "Fetch",
      when: () => state.repo && state.remotes.length > 0,
      run: () => act(jj.fetch(state.root)),
    },
    {
      text: "Undo",
      when: () => state.repo,
      run: () => act(jj.undo(state.root)),
    },
    {
      text: "Redo",
      when: () => state.repo,
      run: () => act(jj.redo(state.root)),
    },
    {
      text: "Refresh",
      when: () => state.repo,
      run: () => act(refresh()),
    },
  ],

  move(by) {
    if (state.changes.length === 0) return;
    const next = Math.min(Math.max(cursor() + by, 0), state.changes.length - 1);
    settle();
    select(state.changes[next].change);
  },

  point(event) {
    const row = event.target.closest('[data-part="change"]');
    if (row) choose(row.dataset.change, event);
  },

  verbs() {
    const change = on();
    if (!change) return [];
    return [
      ...(rebasing
        ? [
            { text: "Cancel Rebase", key: "Escape", run: cancel },
            { separator: true },
          ]
        : []),
      ...verbs(change),
    ];
  },

  render() {
    if (!state.repo)
      return div({ dataset: { part: "empty" } }, "No jj workspace open");
    if (state.changes.length === 0)
      return div({ dataset: { part: "empty" } }, "Empty log");
    const list = ul({ dataset: { part: "changes" } });
    list.style.setProperty("--gutter", `${width(state.graph.width)}px`);
    state.changes.forEach((change, index) => {
      list.append(line(change, state.graph.places[index], state.graph.width));
      if (prompting?.change === change.change) list.append(ask());
    });
    return list;
  },
});
