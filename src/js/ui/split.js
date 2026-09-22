import { div } from "../lib/tiny.js";

const NARROWEST = 64;

const along = (axis) => (axis === "x" ? "width" : "height");

const size = (element, axis) => element.getBoundingClientRect()[along(axis)];

function room(pane, axis) {
  const parent = pane.parentElement;
  const taken = [...parent.children]
    .filter((child) => child !== pane)
    .reduce(
      (total, child) =>
        total +
        (child.dataset.part === "handle" ? size(child, axis) : NARROWEST),
      0,
    );
  return size(parent, axis) - taken;
}

export function grip({ axis, pane, name, settled }) {
  const handle = div({
    dataset: { part: "handle", axis, ...(name ? { name } : {}) },
    role: "separator",
    ariaOrientation: axis === "x" ? "vertical" : "horizontal",
    tabIndex: 0,
  });

  let at = null;

  function set(px) {
    at = Math.round(
      Math.min(Math.max(px, NARROWEST), Math.max(NARROWEST, room(pane, axis))),
    );
    pane.style.flex = `0 0 ${at}px`;
  }

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.toggleAttribute("data-dragging", true);
    const from = size(pane, axis);
    const grabbed = axis === "x" ? event.clientX : event.clientY;

    const drag = (moved) =>
      set(from + (axis === "x" ? moved.clientX : moved.clientY) - grabbed);
    const drop = () => {
      handle.removeEventListener("pointermove", drag);
      handle.toggleAttribute("data-dragging", false);
      settled?.(at);
    };

    handle.addEventListener("pointermove", drag);
    handle.addEventListener("pointerup", drop, { once: true });
    handle.addEventListener("pointercancel", drop, { once: true });
  });

  handle.addEventListener("keydown", (event) => {
    const by =
      axis === "x"
        ? { ArrowLeft: -16, ArrowRight: 16 }[event.key]
        : { ArrowUp: -16, ArrowDown: 16 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    set(size(pane, axis) + by);
    settled?.(at);
  });

  return { handle, set, at: () => at };
}
