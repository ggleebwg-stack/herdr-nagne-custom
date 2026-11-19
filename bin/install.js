#!/usr/bin/env node
// Install the kit on this machine: mods, the supervisor layout, worker templates, hw and the
// session hook script. Run it with  npx github:ggleebwg-stack/herdr-nagne-custom [--dry-run]
// Anything it replaces is moved first to ~/.herdr-config-backup/<time>/ (nothing is deleted).
// providers.json and herdr's settings.json are yours: it never edits them. keys.json and
// ~/.claude/settings.json are edited only with --keys / --claude-hooks, after a backup copy.
// Run it again to update: files that are already the same are left alone, the projects root of
// the supervisor layout is kept, and ~/.config/herdr-nagne/installed.json records the version.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const USAGE = "usage: npx github:ggleebwg-stack/herdr-nagne-custom [--dry-run] [--projects-root <dir>] [--keys] [--claude-hooks]";
const opt = { dry: false, root: null, keys: false, hooks: false };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--dry-run") opt.dry = true;
  else if (a === "--keys") opt.keys = true;
  else if (a === "--claude-hooks") opt.hooks = true;
  else if (a === "--projects-root" && process.argv[i + 1]) opt.root = process.argv[++i];
  else if (a.startsWith("--projects-root=")) opt.root = a.slice("--projects-root=".length);
  else {
    console.error(`unknown option ${a}\n${USAGE}`);
    process.exit(2);
  }
}
const DRY = opt.dry;

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
let unchanged = 0;
const changedNames = [];

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

// herdr writes these into every mod folder; they are not part of the kit.
const HERDR_OWNED = (name) => name.endsWith(".d.ts") || name === "jsconfig.json";
const filesUnder = (dir, rel = "") =>
  fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(dir, path.join(rel, e.name)) : [path.join(rel, e.name)]);
const sameFile = (a, b) => fs.existsSync(b) && fs.statSync(b).isFile() && fs.readFileSync(a).equals(fs.readFileSync(b));

// Is what is installed at dst already what we would put there? Then an update leaves it alone.
function upToDate(src, dst, text) {
  if (!fs.existsSync(dst)) return false;
  if (text !== undefined) return fs.statSync(dst).isFile() && fs.readFileSync(dst, "utf8") === text;
  if (!fs.statSync(src).isDirectory()) return sameFile(src, dst);
  if (!fs.statSync(dst).isDirectory()) return false;
  const want = filesUnder(src);
  const have = filesUnder(dst).filter((f) => !HERDR_OWNED(path.basename(f)));
  return want.length === have.length && want.every((f) => sameFile(path.join(src, f), path.join(dst, f)));
}

