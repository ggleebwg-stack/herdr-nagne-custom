// Which herdr versions the kit was tested with (package.json "testedWith") and which are installed
// here. The installer uses it for a one-line note; scripts/compat-check.js for the full check.
"use strict";
const { spawnSync } = require("child_process");
const tested = require("../package.json").testedWith;

// Run one of herdr's own programs and capture what it prints. `error` is set when it is not on PATH.
const ask = (program, args) =>
  spawnSync(program, args, { encoding: "utf8", shell: process.platform === "win32", maxBuffer: 16 * 1024 * 1024 });

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
