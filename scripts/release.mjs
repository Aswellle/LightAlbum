import { execFileSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import {
  checkReleasePlatforms,
  PLATFORM_SUMMARY,
} from "./release-platforms.mjs";

const TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function run(command, args = []) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

function currentBranch() {
  return run("git", ["branch", "--show-current"]);
}

function version() {
  return run("node", ["scripts/version.mjs", "check"]);
}

function ensureCleanTree() {
  const status = run("git", ["status", "--porcelain"]);

  if (status) {
    fail(
      "Working tree is not clean. Commit all changes before creating a release tag.",
    );
  }
}

function ensureOnMain() {
  const branch = currentBranch();

  if (branch !== "main") {
    fail(`Release tags may only be created from main. Current branch: ${branch}`);
  }
}

function ensureMainIsPushed() {
  const localSha = run("git", ["rev-parse", "HEAD"]);
  const remoteSha = run("git", ["rev-parse", "origin/main"]);

  if (localSha !== remoteSha) {
    fail(
      "Local main does not match origin/main. Push/merge main before releasing.",
    );
  }
}

function ensureTagDoesNotExist(tag) {
  const localExists =
    run("git", ["tag", "--list", tag]) === tag;

  if (localExists) {
    fail(
      `Tag ${tag} already exists locally. Published versions are never reused.`,
    );
  }

  try {
    run("git", ["ls-remote", "--exit-code", "--refs", "origin", `refs/tags/${tag}`]);
    fail(
      `Tag ${tag} already exists on origin. Published versions are never reused.`,
    );
  } catch (error) {
    if (error.status !== 2) {
      throw error;
    }
  }
}

/**
 * 发行矩阵固定为三平台（见 scripts/release-platforms.mjs）：
 * Windows x64 / macOS Apple Silicon / Linux x64。
 * 缺少任一保留平台、或重新引入 macOS Intel，都让预检直接失败。
 */
function ensureReleasePlatforms() {
  const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
  const { ok, missing, forbidden } = checkReleasePlatforms(workflow);

  if (!ok) {
    const reasons = [];
    if (missing.length > 0) reasons.push(`missing ${missing.join(", ")}`);
    if (forbidden.length > 0) reasons.push(`must not ship ${forbidden.join(", ")}`);
    fail(
      `release.yml platform set is wrong: ${reasons.join("; ")}.\n` +
        `Expected ${PLATFORM_SUMMARY}.`,
    );
  }

  console.log(`Platforms: ${PLATFORM_SUMMARY}`);
}

function preflight(tag) {
  if (!TAG_RE.test(tag)) {
    fail(
      `Invalid tag "${tag}". Expected vX.Y.Z.`,
    );
  }

  const expectedVersion = tag.slice(1);

  run("node", ["scripts/version.mjs", "check"]);

  const packageJson = run("node", [
    "-e",
    "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)"
  ]);

  if (packageJson !== expectedVersion) {
    fail(
      `Tag ${tag} does not match package.json version ${packageJson}.`,
    );
  }

  ensureReleasePlatforms();
  ensureCleanTree();
  ensureOnMain();

  run("git", ["fetch", "origin", "main", "--tags", "--prune"]);

  ensureMainIsPushed();
  ensureTagDoesNotExist(tag);
}

function createTag(tag) {
  preflight(tag);

  run("git", [
    "tag",
    "-a",
    tag,
    "-m",
    `LightAlbum ${tag}`,
  ]);

  console.log(`Created annotated tag ${tag}`);

  run("git", [
    "push",
    "origin",
    `refs/tags/${tag}`,
  ]);

  console.log(`Pushed tag ${tag}`);
}

const [command, argument] = process.argv.slice(2);

switch (command) {
  case "preflight":
    if (!argument) {
      fail(
        "Usage: node scripts/release.mjs preflight vX.Y.Z",
      );
    }

    preflight(argument);
    console.log(`Release preflight passed for ${argument}`);
    break;

  case "tag":
    if (!argument) {
      fail(
        "Usage: node scripts/release.mjs tag vX.Y.Z",
      );
    }

    createTag(argument);
    break;

  default:
    console.log(`
LightAlbum release manager

Usage:
  node scripts/release.mjs preflight vX.Y.Z
  node scripts/release.mjs tag vX.Y.Z
`);
    process.exit(command ? 1 : 0);
}
