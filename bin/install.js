#!/usr/bin/env node
// Install the kit on this machine: mods, the supervisor layout, worker templates, hw and the
// session hook script. Run it with  npx github:ggleebwg-stack/herdr-nagne-custom [--dry-run]
// Anything it replaces is moved first to ~/.herdr-config-backup/<time>/ (nothing is deleted).
// keys.json, settings.json, providers.json and ~/.claude/settings.json are yours: it never edits them.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
for (const a of args) {
  if (a !== "--dry-run") {
    console.error(`unknown option ${a}\nusage: npx github:ggleebwg-stack/herdr-nagne-custom [--dry-run]`);
    process.exit(2);
  }
}
const DRY = args.includes("--dry-run");

const REPO = path.resolve(__dirname, "..");
const HOME = os.homedir();
const APP = process.env.HERDR_APP_HOME || path.join(HOME, ".config", "herdr-app");
const CORE_TPL = process.env.APPDATA
  ? path.join(process.env.APPDATA, "herdr-core", "templates")
  : path.join(HOME, ".config", "herdr-core", "templates");
const BIN = path.join(HOME, ".local", "bin");
const NAGNE = path.join(HOME, ".config", "herdr-nagne");
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const BK = path.join(HOME, ".herdr-config-backup",
  `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`);

let replaced = 0;

// Where a replaced file goes in the backup: its path under home, or its full path for anything outside.
function backupPath(dst) {
  const rel = path.relative(HOME, dst);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return path.join(BK, rel);
  return path.join(BK, "_outside", dst.replace(/^([A-Za-z]):/, "$1").replace(/^[\\/]+/, ""));
}

function moveAside(dst) {
  const to = backupPath(dst);
  replaced++;
  if (DRY) return console.log(`would replace ${dst}  (old one -> ${to})`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(dst, to);
  } catch (e) {
    if (e.code !== "EXDEV") throw e;
    fs.cpSync(dst, to, { recursive: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
}

// Copy one file or folder in, moving an existing one aside first.
function put(src, dst, { executable = false } = {}) {
  const existed = fs.existsSync(dst);
  if (existed) moveAside(dst);
  else if (DRY) console.log(`would add ${dst}`);
  if (DRY) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.statSync(src).isDirectory()) {
    // mod.json before main.js: a mod folder that shows up without mod.json gets docked into the
    // shown layout by herdr.
    fs.mkdirSync(dst, { recursive: true });
    const manifest = path.join(src, "mod.json");
    if (fs.existsSync(manifest)) fs.copyFileSync(manifest, path.join(dst, "mod.json"));
    fs.cpSync(src, dst, { recursive: true });
  } else {
    fs.copyFileSync(src, dst);
  }
  if (executable) fs.chmodSync(dst, 0o755);
}

const list = (dir, test) => fs.readdirSync(path.join(REPO, dir)).filter(test).sort();

for (const m of list("mods", (n) => fs.statSync(path.join(REPO, "mods", n)).isDirectory()))
  put(path.join(REPO, "mods", m), path.join(APP, "mods", m));
for (const l of list("layouts", (n) => n.endsWith(".json")))
  put(path.join(REPO, "layouts", l), path.join(APP, "layouts", l));
for (const t of list("templates", (n) => n.endsWith(".md")))
  put(path.join(REPO, "templates", t), path.join(CORE_TPL, t));
for (const b of ["hw", "nagne-session-hook"])
  put(path.join(REPO, b), path.join(BIN, b), { executable: true });

const providers = path.join(NAGNE, "providers.json");
if (fs.existsSync(providers)) console.log(`kept your ${providers}`);
else if (DRY) console.log(`would add ${providers}`);
else {
  fs.mkdirSync(NAGNE, { recursive: true });
  fs.copyFileSync(path.join(REPO, "providers.example.json"), providers);
}

const onPath = (process.env.PATH || "").split(path.delimiter)
  .some((p) => path.resolve(p).toLowerCase() === path.resolve(BIN).toLowerCase());

console.log(`
${DRY ? "Dry run: nothing was changed." : "Installed."}${replaced && !DRY ? ` Replaced files are in ${BK}` : ""}
${onPath ? "" : `Add ${BIN} to your PATH so hw is found.\n`}Next:
  1. Add the bindings in keys.snippet.json to ${path.join(APP, "keys.json")}
  2. Set your projects folder: "root" in ${path.join(APP, "layouts", "supervisor.json")} (default ~/Projects)
  3. Switch layout: Ctrl+Shift+L, or  herdr-app do layout.switch '{"name":"supervisor"}'
  4. Choose providers and sign in: Ctrl+Shift+U (Providers window)
  5. Resume after a reboot: add the two hooks in claude-hooks.snippet.json to ~/.claude/settings.json
     (append them to any SessionStart / SessionEnd lists you already have)
The snippets are in the repository: https://github.com/ggleebwg-stack/herdr-nagne-custom`);
