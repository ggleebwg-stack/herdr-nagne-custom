#!/usr/bin/env node
// Does the kit still fit the herdr installed on this computer? herdr updates itself, so run this
// after it does:   node scripts/compat-check.js
//
// It checks what a machine can check:
//   1. each mod loads (`herdr-app check`: a function a mod imports is gone, a manifest is wrong)
//   2. every herdr command the kit runs still exists (`herdr-app check` does not look at these)
//   3. every hc command and option the kit passes still exists
//   4. the READMEs name the versions in package.json "testedWith"
// and ends with the short list only a person can check. When all of it holds on a new herdr:
//   node scripts/compat-check.js --record     writes the installed versions as the tested ones
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { tested, ask, installed } = require("../bin/compat");

const REPO = path.resolve(__dirname, "..");
const RECORD = process.argv.includes("--record");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const mods = fs.readdirSync(path.join(REPO, "mods")).filter((n) => fs.statSync(path.join(REPO, "mods", n)).isDirectory()).sort();

let failures = 0;
const ok = (text) => console.log(`  ok    ${text}`);
const fail = (text) => { failures++; console.log(`  FAIL  ${text}`); };
const said = (r) => `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();

// --- versions --------------------------------------------------------------------------------
console.log("Versions");
const have = {};
for (const [program, want] of Object.entries(tested)) {
  have[program] = installed(program);
  if (!have[program]) fail(`${program} is not on PATH`);
  else if (have[program] === want) ok(`${program} ${want} (tested)`);
  else console.log(`  new   ${program} ${have[program]} here, tested with ${want}`);
}
const drifted = Object.keys(tested).filter((p) => have[p] && have[p] !== tested[p]);

// --- 1. mods load ----------------------------------------------------------------------------
// herdr writes its type files into a folder it checks, so check a copy and leave the repo as it is.
console.log("\nMods load");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-nagne-check-"));
for (const m of mods) {
  fs.cpSync(path.join(REPO, "mods", m), path.join(scratch, m), { recursive: true });
  const r = ask("herdr-app", ["check", path.join(scratch, m)]);
  if (!r.error && r.status === 0) ok(m);
  else fail(`${m}: ${r.error ? r.error.message : said(r).split("\n")[0]}`);
}
fs.rmSync(scratch, { recursive: true, force: true });

// --- 2. herdr commands -----------------------------------------------------------------------
// Where the kit names a herdr command: run("x.y", …) in a mod (also run(cond ? "a.b" : "c.d", …)),
// a binding in keys.snippet.json, and `herdr-app do x.y` in the installer's instructions.
console.log("\nherdr commands");
const uses = []; // { name, args: [names] | null, where }
for (const m of mods) {
  const src = read(`mods/${m}/main.js`);
  for (const call of src.matchAll(/\brun\(([^,)]*)/g))
    for (const name of call[1].matchAll(/"([a-z]+\.[a-z]+)"/g)) uses.push({ name: name[1], args: null, where: `mods/${m}` });
}
for (const [section, binds] of Object.entries(JSON.parse(read("keys.snippet.json"))))
  for (const [key, action] of Object.entries(binds)) {
    const where = `keys.snippet.json ${section} ${key}`;
    if (typeof action === "string") uses.push({ name: action.split(":")[0], args: null, where });
    else uses.push({ name: action.command, args: Object.keys(action.args ?? {}), where });
  }
for (const m of read("bin/install.js").matchAll(/herdr-app do ([a-z]+\.[a-z]+)/g)) uses.push({ name: m[1], args: null, where: "bin/install.js" });

const listed = ask("herdr-app", ["commands"]);
let commands = null;
try { commands = new Map(JSON.parse(listed.stdout).map((c) => [c.name, c.args.map((a) => a.name)])); } catch {}
if (!commands) fail(`could not read \`herdr-app commands\`: ${listed.error ? listed.error.message : said(listed).slice(0, 200)}`);
else {
  const before = failures;
  for (const u of uses) {
    if (!commands.has(u.name)) fail(`${u.name} (${u.where}) is not a herdr command any more`);
    else for (const a of u.args ?? []) if (!commands.get(u.name).includes(a)) fail(`${u.name} has no argument "${a}" any more (${u.where})`);
  }
  if (failures === before) ok(`${new Set(uses.map((u) => u.name)).size} commands the kit runs all exist`);
}

