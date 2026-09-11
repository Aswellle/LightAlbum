import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

const FILES = {
  packageJson: path.join(ROOT, "package.json"),
  tauriConfig: path.join(ROOT, "src-tauri", "tauri.conf.json"),
  cargoToml: path.join(ROOT, "src-tauri", "Cargo.toml"),
  cargoLock: path.join(ROOT, "src-tauri", "Cargo.lock"),
};

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function write(file, content) {
  fs.writeFileSync(file, content, "utf8");
}

function loadPackageVersion() {
  const data = JSON.parse(read(FILES.packageJson));
  return data.version;
}

function updateJsonVersion(file, version) {
  const data = JSON.parse(read(file));

  data.version = version;

  write(
    file,
    `${JSON.stringify(data, null, 2)}\n`,
  );
}

function updateCargoTomlVersion(version) {
  const source = read(FILES.cargoToml);

  const updated = source.replace(
    /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`,
  );

  if (updated === source) {
    fail("Could not find [package].version in src-tauri/Cargo.toml");
  }

  write(FILES.cargoToml, updated);
}

function updateCargoLockVersion(version) {
  const source = read(FILES.cargoLock);

  const updated = source.replace(
    /(\[\[package\]\]\nname = "light-album"\nversion = ")[^"]+(")/m,
    `$1${version}$2`,
  );

  if (updated === source) {
    fail(
      'Could not find package "light-album" in src-tauri/Cargo.lock',
    );
  }

  write(FILES.cargoLock, updated);
}

function assertVersion(version) {
  if (!SEMVER_RE.test(version)) {
    fail(
      `Invalid version "${version}". Expected stable SemVer X.Y.Z.`,
    );
  }
}

function checkVersions() {
  const packageVersion = loadPackageVersion();

  const tauriVersion =
    JSON.parse(read(FILES.tauriConfig)).version;

  const cargoSource = read(FILES.cargoToml);
  const cargoMatch = cargoSource.match(
    /\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
  );

  if (!cargoMatch) {
    fail("Could not read Cargo.toml package version.");
  }

  const cargoVersion = cargoMatch[1];

  const lockSource = read(FILES.cargoLock);
  const lockMatch = lockSource.match(
    /\[\[package\]\]\nname = "light-album"\nversion = "([^"]+)"/m,
  );

  if (!lockMatch) {
    fail("Could not read LightAlbum Cargo.lock version.");
  }

  const lockVersion = lockMatch[1];

  const versions = {
    "package.json": packageVersion,
    "tauri.conf.json": tauriVersion,
    "Cargo.toml": cargoVersion,
    "Cargo.lock": lockVersion,
  };

  for (const [name, version] of Object.entries(versions)) {
    assertVersion(version);
    console.log(`${name}: ${version}`);
  }

  const uniqueVersions = new Set(Object.values(versions));

  if (uniqueVersions.size !== 1) {
    fail(
      `Version mismatch detected:\n${JSON.stringify(
        versions,
        null,
        2,
      )}`,
    );
  }

  console.log(`\nVersion check passed: ${packageVersion}`);
}

function setVersion(version) {
  assertVersion(version);

  updateJsonVersion(FILES.packageJson, version);
  updateJsonVersion(FILES.tauriConfig, version);
  updateCargoTomlVersion(version);
  updateCargoLockVersion(version);

  checkVersions();

  console.log(`\nVersion set to ${version}`);
}

function bumpVersion(kind) {
  const current = loadPackageVersion();

  assertVersion(current);

  let [major, minor, patch] = current
    .split(".")
    .map(Number);

  switch (kind) {
    case "major":
      major += 1;
      minor = 0;
      patch = 0;
      break;

    case "minor":
      minor += 1;
      patch = 0;
      break;

    case "patch":
      patch += 1;
      break;

    default:
      fail(
        `Unknown bump type "${kind}". Use major, minor, or patch.`,
      );
  }

  const next = `${major}.${minor}.${patch}`;

  console.log(`${current} -> ${next}`);
  setVersion(next);
}

const [command, argument] = process.argv.slice(2);

switch (command) {
  case "check":
    checkVersions();
    break;

  case "set":
    if (!argument) {
      fail("Usage: node scripts/version.mjs set X.Y.Z");
    }

    setVersion(argument);
    break;

  case "bump":
    if (!argument) {
      fail(
        "Usage: node scripts/version.mjs bump major|minor|patch",
      );
    }

    bumpVersion(argument);
    break;

  default:
    console.log(`
LightAlbum version manager

Usage:
  node scripts/version.mjs check
  node scripts/version.mjs set X.Y.Z
  node scripts/version.mjs bump major|minor|patch
`);
    process.exit(command ? 1 : 0);
}
