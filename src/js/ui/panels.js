import { contextMenu } from "../lib/context-menu.js";
import { button, div, header, section, span } from "../lib/tiny.js";
import { subscribe } from "../state.js";
import { grip } from "./split.js";

const panels = [];
const grips = new Map();

let focused = null;
let remember = null;

export const add = (panel) => (panels.push(panel), panel);

const found = (id) => panels.find((panel) => panel.id === id) ?? null;

export function focus(id) {
  const panel = found(id);
  if (!panel || panel === focused) return;
  focused?.node.removeAttribute("data-focus");
  focused = panel;
  panel.node.setAttribute("data-focus", "");
}

const live = (verb) => !verb.separator && (!verb.when || verb.when());

function pressed(event) {
  if (event.target.closest("input, textarea")) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key === "Tab") {
    const at = panels.indexOf(focused);
    const by = event.shiftKey ? -1 : 1;
    focus(panels[(at + by + panels.length) % panels.length].id);
    event.preventDefault();
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!focused?.move) return;
    event.preventDefault();
    focused.move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }

  const verb = (focused?.verbs?.() ?? []).find(
    (entry) => entry.key === event.key,
  );
  if (!verb || !live(verb)) return;
  event.preventDefault();
  verb.run();
}

/*
    A press plays its animation first and runs the command from the animation's own
    end event. The command redraws the panel, which builds a new button — so running
    it first would tear the animation's element out from under it.
*/
export function press(node, run) {
  if (node.dataset.running !== undefined) return;
  node.dataset.running = "";

  let gone = false;
  const go = () => {
    if (gone) return;
    gone = true;
    run();
  };

  node.addEventListener("animationend", go, { once: true });
  // An element that never animates — reduced motion, a style that did not load —
  // never fires animationend, and the command still has to run.
  setTimeout(go, 400);
}

/*
    Buttons whose command is still running. A spinner has to last as long as the
    command does, and draw() builds a new button each time, so the fact lives here
    rather than on the element.
*/
const spinning = new Set();

const key = (panel, action) => `${panel.id}\u0000${action.text}`;

export const spins = (id) => spinning.has(id);

export async function spin(id, run) {
  if (spinning.has(id)) return;
  spinning.add(id);
  draw();
  try {
    await run();
  } finally {
    spinning.delete(id);
    draw();
  }
}

const reveal = (panel) =>
  panel.body
    .querySelector("[data-selected]")
    ?.scrollIntoView({ block: "nearest" });

export function draw() {
  for (const panel of panels) {
    const count = panel.count?.();
    const actions = (panel.actions?.() ?? []).filter(live);
    panel.head.replaceChildren(
      span({ dataset: { part: "name" } }, panel.title()),
      ...(count ? [span({ dataset: { part: "count" } }, count)] : []),
      ...actions.map((action) => {
        const id = key(panel, action);
        const turning = spins(id);
        return button(
          {
            dataset: { part: "action", ...(turning ? { running: "" } : {}) },
            disabled: turning,
            title: action.text,
            onclick: () => spin(id, action.run),
          },
          // The label stays in place and only goes invisible, so the button keeps
          // its width and the row beside it does not shift while one runs.
          span(
            { dataset: { part: "label" } },
            action.icon
              ? span({ dataset: { part: "icon", icon: action.icon } })
              : action.text,
          ),
          ...(turning ? [span({ dataset: { part: "spinner" } })] : []),
        );
      }),
    );
    panel.body.replaceChildren(panel.render());
    reveal(panel);
  }
}

export function onLayout(keep) {
  remember = keep;
}

export function layout() {
  return Object.fromEntries(
    [...grips]
      .map(([name, bar]) => [name, bar.at()])
      .filter(([, px]) => px !== null),
  );
}

export function relayout(sizes) {
  for (const [name, px] of Object.entries(sizes ?? {}))
    grips.get(name)?.set(px);
}

const settled = () => remember?.(layout());

function bar(axis, pane, name) {
  const made = grip({ axis, pane, name, settled });
  grips.set(name, made);
  return made.handle;
}

export function mount(start) {
  for (const host of ["left", "right"]) {
    const column = document.getElementById(host);
    const mine = panels.filter((panel) => panel.host === host);
    mine.forEach((panel, index) => {
      panel.head = header({ dataset: { part: "head" } });
      panel.body = div({ dataset: { part: "body" } });
      panel.node = section(
        {
          dataset: { part: "panel", panel: panel.id },
          style: { flex: panel.flex ?? "1 1 0" },
          onmousedown: () => focus(panel.id),
          oncontextmenu: (event) => {
            event.preventDefault();
            focus(panel.id);
            panel.point?.(event);
            const verbs = panel.verbs?.() ?? [];
            if (verbs.length === 0) return;
            contextMenu(
              event,
              verbs.map((verb) =>
                verb.separator
                  ? verb
                  : { ...verb, run: live(verb) ? verb.run : null },
              ),
            );
          },
        },
        panel.head,
        panel.body,
      );
      column.append(panel.node);
      if (index < mine.length - 1)
        column.append(bar("y", panel.node, panel.id));
    });
  }

  const columns = document.getElementById("columns");
  const left = document.getElementById("left");
  columns.insertBefore(bar("x", left, "columns"), left.nextSibling);

  focused = found(start) ?? panels[0];
  focused.node.setAttribute("data-focus", "");
  document.addEventListener("keydown", pressed);
  subscribe(draw);
  draw();
}