// Copy one file or folder in (or write `text`), moving a different existing one aside first.
function put(src, dst, { executable = false, text } = {}) {
  if (upToDate(src, dst, text)) {
    unchanged++;
    return;
  }
  const existed = fs.existsSync(dst);
  changedNames.push(path.basename(dst));
  if (existed) moveAside(dst);
  else {
    if (DRY) console.log(`would add ${dst}`);
  }
  if (DRY) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (text !== undefined) {
    fs.writeFileSync(dst, text);
  } else if (fs.statSync(src).isDirectory()) {
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

// The projects mod's folder lives in the layout as "root": "...". An update must not reset it.
const ROOT_RE = /"root":\s*("(?:[^"\\]|\\.)*")/;
const readRoot = (file) => {
  try {
    const m = fs.readFileSync(file, "utf8").match(ROOT_RE);
    return m ? JSON.parse(m[1]) : null;
  } catch {
    return null;
  }
};
const expandHome = (p) => (p === "~" || /^~[\\/]/.test(p) ? path.join(HOME, p.slice(1)) : p);

// Back up a file we edit in place (keys.json, ~/.claude/settings.json) into the same backup folder.
function backupCopy(file) {
  replaced++;
  const to = backupPath(file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(file, to);
}
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);

const list = (dir, test) => fs.readdirSync(path.join(REPO, dir)).filter(test).sort();

for (const m of list("mods", (n) => fs.statSync(path.join(REPO, "mods", n)).isDirectory()))
  put(path.join(REPO, "mods", m), path.join(APP, "mods", m));
const SUP = path.join(APP, "layouts", "supervisor.json");
const keptRoot = readRoot(SUP);
const root = opt.root || keptRoot || readRoot(path.join(REPO, "layouts", "supervisor.json"));
if (opt.root) console.log(`projects root: ${root}`);
else if (keptRoot) console.log(`kept your projects root: ${keptRoot}`);
for (const l of list("layouts", (n) => n.endsWith(".json"))) {
  const src = path.join(REPO, "layouts", l);
  // The layout is installed with your projects root in it, so compare and write that text.
  const text = fs.readFileSync(src, "utf8").replace(ROOT_RE, () => `"root": ${JSON.stringify(root)}`);
  put(src, path.join(APP, "layouts", l), { text });
}
const rootMissing = root && !fs.existsSync(expandHome(root));
for (const t of list("templates", (n) => n.endsWith(".md")))
  put(path.join(REPO, "templates", t), path.join(CORE_TPL, t));
for (const b of ["hw", "nagne-session-hook", "herdr-link"])
  put(path.join(REPO, b), path.join(BIN, b), { executable: true });

const providers = path.join(NAGNE, "providers.json");
if (fs.existsSync(providers)) console.log(`kept your ${providers}`);
else if (DRY) console.log(`would add ${providers}`);
else {
  fs.mkdirSync(NAGNE, { recursive: true });
  fs.copyFileSync(path.join(REPO, "providers.example.json"), providers);
}

// Key bindings and the resume hook: always look, so the "Next" list only names what is still
// missing; write only with --keys / --claude-hooks. A key you bound to something else is kept.
const KEYS = path.join(APP, "keys.json");
const keyNotes = [];
const keys = readJson(KEYS, {});
let keysMissing = 0;
for (const [section, binds] of Object.entries(readJson(path.join(REPO, "keys.snippet.json"), {}))) {
  const have = (keys[section] ||= {});
  for (const [key, action] of Object.entries(binds)) {
    if (!(key in have)) {
      have[key] = action;
      keysMissing++;
    } else if (JSON.stringify(have[key]) !== JSON.stringify(action)) {
      keyNotes.push(`  ${section} ${key} is already bound to ${JSON.stringify(have[key])}; kept it`);
    }
  }
}
if (opt.keys && keysMissing) {
  console.log(`${DRY ? "would add" : "added"} ${keysMissing} key binding(s) to ${KEYS}`);
  changedNames.push("keys.json");
  if (!DRY) {
    if (fs.existsSync(KEYS)) backupCopy(KEYS);
    fs.mkdirSync(path.dirname(KEYS), { recursive: true });
    fs.writeFileSync(KEYS, JSON.stringify(keys, null, 2) + "\n");
  }
}

const CLAUDE = path.join(HOME, ".claude", "settings.json");
const settings = readJson(CLAUDE, {});
let hooksMissing = 0;
for (const [event, entries] of Object.entries(readJson(path.join(REPO, "claude-hooks.snippet.json"), {}).hooks)) {
  const list = ((settings.hooks ||= {})[event] ||= []);
  if (JSON.stringify(list).includes("nagne-session-hook")) continue;
  list.push(...entries);
  hooksMissing++;
}
if (opt.hooks && hooksMissing) {
  console.log(`${DRY ? "would add" : "added"} the resume hook to ${hooksMissing} event(s) in ${CLAUDE}`);
  changedNames.push("~/.claude/settings.json");
  if (!DRY) {
    if (fs.existsSync(CLAUDE)) backupCopy(CLAUDE);
    fs.mkdirSync(path.dirname(CLAUDE), { recursive: true });
    fs.writeFileSync(CLAUDE, JSON.stringify(settings, null, 2) + "\n");
  }
}
const keysTodo = keysMissing && !opt.keys;
const hooksTodo = hooksMissing && !opt.hooks;

// Let herdr itself validate what was installed.
const checks = [];
if (!DRY) {
  const { spawnSync } = require("child_process");
  for (const m of list("mods", (n) => fs.statSync(path.join(REPO, "mods", n)).isDirectory())) {
    const r = spawnSync("herdr-app", ["check", path.join(APP, "mods", m)], { encoding: "utf8", shell: process.platform === "win32" });
    if (r.error) {
      checks.push("herdr-app not found on PATH: mods were copied but not checked");
      break;
    }
    if (r.status !== 0) checks.push(`mod ${m} failed herdr-app check:\n${(r.stdout + r.stderr).trim()}`);
  }
}

// Remember which version is installed, so the next run can say what it updated from.
const VERSION = require(path.join(REPO, "package.json")).version;
const STAMP = path.join(NAGNE, "installed.json");
const before = readJson(STAMP, null);
const firstInstall = !before && replaced === 0 && unchanged === 0;
if (!DRY) {
  fs.mkdirSync(NAGNE, { recursive: true });
  fs.writeFileSync(STAMP, JSON.stringify({ version: VERSION, installedAt: now.toISOString() }, null, 2) + "\n");
}
const what = changedNames.length;
const from = before && before.version !== VERSION ? ` from ${before.version}` : "";
const headline = DRY
  ? `Dry run (${VERSION}): nothing was changed. ${what} to add or replace, ${unchanged} already up to date.`
  : firstInstall
    ? `Installed ${VERSION}.`
    : what
      ? `Updated${from} to ${VERSION}: ${changedNames.join(", ")}. ${unchanged} already up to date.`
      : `Already up to date (${VERSION}): nothing to change.`;

const onPath = (process.env.PATH || "").split(path.delimiter)
  .some((p) => path.resolve(p).toLowerCase() === path.resolve(BIN).toLowerCase());

const steps = [];
if (keysTodo) steps.push(`Add the bindings: run again with --keys, or copy keys.snippet.json into ${KEYS} by hand`);
if (!opt.root && !keptRoot) steps.push(`Set your projects folder: run again with --projects-root <dir> (now ${root})`);
steps.push(`Switch layout: ${process.platform === "darwin" ? "Cmd+Shift+L" : "Ctrl+Shift+L"}, or  herdr-app do layout.switch '{"name":"supervisor"}'`);
steps.push("Choose providers and sign in: Ctrl+Shift+U (Providers window)");
if (hooksTodo) steps.push("Resume after a reboot: run again with --claude-hooks (adds two hooks to ~/.claude/settings.json)");

console.log(`
${headline}${replaced && !DRY ? ` Replaced and edited files are backed up in ${BK}` : ""}
${onPath ? "" : `Add ${BIN} to your PATH so hw is found.\n`}${rootMissing ? `Warning: the projects folder ${root} does not exist; the Projects list will be empty. Use --projects-root <dir>.\n` : ""}${keyNotes.length ? `Key bindings left as they were:\n${keyNotes.join("\n")}\n` : ""}${checks.length ? `${checks.join("\n")}\n` : ""}Next:
${steps.map((t, i) => `  ${i + 1}. ${t}`).join("\n")}
More: https://github.com/ggleebwg-stack/herdr-nagne-custom`);
if (checks.some((c) => c.startsWith("mod "))) process.exitCode = 1;
