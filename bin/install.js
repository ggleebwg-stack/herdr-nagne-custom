#!/usr/bin/env node
// Install the kit on this machine: mods, the supervisor layout, worker templates, hw and the
// session hook script. Run it with  npx github:ggleebwg-stack/herdr-nagne-custom [--dry-run]
// Anything it replaces is moved first to ~/.herdr-config-backup/<time>/ (nothing is deleted).
// providers.json and herdr's settings.json are yours: it never edits them. keys.json and
// ~/.claude/settings.json are edited only with --keys / --claude-hooks, after a backup copy (on
// Windows --keys also adds Ctrl+V image paste to ~/.claude/keybindings.json).
// --codex-rules adds the kit's own ~/.codex/rules/herdr-nagne.rules (Codex's other rules are untouched).
// --hermes-status adds the herdr-status plugin to Hermes Agent and enables it (`hermes plugins enable`).
// Run it again to update: files that are already the same are left alone, the projects root of
// the supervisor layout is kept, and ~/.config/herdr-nagne/installed.json records the version.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { ask: cmd, drift } = require("./compat");

const USAGE = "usage: npx github:ggleebwg-stack/herdr-nagne-custom [--dry-run] [--projects-root <dir>] [--keys] [--claude-hooks] [--codex-rules] [--hermes-status] [--history-mb <MB>]";
const opt = { dry: false, root: null, keys: false, hooks: false, codexRules: false, hermes: false, historyMb: null };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--dry-run") opt.dry = true;
  else if (a === "--keys") opt.keys = true;
  else if (a === "--claude-hooks") opt.hooks = true;
  else if (a === "--codex-rules") opt.codexRules = true;
  else if (a === "--hermes-status") opt.hermes = true;
  else if (a === "--projects-root" && process.argv[i + 1]) opt.root = process.argv[++i];
  else if (a.startsWith("--projects-root=")) opt.root = a.slice("--projects-root=".length);
  else if (a === "--history-mb" && /^\d+$/.test(process.argv[i + 1] || "") && +process.argv[i + 1] >= 1 && +process.argv[i + 1] <= 500) opt.historyMb = +process.argv[++i];
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

// herdr writes these into every mod folder, Python its bytecode into the Hermes plugin; they are
// not part of the kit.
const HERDR_OWNED = (name) => name.endsWith(".d.ts") || name === "jsconfig.json" || name.endsWith(".pyc");
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
  const want = filesUnder(src).filter((f) => !HERDR_OWNED(path.basename(f)));
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

// Session logs used to sit in sessions/<terminal>.jsonl; they now go per herdr-core
// (sessions/<core id>/), since two cores on one computer share terminal addresses. Move the old
// ones under this computer's core so sessions open right now can still be resumed.
{
  const dir = path.join(NAGNE, "sessions");
  const flat = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^t[0-9a-z]+\.jsonl$/.test(f)) : [];
  if (flat.length) {
    const r = cmd("hc", ["server", "status", "--json"]);
    let core = null;
    try { core = JSON.parse(r.stdout).core.id; } catch {}
    if (/^[0-9a-f]{8,64}$/.test(core || "")) {
      if (DRY) console.log(`would move ${flat.length} session log(s) into ${path.join(dir, core)}`);
      else {
        fs.mkdirSync(path.join(dir, core), { recursive: true });
        for (const f of flat) {
          const to = path.join(dir, core, f);
          if (fs.existsSync(to)) fs.appendFileSync(to, fs.readFileSync(path.join(dir, f)));
          else fs.renameSync(path.join(dir, f), to);
          fs.rmSync(path.join(dir, f), { force: true });
        }
      }
    }
  }
}

// PowerShell and cmd can't run an extensionless script (Codex on Windows runs its commands in
// PowerShell): a .cmd beside each, which PowerShell picks first. hw needs Git's bash, not WSL's.
function gitBash() {
  const git = (spawnSync("where", ["git"], { encoding: "utf8" }).stdout || "").split(/\r?\n/)[0].trim();
  const roots = [
    process.env.CLAUDE_CODE_GIT_BASH_PATH && path.resolve(process.env.CLAUDE_CODE_GIT_BASH_PATH, "..", ".."),
    git && path.resolve(path.dirname(git), ".."), // Git\cmd\git.exe
    git && path.resolve(path.dirname(git), "..", ".."), // Git\mingw64\bin\git.exe
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Git"),
  ];
  return roots.filter(Boolean).map((r) => path.join(r, "bin", "bash.exe")).find((f) => fs.existsSync(f)) || null;
}
let noGitBash = false;
if (process.platform === "win32") {
  const bash = gitBash();
  if (bash) put(null, path.join(BIN, "hw.cmd"), { text: `@echo off\r\n"${bash}" "%~dp0hw" %*\r\n` });
  else noGitBash = true;
  put(null, path.join(BIN, "herdr-link.cmd"), { text: `@echo off\r\nnode "%~dp0herdr-link" %*\r\n` });
}

