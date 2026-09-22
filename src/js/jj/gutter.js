const LANE = 12;
const ROW = 24;
const MIDDLE = ROW / 2;
const LANES = 6;

const SVG = "http://www.w3.org/2000/svg";

function node(tag, attributes) {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

const at = (lane) => lane * LANE + LANE / 2;

const bend = (from, to, top, bottom) =>
  `M ${at(from)} ${top}` +
  ` C ${at(from)} ${(top + bottom) / 2},` +
  ` ${at(to)} ${(top + bottom) / 2},` +
  ` ${at(to)} ${bottom}`;

const kind = (change) =>
  change.current
    ? "current"
    : change.conflict
      ? "conflict"
      : change.empty
        ? "empty"
        : "change";

export const width = (lanes) => lanes * LANE;

export function gutter(place, lanes, change) {
  const across = width(lanes);
  const svg = node("svg", {
    "data-part": "gutter",
    width: across,
    height: ROW,
    viewBox: `0 0 ${across} ${ROW}`,
    "aria-hidden": "true",
  });

  const draw = (d, lane, dashed) =>
    svg.append(
      node("path", {
        d,
        fill: "none",
        "stroke-width": 1.5,
        "stroke-linecap": "round",
        stroke: `var(--lane-${lane % LANES})`,
        ...(dashed ? { "stroke-dasharray": "1.5 2.5" } : {}),
      }),
    );

  for (const lane of place.through) draw(`M ${at(lane)} 0 V ${ROW}`, lane);
  for (const lane of place.incoming)
    draw(bend(lane, place.column, 0, MIDDLE), lane);
  for (const lane of place.edges)
    draw(bend(place.column, lane, MIDDLE, ROW), lane);

  if (place.elided) {
    const clear = !place.edges.includes(place.column);
    draw(
      clear
        ? `M ${at(place.column)} ${MIDDLE} V ${ROW}`
        : `M ${at(place.column)} ${MIDDLE} l ${LANE * 0.7} ${MIDDLE * 0.8}`,
      place.column,
      true,
    );
  }

  svg.append(
    node("circle", {
      "data-kind": kind(change),
      cx: at(place.column),
      cy: MIDDLE,
      r: 3.5,
      fill: `var(--lane-${place.column % LANES})`,
      stroke: `var(--lane-${place.column % LANES})`,
    }),
  );

  return svg;
}
