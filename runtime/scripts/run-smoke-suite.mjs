#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJSON = JSON.parse(readFileSync(resolve(runtimeRoot, "package.json"), "utf8"));
const smokeScripts = Object.keys(packageJSON.scripts).filter(
  (name) => name.startsWith("smoke:") && name !== "smoke:all"
);

for (const name of smokeScripts) {
  console.log(`\n[smoke-suite] ${name}`);
  const result = spawnSync("npm", ["run", name], {
    cwd: runtimeRoot,
    env: process.env,
    shell: false,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\nSmoke suite passed (${smokeScripts.length} scripts).`);