// Codex runs commands in a sandbox that is denied the herdr-core pipe, so a Codex supervisor
// can't start workers. The kit's rules file lets hw and hc's look-only commands out.
const CODEX = path.join(HOME, ".codex");
const codexRules = path.join(CODEX, "rules", "herdr-nagne.rules");
const codexTodo = fs.existsSync(CODEX) && !opt.codexRules && !fs.existsSync(codexRules);
if (opt.codexRules || fs.existsSync(codexRules)) put(path.join(REPO, "codex.rules"), codexRules);

// herdr lists a terminal as an agent only when its program reports a status (OSC 7501). Hermes
// Agent doesn't; the herdr-status plugin reports it from Hermes' hooks. Hermes plugins are opt-in,
// so a new install also enables it.
const HERMES = process.env.HERMES_HOME
  || (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || path.join(HOME, "AppData", "Local"), "hermes") : path.join(HOME, ".hermes"));
const hermesPlugin = path.join(HERMES, "plugins", "herdr-status");
const hermesHad = fs.existsSync(hermesPlugin);
const hermesTodo = fs.existsSync(HERMES) && !opt.hermes && !hermesHad;
let hermesNote = null;
if (opt.hermes || hermesHad) {
  put(path.join(REPO, "hermes", "herdr-status"), hermesPlugin);
  if (opt.hermes && !DRY) {
    const r = cmd("hermes", ["plugins", "enable", "herdr-status"], { stdio: ["ignore", "pipe", "pipe"] });
    hermesNote = r.status === 0
      ? "Hermes: herdr-status enabled; restart running Hermes sessions to load it"
      : `Hermes: could not enable herdr-status (${r.error ? "hermes not found on PATH" : (r.stderr || r.stdout).trim().split(/\r?\n/).pop()}); run  hermes plugins enable herdr-status`;
  }
}

// How much history herdr-core keeps per terminal: `history_mb` in its own config.toml (read when a
// terminal starts). The scrollback mod shows and sets the same line.
const CORE_CONFIG = process.env.APPDATA
  ? path.join(process.env.APPDATA, "herdr-core", "config.toml")
  : path.join(HOME, ".config", "herdr-core", "config.toml");
