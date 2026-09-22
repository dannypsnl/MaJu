import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import png2icons from "png2icons";

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
    produces all three. The host does need `zip` and `tar`, which rules out running
    this on Windows without a POSIX toolchain.
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

// zip and tar both name entries relative to the working directory, so they run
// from the staging directory's parent and are handed the bare folder name.
function archive(kind, folder, stem = folder) {
  const name = kind === "zip" ? `${stem}.zip` : `${stem}.tar.gz`;
  const path = join(OUT, name);
  rmSync(path, { force: true }); // zip appends to an existing archive
  // -y keeps symlinks as symlinks, and both tools preserve the executable bit,
  // which is the whole reason this is not a JavaScript zip library.
  if (kind === "zip") run("zip", ["-ryq", name, folder], { cwd: OUT });
  else run("tar", ["-czf", name, folder], { cwd: OUT });
  // The staged tree has served its purpose, except for the .app: that one is the
  // macOS artifact itself, and keeping it saves unzipping to run a local build.
  if (!folder.endsWith(".app")) rmSync(join(OUT, folder), { recursive: true, force: true });
  console.log(`  ${name}`);
  return path;
}

// The binary and resources.neu land side by side in every layout: that is how the
// framework core finds its resources — it looks next to the executable.
function stage(dir, binary, executable) {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, executable);
  cpSync(join(BUILT, binary), target);
  chmodSync(target, 0o755);
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

function macos() {
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
  archive("zip", `${NAME}.app`, `${NAME}-${VERSION}-macos-universal`);
}

function linux() {
  for (const arch of ["x64", "arm64", "armhf"]) {
    const folder = `${NAME}-${VERSION}-linux-${arch}`;
    const dir = join(OUT, folder);
    rmSync(dir, { recursive: true, force: true });
    stage(dir, `${NAME}-linux_${arch}`, NAME);
    cpSync(ICON, join(dir, `${NAME}.png`));
    writeFileSync(join(dir, `${NAME}.desktop`), desktop());
    archive("tar", folder);
  }
}

function windows() {
  const folder = `${NAME}-${VERSION}-windows-x64`;
  const dir = join(OUT, folder);
  rmSync(dir, { recursive: true, force: true });
  // `neu build` has already stamped the icon and version info into the .exe itself.
  stage(dir, `${NAME}-win_x64.exe`, `${NAME}.exe`);
  archive("zip", folder);
}

// `neu build` without --release: the zip it would make there holds every platform
// at once, which is the opposite of what this script is for.
run(join(ROOT, "node_modules", ".bin", "neu"), ["build"]);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log(`\nBundling ${NAME} ${VERSION} into ${OUT}`);
macos();
linux();
windows();
