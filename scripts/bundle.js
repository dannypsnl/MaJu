import { spawnSync } from "node:child_process";
import { createWriteStream, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import png2icons from "png2icons";
import tar from "tar-stream";
import yazl from "yazl";

import { runSync } from "./bin.js";

/*
    `neu build` leaves every platform's binary loose in dist/<name>/, next to one
    shared resources.neu. Nothing in there is something a user can double-click:
    macOS wants an .app directory around the binary, Linux wants the binary paired
    with its resources and a .desktop entry, and Windows wants the .exe and
    resources.neu shipped together. This script runs that build once — the binaries
    are identical across the three — and folds the loose output into one archive per
    platform under dist/bundle/.

    Cross-compiling is not involved: the Neutralinojs binaries for all platforms are
    downloaded by `neu update` and only ever copied here, so a run on any one host
    produces all three. The archives are written in JavaScript rather than by `zip`
    and `tar`, for the same reason: Windows has neither, and its filesystem has no
    executable bit for them to preserve anyway.
*/

const ROOT = join(import.meta.dirname, "..");

const config = JSON.parse(readFileSync(join(ROOT, "neutralino.config.json"), "utf8"));

const NAME = config.cli.binaryName;
const VERSION = config.version;
const ICON = join(ROOT, config.modes.window.icon.replace(/^\//, ""));

const DIST = join(ROOT, (config.cli.distributionPath ?? "dist").replace(/^\/|\/$/g, ""));
// What `neu build` writes, and what everything below copies out of.
const BUILT = join(DIST, NAME);
const OUT = join(DIST, "bundle");

const RESOURCES = "resources.neu";

function run(command, args, options = {}) {
  const { status, error } = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    ...options,
  });
  if (error) throw error;
  if (status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${status}`);
}

/*
    Permissions are not read back off the disk: on Windows chmod does nothing, so
    the staged binary looks no more executable than the icon beside it. stage()
    records what it made executable instead, and the archives are told directly.
*/
const EXECUTABLES = new Set();

// Entries are named relative to OUT, so each archive unpacks into one folder.
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const name = relative(OUT, path).split(sep).join("/");
    if (entry.isDirectory()) {
      yield { path, name: `${name}/`, directory: true, mode: 0o755 };
      yield* walk(path);
    } else {
      yield { path, name, directory: false, mode: EXECUTABLES.has(path) ? 0o755 : 0o644 };
    }
  }
}

// A zip entry's mode carries the file type too; without it unzip sees neither a
// file nor a directory.
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

function zip(folder, destination) {
  const archive = new yazl.ZipFile();
  archive.addEmptyDirectory(`${folder}/`, { mode: S_IFDIR | 0o755 });
  for (const { path, name, directory, mode } of walk(join(OUT, folder))) {
    if (directory) archive.addEmptyDirectory(name, { mode: S_IFDIR | mode });
    else archive.addBuffer(readFileSync(path), name, { mode: S_IFREG | mode });
  }
  archive.end();
  return pipeline(archive.outputStream, createWriteStream(destination));
}

function tarball(folder, destination) {
  const archive = tar.pack();
  archive.entry({ name: `${folder}/`, type: "directory", mode: 0o755 });
  for (const { path, name, directory, mode } of walk(join(OUT, folder))) {
    if (directory) archive.entry({ name, type: "directory", mode });
    else archive.entry({ name, mode }, readFileSync(path));
  }
  archive.finalize();
  return pipeline(archive, createGzip(), createWriteStream(destination));
}

async function archive(kind, folder, stem = folder) {
  const name = kind === "zip" ? `${stem}.zip` : `${stem}.tar.gz`;
  await (kind === "zip" ? zip : tarball)(folder, join(OUT, name));
  // The staged tree has served its purpose, except for the .app: that one is the
  // macOS artifact itself, and keeping it saves unzipping to run a local build.
  if (!folder.endsWith(".app")) rmSync(join(OUT, folder), { recursive: true, force: true });
  console.log(`  ${name}`);
}

// The binary and resources.neu land side by side in every layout: that is how the
// framework core finds its resources — it looks next to the executable.
function stage(dir, binary, executable) {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, executable);
  cpSync(join(BUILT, binary), target);
  EXECUTABLES.add(target);
  cpSync(join(BUILT, RESOURCES), join(dir, RESOURCES));
}

const plist = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleDisplayName</key>
	<string>${NAME}</string>
	<key>CFBundleExecutable</key>
	<string>${NAME}</string>
	<key>CFBundleIconFile</key>
	<string>${NAME}.icns</string>
	<key>CFBundleIdentifier</key>
	<string>${config.applicationId}</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>${NAME}</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>${VERSION}</string>
	<key>CFBundleVersion</key>
	<string>${VERSION}</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.15</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
`;

// Exec is deliberately bare: the tarball is portable, so where it ends up is the
// reader's choice, and only they can fill in the absolute path a launcher needs.
const desktop = () => `[Desktop Entry]
Type=Application
Name=${NAME}
Comment=A jj client
# Point this at wherever you unpacked the tarball before installing the entry.
Exec=${NAME}
Icon=${NAME}
Categories=Development;RevisionControl;
Terminal=false
`;

async function macos() {
  const app = join(OUT, `${NAME}.app`);
  rmSync(app, { recursive: true, force: true });
  // The universal binary covers both Intel and Apple Silicon, so the per-arch mac
  // builds `neu build` also produced are left alone.
  stage(join(app, "Contents", "MacOS"), `${NAME}-mac_universal`, NAME);
  writeFileSync(join(app, "Contents", "Info.plist"), plist());
  writeFileSync(join(app, "Contents", "PkgInfo"), "APPL????");
  mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
  writeFileSync(
    join(app, "Contents", "Resources", `${NAME}.icns`),
    png2icons.createICNS(readFileSync(ICON), png2icons.BILINEAR, 0),
  );

  /*
      Apple Silicon refuses to run a binary with no signature at all, and wrapping
      one in a bundle is the kind of change that can invalidate the signature it
      shipped with. An ad-hoc signature costs nothing and is the difference between
      "damaged and can't be opened" and a normal Gatekeeper prompt. It needs
      Apple's codesign, so on a non-Apple host the bundle simply goes out unsigned.
  */
  if (process.platform === "darwin") {
    run("codesign", ["--force", "--deep", "--sign", "-", app]);
  } else {
    console.log("  (not on macOS: the .app is unsigned)");
  }

  // The archive is named like the others; what unpacks out of it is `MaJu.app`,
  // because that name is the one macOS shows in Finder and the Dock.
  await archive("zip", `${NAME}.app`, `${NAME}-${VERSION}-macos-universal`);
}

async function linux() {
  for (const arch of ["x64", "arm64", "armhf"]) {
    const folder = `${NAME}-${VERSION}-linux-${arch}`;
    const dir = join(OUT, folder);
    rmSync(dir, { recursive: true, force: true });
    stage(dir, `${NAME}-linux_${arch}`, NAME);
    cpSync(ICON, join(dir, `${NAME}.png`));
    writeFileSync(join(dir, `${NAME}.desktop`), desktop());
    await archive("tar", folder);
  }
}

async function windows() {
  const folder = `${NAME}-${VERSION}-windows-x64`;
  const dir = join(OUT, folder);
  rmSync(dir, { recursive: true, force: true });
  // `neu build` has already stamped the icon and version info into the .exe itself.
  stage(dir, `${NAME}-win_x64.exe`, `${NAME}.exe`);
  await archive("zip", folder);
}

// `neu build` without --release: the zip it would make there holds every platform
// at once, which is the opposite of what this script is for.
runSync("@neutralinojs/neu", "neu", ["build"], { cwd: ROOT });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log(`\nBundling ${NAME} ${VERSION} into ${OUT}`);
await macos();
await linux();
await windows();
