// Which herdr versions the kit was tested with (package.json "testedWith") and which are installed
// here. The installer uses it for a one-line note; scripts/compat-check.js for the full check.
"use strict";
const { spawnSync } = require("child_process");
const tested = require("../package.json").testedWith;

// Run a program found on PATH (herdr's own, hermes) and capture what it prints. `error` is set when
// it is not on PATH. Windows needs a shell to find .cmd shims, and Node wants the command as one
// string then, so arguments are quoted here.
function ask(program, args, opts = {}) {
  const o = { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...opts };
  if (process.platform !== "win32") return spawnSync(program, args, o);
  const q = (a) => (/[s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
  return spawnSync([program, ...args].map(q).join(" "), { ...o, shell: true });
}

// "herdr-app 0.1.16" -> "0.1.16"; null when the program is missing or prints no version.
function installed(program) {
  const r = ask(program, ["--version"]);
  if (r.error || r.status !== 0) return null;
  return r.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
}

// The programs whose installed version is not the tested one. A missing program is not listed.
const drift = () =>
  Object.entries(tested)
    .map(([program, want]) => ({ program, want, have: installed(program) }))
    .filter((v) => v.have && v.have !== v.want);

module.exports = { tested, ask, installed, drift };
