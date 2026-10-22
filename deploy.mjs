#!/usr/bin/env node
// Deploys the app from this Mac through the Netlify MCP. The Netlify project is not
// linked to GitHub, so a push does not deploy: every production deploy costs 15 credits
// from the team's shared monthly cap, and deploys happen on purpose.
//
//   node deploy.mjs --stage                                  stage only, print the folder
//   node deploy.mjs --site-id <id> --proxy-path "<url>"      stage, upload, wait for the build
//
// Get the two values from the Netlify MCP's deploy-site operation (project
// artists-way-companion). The MCP uploader zips everything in the folder it runs in,
// so only public/ and netlify.toml go into a temp folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argAfter = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : null;
};

export function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "artists-way-deploy-"));
  fs.cpSync(path.join(ROOT, "public"), path.join(dir, "public"), {
    recursive: true,
    filter: (src) => path.basename(src) !== ".DS_Store",
  });
  fs.copyFileSync(path.join(ROOT, "netlify.toml"), path.join(dir, "netlify.toml"));
  const files = [];
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.relative(dir, path.join(d, e.name))),
    );
  walk(dir);
  return { dir, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const s = stage();
    console.log(`artists-way: staged ${s.files.length} files in ${s.dir}`);
    if (process.argv.includes("--stage")) process.exit(0);
    const siteId = argAfter("--site-id");
    const proxy = argAfter("--proxy-path");
    if (!siteId || !proxy) throw new Error("give --site-id and --proxy-path (from the Netlify MCP deploy-site operation), or --stage");
    const res = spawnSync("npx", ["-y", "@netlify/mcp@latest", "--site-id", siteId, "--proxy-path", proxy], { cwd: s.dir, stdio: "inherit" });
    fs.rmSync(s.dir, { recursive: true, force: true });
    process.exit(res.status || 0);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
