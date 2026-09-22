import { div, span } from "./tiny.js";

let showing = null;

const SHOWN = { Escape: "esc", Enter: "\u21a9" };

const MARGIN = 6;

export function close() {
  if (!showing) return;
  showing.abort();
  showing = null;
}

function place(menu, x, y) {
  const { width, height } = menu.getBoundingClientRect();
  const left = x + width + MARGIN > window.innerWidth ? x - width : x;
  const top = y + height + MARGIN > window.innerHeight ? y - height : y;
  menu.style.left = `${Math.max(MARGIN, left)}px`;
  menu.style.top = `${Math.max(MARGIN, top)}px`;
}

const choosable = (menu) => [...menu.querySelectorAll("[data-part='item']:not([data-disabled])")];

function move(menu, by) {
  const items = choosable(menu);
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement);
  const next = at < 0 ? (by > 0 ? 0 : items.length - 1) : (at + by + items.length) % items.length;
  items[next].focus();
}

export function contextMenu(event, items) {
  event.preventDefault();
  close();

  const menu = div({ dataset: { part: "menu" }, role: "menu", tabIndex: -1 });
  const listeners = new AbortController();
  const { signal } = listeners;
  showing = listeners;

  for (const item of items) {
    if (item.separator) {
      menu.append(div({ dataset: { part: "separator" } }));
      continue;
    }
    const row = div(
      {
        dataset: {
          part: "item",
          ...(item.run ? {} : { disabled: "" }),
          ...(item.danger ? { danger: "" } : {}),
        },
        role: "menuitem",
        tabIndex: item.run ? 0 : -1,
        onclick: () => {
          if (!item.run) return;
          close();
          item.run();
        },
        onmouseenter: () => item.run && row.focus(),
      },
      span({ dataset: { part: "text" } }, item.text),
      ...(item.key ? [span({ dataset: { part: "key" } }, SHOWN[item.key] ?? item.key)] : []),
    );
    menu.append(row);
  }

  document.body.append(menu);
  place(menu, event.clientX, event.clientY);
  menu.focus();

  menu.addEventListener(
    "keydown",
    (keyed) => {
      if (keyed.key === "Escape") close();
      else if (keyed.key === "ArrowDown") move(menu, 1);
      else if (keyed.key === "ArrowUp") move(menu, -1);
      else return;
      keyed.preventDefault();
    },
    { signal },
  );

  for (const gone of ["pointerdown", "wheel", "contextmenu"]) {
    document.addEventListener(gone, (outside) => {
      if (!menu.contains(outside.target)) close();
    }, { capture: true, signal });
  }
  window.addEventListener("blur", close, { signal });
  window.addEventListener("resize", close, { signal });

  signal.addEventListener("abort", () => menu.remove());
  return menu;
}