// --- 3. hc commands and options ----------------------------------------------------------------
// What the kit passes to herdr-core, checked against its own --help. Keep in step with the files named.
const HC = [
  { program: "hc", help: ["--help"], commands: ["run", "get", "send", "templates", "machine"], by: "hw, herdr-link, mods" },
  { program: "hc", help: ["run", "--help"], options: ["--bg", "--json", "--name", "--cwd"], by: "hw" },
  { program: "hc", help: ["send", "--help"], options: ["--if"], by: "mods/skills" },
  { program: "hc", help: ["machine", "add", "--help"], options: ["--via", "--name"], by: "herdr-link" },
  { program: "herdr-core", help: ["--help"], commands: ["connect"], by: "herdr-link" },
];
console.log("\nhc commands and options");
for (const h of HC) {
  const what = `${h.program} ${h.help.join(" ")}`;
  const r = ask(h.program, h.help);
  if (r.error || r.status !== 0) { fail(`${what}: ${r.error ? r.error.message : said(r).slice(0, 200)}`); continue; }
  // A command or an option is defined at the start of a help line; a mention in prose does not count.
  const missing = [
    ...(h.commands ?? []).filter((c) => !new RegExp(`^\\s+${c}\\b`, "m").test(r.stdout)),
    ...(h.options ?? []).filter((o) => !new RegExp(`^\\s+(?:-\\w, )?${o}\\b`, "m").test(r.stdout)),
  ];
  if (missing.length) fail(`${what} no longer lists ${missing.join(", ")} (used by ${h.by})`);
  else ok(`${what}: ${[...(h.commands ?? []), ...(h.options ?? [])].join(" ")}`);
}

// --- record, then 4. the READMEs say the same versions ---------------------------------------
const versionLine = (program) => new RegExp(`(${program} --version\\s+#[^\\n]*?)\\d+\\.\\d+\\.\\d+`);
if (RECORD) {
  console.log("\nRecord");
  if (failures) console.log("  not recorded: fix the failures above first");
  else if (!drifted.length) console.log("  nothing to record: the installed versions are the tested ones");
  else {
    const pkgFile = path.join(REPO, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    for (const p of drifted) pkg.testedWith[p] = tested[p] = have[p];
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
    for (const doc of ["README.md", "README.ko.md"]) {
      let text = read(doc);
      for (const p of drifted) text = text.replace(versionLine(p), `$1${have[p]}`);
      fs.writeFileSync(path.join(REPO, doc), text);
    }
    console.log(`  recorded ${drifted.map((p) => `${p} ${have[p]}`).join(", ")} in package.json and both READMEs`);
    drifted.length = 0;
  }
}
console.log("\nREADMEs");
for (const doc of ["README.md", "README.ko.md"])
  for (const [program, want] of Object.entries(tested)) {
    const at = read(doc).match(new RegExp(`${program} --version\\s+#[^\\n]*`))?.[0];
    if (at?.includes(want)) ok(`${doc}: ${program} ${want}`);
    else fail(`${doc} should say ${program} ${want}${at ? `, it says: ${at}` : ""}`);
  }

// --- by hand ---------------------------------------------------------------------------------
console.log(`
By hand, in the supervisor layout (a machine cannot see these):
  [ ] hw explore t1 "say hi": the worker column opens and follows it, and closes when it ends
  [ ] status bar: the usage bars show numbers, and the refresh button reloads them
  [ ] Ctrl+Shift+U: the Providers window opens and shows who is signed in
  [ ] Ctrl+Shift+J: the Skills pane lists skills and sends one to an idle agent
  [ ] Projects list: a click opens that folder as a space; agents sit in their folders
  [ ] herdr-link status: says what is on
`);
if (failures) console.log(`${failures} check(s) failed.`);
else if (drifted.length) console.log(`All checks pass on ${drifted.map((p) => `${p} ${have[p]}`).join(" and ")}. After the hand checks:  node scripts/compat-check.js --record`);
else console.log("All checks pass on the tested versions.");
process.exitCode = failures ? 1 : 0;
