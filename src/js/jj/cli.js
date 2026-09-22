const PATH = "/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH";

const quote = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`;

const LOG_FIELDS = [
  "change_id.short(8)",
  "commit_id.short(8)",
  'if(current_working_copy,"wc","-")',
  'if(empty,"empty","-")',
  'if(conflict,"conflict","-")',
  'local_bookmarks.map(|b| b.name()).join(",")',
  'remote_bookmarks.filter(|b| b.remote() != "git").map(|b| b.name() ++ "@" ++ b.remote()).join(",")',
  'author.timestamp().format("%Y-%m-%d %H:%M")',
  'parents.map(|p| p.change_id().short(8)).join(" ")',
  "description.first_line()",
];

const LOG_TEMPLATE = `${LOG_FIELDS.join(' ++ "\\t" ++ ')} ++ "\\n"`;

const WORKSPACE_FIELDS = [
  "name",
  "root",
  "target.change_id().short(8)",
  "target.commit_id().short(8)",
];

const WORKSPACE_TEMPLATE = `${WORKSPACE_FIELDS.join(' ++ "\\t" ++ ')} ++ "\\n"`;

const REF_FIELDS = [
  "name",
  "remote",
  'if(tracked,"tracked","-")',
  "normal_target.change_id().short(8)",
];

const REF_TEMPLATE = `${REF_FIELDS.join(' ++ "\\t" ++ ')} ++ "\\n"`;

const watchers = new Set();

const history = [];

export const ran = () => history;

export const onRan = (watcher) => {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
};

function record(entry) {
  history.push(entry);
  for (const watcher of watchers) watcher(entry);
}

export async function run(root, args) {
  const command = `PATH=${PATH} jj --color never --no-pager ${args.map(quote).join(" ")}`;
  const { exitCode, stdOut, stdErr } = await Neutralino.os.execCommand(
    command,
    {
      cwd: root,
    },
  );
  const error = (stdErr ?? "").trim();
  const ok = exitCode === 0;
  record({ args, ok, error, at: Date.now() });
  return { ok, out: stdOut ?? "", error };
}

export async function isRepo(root) {
  const { ok } = await run(root, ["workspace", "root"]);
  return ok;
}

export async function log(root, limit = 100) {
  const { ok, out, error } = await run(root, [
    "log",
    "-n",
    String(limit),
    "--no-graph",
    "-T",
    LOG_TEMPLATE,
  ]);
  if (!ok) return { error, changes: [] };
  const changes = out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const [
        change,
        commit,
        wc,
        empty,
        conflict,
        local,
        remote,
        time,
        parents,
      ] = parts;
      return {
        change,
        commit,
        current: wc === "wc",
        empty: empty === "empty",
        conflict: conflict === "conflict",
        bookmarks: local ? local.split(",") : [],
        remotes: remote ? remote.split(",") : [],
        time,
        parents: parents ? parents.split(" ") : [],
        description: parts.slice(9).join("\t"),
      };
    });
  return { error: null, changes };
}

export async function changed(root, change) {
  const { ok, out, error } = await run(root, [
    "diff",
    "--summary",
    "-r",
    change,
  ]);
  if (!ok) return { error, files: [] };
  const files = out
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ status: line[0], path: line.slice(2) }));
  return { error: null, files };
}

export async function diff(root, change, path = null) {
  const args = ["diff", "--git", "-r", change];
  if (path) args.push(path);
  const { ok, out, error } = await run(root, args);
  return { error: ok ? null : error, text: out };
}

export async function workspaces(root) {
  const { ok, out, error } = await run(root, [
    "workspace",
    "list",
    "-T",
    WORKSPACE_TEMPLATE,
  ]);
  if (!ok) return { error, workspaces: [] };
  const list = out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, path, change, commit] = line.split("\t");
      return { name, path, change, commit };
    });
  return { error: null, workspaces: list };
}

export async function refs(root) {
  const { ok, out, error } = await run(root, [
    "bookmark",
    "list",
    "--all-remotes",
    "-T",
    REF_TEMPLATE,
  ]);
  if (!ok) return { error, refs: {} };
  const where = {};
  for (const line of out.split("\n").filter(Boolean)) {
    const [name, remote, tracked, change] = line.split("\t");
    if (!change || remote === "git") continue;
    const ref = (where[name] ??= { local: null, remotes: {} });
    if (remote)
      ref.remotes[remote] = { change, tracked: tracked === "tracked" };
    else ref.local = change;
  }
  return { error: null, refs: where };
}

export async function remotes(root) {
  const { ok, out, error } = await run(root, ["git", "remote", "list"]);
  if (!ok) return { error, remotes: [] };
  const list = out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(" ");
      return { name: line.slice(0, at), url: line.slice(at + 1) };
    });
  return { error: null, remotes: list };
}

export const describe = (root, change, message) =>
  run(root, ["describe", "-r", change, "-m", message]);

export const create = (root, change) => run(root, ["new", change]);

export const edit = (root, change) => run(root, ["edit", change]);

export const abandon = (root, change) => run(root, ["abandon", change]);

export const squash = (root, change) => run(root, ["squash", "-r", change]);

export const rebaseOne = (root, source, destination) =>
  run(root, ["rebase", "-r", source, "--onto", destination]);

export const rebaseTree = (root, source, destination) =>
  run(root, ["rebase", "-s", source, "--onto", destination]);

export const absorb = (root, change, path = null) =>
  run(root, path ? ["absorb", "-f", change, path] : ["absorb", "-f", change]);

export const squashInto = (root, from, into) =>
  run(root, ["squash", "--from", from, "--into", into]);

export const moveBookmark = (root, name, change) =>
  run(root, ["bookmark", "set", "--allow-backwards", "-r", change, name]);

export const deleteBookmark = (root, name) =>
  run(root, ["bookmark", "delete", name]);

export const pushBookmark = (root, name, remote) =>
  run(root, ["git", "push", "--remote", remote, "-b", name]);

export const trackBookmark = (root, name, remote) =>
  run(root, ["bookmark", "track", `${name}@${remote}`]);

export const untrackBookmark = (root, name, remote) =>
  run(root, ["bookmark", "untrack", `${name}@${remote}`]);

export const addRemote = (root, name, url) =>
  run(root, ["git", "remote", "add", name, url]);

export const undo = (root) => run(root, ["undo"]);

export const addWorkspace = (root, name, path, change) =>
  run(root, ["workspace", "add", "--name", name, "-r", change, path]);

export const forgetWorkspace = (root, name) =>
  run(root, ["workspace", "forget", name]);
