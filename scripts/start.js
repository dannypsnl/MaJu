import { existsSync } from "node:fs";
import { join } from "node:path";

import { runSync } from "./bin.js";

// The framework binaries are gitignored, so a fresh clone has to fetch them once.
const ROOT = join(import.meta.dirname, "..");
const options = { cwd: ROOT };

if (!existsSync(join(ROOT, "bin"))) runSync("@neutralinojs/neu", "neu", ["update"], options);
runSync("@neutralinojs/neu", "neu", ["run"], options);
