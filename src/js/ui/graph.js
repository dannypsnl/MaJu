import { contextMenu } from "../lib/context-menu.js";
import { button, div, input, li, span, ul } from "../lib/tiny.js";
import * as jj from "../jj/cli.js";
import { gutter, width } from "../jj/gutter.js";
import { absolute, act, at, here, open, select, state } from "../state.js";
import { add, draw, focus } from "./panels.js";
import { refresh } from "../state.js";
let rebasing = null;
let dragging = null;
let prompting = null;

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
        destination: String(Boolean(rebasing) && rebasing !== change.change),
      },
      draggable: true,
      onclick: (event) => {
        focus("graph");
        choose(change.change, event);
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
  return [
    button({
      dataset: { part: "push" },
      type: "button",
      title: `Push ${bookmark} to ${how.remote}`,
      onclick: (event) => {
        event.stopPropagation();
        act(jj.pushBookmark(state.root, bookmark, how.remote));
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

function ask() {
  const field = input({
    dataset: { part: "field" },
    type: "text",
    value: prompting.value,
    placeholder: prompting.placeholder,
    oninput: () => {
      prompting.value = field.value;
    },
    onkeydown: (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        const { change, run } = prompting;
        const value = field.value;
        settle();
        act(run(change, value));
      } else if (event.key === "Escape") cancel();
    },
  });
  queueMicrotask(() => field.focus());
  return li({ dataset: { part: "asking" } }, field);
}

const describing = (change) =>
  asking({
    change: change.change,
    value: change.description,
    placeholder: "Description",
    run: (id, value) => jj.describe(state.root, id, value),
  });

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
  return [
    { text: "Edit", key: "e", run: () => act(jj.edit(state.root, id)) },
    { text: "New Child", key: "n", run: () => act(jj.create(state.root, id)) },
    { separator: true },
    { text: "Describe…", key: "d", run: () => describing(change) },
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
      run: () => act(jj.squash(state.root, id)),
    },
    {
      text: "Absorb Into Ancestors",
      run: () => act(jj.absorb(state.root, id)),
    },
    {
      text: rebasing === id ? "Rebasing… pick a destination" : "Rebase…",
      key: "r",
      when: () => rebasing !== id,
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
