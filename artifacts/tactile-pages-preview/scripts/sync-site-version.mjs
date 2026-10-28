#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const output = path.join(root, "site/assets/version.js");

await writeFile(
  output,
  [
    "// Generated from package.json. Run `npm run version:site` after manual edits.",
    `export const APP_VERSION = ${JSON.stringify(packageJson.version)};`,
    "",
  ].join("\n"),
  "utf8",
);

console.log(`Synced site version to ${packageJson.version}.`);
