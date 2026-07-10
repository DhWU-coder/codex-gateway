#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const entry = join(__dirname, "..", "src", "index.ts");
const result = spawnSync("bun", ["run", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