if (opt.historyMb) {
  const old = fs.existsSync(CORE_CONFIG) ? fs.readFileSync(CORE_CONFIG, "utf8") : null;
  // Only the part before the first [section] is top level in TOML.
  const top = (old || "").split(/^\s*\[/m)[0];
  const KEY = /^\s*history_mb\s*=.*$/m;
  const line = `history_mb = ${opt.historyMb}`;
  const text = KEY.test(top) ? top.replace(KEY, line) + (old || "").slice(top.length) : `${line}\n${old || ""}`;
  if (text === old) unchanged++;
  else if (DRY) console.log(`would set ${line} in ${CORE_CONFIG}`);
  else {
    if (old !== null) backupCopy(CORE_CONFIG);
    else replaced++;
    fs.mkdirSync(path.dirname(CORE_CONFIG), { recursive: true });
    fs.writeFileSync(CORE_CONFIG, text);
    changedNames.push("config.toml");
  }
}

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

// Image paste in Claude Code on Windows. herdr's Ctrl+V pastes clipboard text itself and passes the
// key on when the clipboard holds only an image, but Claude Code on Windows pastes images with
// Alt+V, not Ctrl+V. Binding Ctrl+V to chat:imagePaste makes the usual key work (also with --keys).
const CLAUDE_KEYS = path.join(HOME, ".claude", "keybindings.json");
let claudeKeyMissing = false;
const claudeKeys = readJson(CLAUDE_KEYS, {});
if (process.platform === "win32") {
  const blocks = (claudeKeys.bindings ||= []);
  let chat = blocks.find((b) => b && b.context === "Chat");
  if (!chat) blocks.push((chat = { context: "Chat", bindings: {} }));
  const have = (chat.bindings ||= {});
  if (!("ctrl+v" in have)) {
    have["ctrl+v"] = "chat:imagePaste";
    claudeKeyMissing = true;
  } else if (have["ctrl+v"] !== "chat:imagePaste") {
    keyNotes.push(`  Claude Code ctrl+v is already bound to ${JSON.stringify(have["ctrl+v"])}; kept it (images paste with Alt+V)`);
  }
}
if (opt.keys && claudeKeyMissing) {
  console.log(`${DRY ? "would add" : "added"} Ctrl+V image paste to ${CLAUDE_KEYS}`);
  changedNames.push("~/.claude/keybindings.json");
  if (!DRY) {
    if (fs.existsSync(CLAUDE_KEYS)) backupCopy(CLAUDE_KEYS);
    fs.mkdirSync(path.dirname(CLAUDE_KEYS), { recursive: true });
    fs.writeFileSync(CLAUDE_KEYS, JSON.stringify(claudeKeys, null, 2) + "\n");
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
const keysTodo = (keysMissing || claudeKeyMissing) && !opt.keys;
const hooksTodo = hooksMissing && !opt.hooks;

// Let herdr itself validate what was installed.
const checks = [];
if (!DRY) {
  for (const m of list("mods", (n) => fs.statSync(path.join(REPO, "mods", n)).isDirectory())) {
    const r = cmd("herdr-app", ["check", path.join(APP, "mods", m)]);
    if (r.error) {
      checks.push("herdr-app not found on PATH: mods were copied but not checked");
      break;
    }
    if (r.status !== 0) checks.push(`mod ${m} failed herdr-app check:\n${(r.stdout + r.stderr).trim()}`);
  }
}

// herdr updates itself; say so when it is no longer the version the kit was tested with.
const untested = drift().map((v) =>
  `${v.program} is ${v.have} here; the kit was tested with ${v.want}. If a mod or hw misbehaves, update the kit (run this again) or open an issue.`);

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
if (keysTodo) steps.push(`Add the bindings: run again with --keys (herdr's keys.json${process.platform === "win32" ? ", and Ctrl+V image paste in Claude Code" : ""}), or copy keys.snippet.json into ${KEYS} by hand`);
if (!opt.root && !keptRoot) steps.push(`Set your projects folder: run again with --projects-root <dir> (now ${root})`);
steps.push(`Switch layout: ${process.platform === "darwin" ? "Cmd+Shift+L" : "Ctrl+Shift+L"}, or  herdr-app do layout.switch '{"name":"supervisor"}'`);
steps.push("Choose providers and sign in: Ctrl+Shift+U (Providers window)");
if (hooksTodo) steps.push("Resume after a reboot: run again with --claude-hooks (adds two hooks to ~/.claude/settings.json)");
if (hermesTodo) steps.push("Hermes Agent in the Agents list: run again with --hermes-status (adds and enables Hermes' herdr-status plugin)");
if (codexTodo) steps.push("Codex as the supervisor: run again with --codex-rules (lets hw and hc ls/get/wait/read out of Codex's sandbox)");

console.log(`
${headline}${replaced && !DRY ? ` Replaced and edited files are backed up in ${BK}` : ""}
${onPath ? "" : `Add ${BIN} to your PATH so hw is found.\n`}${hermesNote ? `${hermesNote}\n` : ""}${noGitBash ?"Git for Windows (bin\\bash.exe) not found: hw runs from Git Bash only, not from PowerShell or Codex.\n" : ""}${rootMissing ? `Warning: the projects folder ${root} does not exist; the Projects list will be empty. Use --projects-root <dir>.\n` : ""}${keyNotes.length ? `Key bindings left as they were:\n${keyNotes.join("\n")}\n` : ""}${checks.length ? `${checks.join("\n")}\n` : ""}${untested.length ? `${untested.join("\n")}\n` : ""}Next:
${steps.map((t, i) => `  ${i + 1}. ${t}`).join("\n")}
More: https://github.com/ggleebwg-stack/herdr-nagne-custom`);
if (checks.some((c) => c.startsWith("mod "))) process.exitCode = 1;
