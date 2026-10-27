#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const next = process.argv[2];
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

if (!next || !semver.test(next)) {
  console.error("Usage: npm run version:set -- <semver>");
  process.exit(1);
}

async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

async function writeJson(file, value) {
  await writeFile(
    path.join(root, file),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

async function replace(file, pattern, replacement) {
  const full = path.join(root, file);
  const input = await readFile(full, "utf8");
  const output = input.replace(pattern, replacement);
  if (output === input) {
    throw new Error(`version field not found in ${file}`);
  }
  await writeFile(full, output, "utf8");
}

const packageJson = await readJson("package.json");
packageJson.version = next;
await writeJson("package.json", packageJson);

const lock = await readJson("package-lock.json");
lock.version = next;
if (lock.packages?.[""]) {
  lock.packages[""].version = next;
}
await writeJson("package-lock.json", lock);

await replace(
  "Cargo.toml",
  /(\[workspace\.package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
  `$1${next}$2`,
);

const { stdout } = await promisify(execFile)(
  "cargo",
  ["metadata", "--no-deps", "--format-version", "1", "--offline"],
  { cwd: root, maxBuffer: 10 * 1024 * 1024 },
);
const workspacePackages = JSON.parse(stdout).packages.map(({ name }) => name);

let cargoLock = await readFile(path.join(root, "Cargo.lock"), "utf8");
for (const name of workspacePackages) {
  const pattern = new RegExp(
    `(\\[\\[package\\]\\]\\nname = "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\nversion = ")[^"]+(")`,
    "g",
  );
  if (!cargoLock.match(pattern)) {
    throw new Error(`package ${name} not found in Cargo.lock`);
  }
  cargoLock = cargoLock.replace(pattern, `$1${next}$2`);
}
await writeFile(path.join(root, "Cargo.lock"), cargoLock, "utf8");

const configPath = "apps/desktop/src-tauri/tauri.conf.json";
const config = await readJson(configPath);
const configHasVersion = Object.hasOwn(config, "version");
if (configHasVersion) {
  config.version = next;
  await writeJson(configPath, config);
}

console.log(`Set Tactile version to ${next}.`);
console.log(
  configHasVersion
    ? "Updated package.json, package-lock.json, Cargo.toml, Cargo.lock, and tauri.conf.json."
    : "Updated package.json, package-lock.json, Cargo.toml, and Cargo.lock; tauri.conf.json reads the crate version.",
);
