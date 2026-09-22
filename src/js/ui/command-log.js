import { div, span } from "../lib/tiny.js";
import { ran } from "../jj/cli.js";
import { add } from "./panels.js";

const SHOWN = 300;
const STEP = 20;

const CHATTER = new Set(["log", "diff", "workspace", "bookmark"]);

const quiet = (entry) =>
  entry.ok &&
  CHATTER.has(entry.args[0]) &&
  !["set", "delete", "add", "forget"].includes(entry.args[1]);

export const commandLog = add({
  id: "command-log",
  host: "right",
  flex: "1 1 0",
  title: () => "Command log",

  move(by) {
    this.body.scrollTop += by * STEP;
  },

  render() {
    const shown = ran().filter((entry) => !quiet(entry));
    if (shown.length === 0) {
      return div(
        { dataset: { part: "empty" } },
        "Nothing changed yet \u2014 reads are not listed",
      );
    }
    queueMicrotask(() => {
      const body = commandLog.body;
      if (body.scrollHeight - body.scrollTop - body.clientHeight < 3 * STEP) {
        body.scrollTop = body.scrollHeight;
      }
    });
    return div(
      { dataset: { part: "commands" } },
      ...shown
        .slice(-SHOWN)
        .flatMap((entry) => [
          div(
            { dataset: { part: "command", ok: String(entry.ok) } },
            span({ dataset: { part: "prompt" } }, "jj"),
            span({ dataset: { part: "args" } }, entry.args.join(" ")),
          ),
          ...(entry.error
            ? [
                div(
                  { dataset: { part: "said", ok: String(entry.ok) } },
                  entry.error,
                ),
              ]
            : []),
        ]),
    );
  },
});
