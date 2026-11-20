// Stage the README screenshot scene in a separate demo herdr window, so no real space, session,
// path or account shows. Run from Git Bash or PowerShell with node:
//
//   1. demo window (its own app home and its own herdr-core):
//        HERDR_APP_HOME=C:\tmp\herdr-demo-home HC_SESSION=demo herdr-app
//      once, install the kit there:  HERDR_APP_HOME=C:\tmp\herdr-demo-home node bin/install.js --projects-root C:\tmp\herdr-demo
//   2. with the same two variables set:  node scripts/demo/stage.js C:\tmp\herdr-demo
//      (the folder holds the demo projects: acme-shop, blog-engine, design-system, infra-scripts)
//   3. herdr-app shot shot.png, then crop the feature (docs/ images are cropped from such shots)
//   4. close: herdr-app do window.close, then HC_SESSION=demo hc server stop
//
// The agents are demo-agent: a bash script that reports a state the way Claude Code, Codex or Hermes
// do (OSC 7501) and prints a few lines. The workers are demo-worker under the first agent.
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

if (!process.env.HERDR_APP_HOME || !process.env.HC_SESSION) {
  console.error("Set HERDR_APP_HOME and HC_SESSION first: this must never run against your own window.");
  process.exit(2);
}
const DEMO = path.resolve(process.argv[2] || "C:\\tmp\\herdr-demo");
const BASH = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const AGENT = path.join(__dirname, "demo-agent");
const WORKER = path.join(__dirname, "demo-worker");
const run = (prog, args) => execFileSync(prog, args, { encoding: "utf8" });
const app = (...a) => run("herdr-app", a);
const json = (s) => JSON.parse(s);

function agent(space, ...args) {
  const r = json(app("do", "space.new", JSON.stringify({ name: space, folder: path.join(DEMO, space), argv: [BASH, AGENT, ...args], focus: false })));
  return r.terminal;
}

const lead = agent("acme-shop", "claude", "working", "-",
  "> Add coupon codes to checkout", "", "● Reading src/checkout/cart.ts", "● Two workers mapping the API and the tests…");
agent("blog-engine", "codex", "done", "-",
  "> Fix the RSS date format", "", "• Updated feed/rss.go to RFC 1123 dates", "• go test ./feed/... passed");
agent("design-system", "hermes", "blocked", "question",
  "> Rename the color tokens", "", "Which naming do you want: brand-500 or primary-500?");
agent("infra-scripts", "claude", "idle", "-",
  "> Check the backup cron", "", "● The nightly backup runs at 02:00 and kept 7 copies.");

const hc = (...a) => run("hc", a);
const cwd = path.join(DEMO, "acme-shop");
hc("run", "--bg", "--json", "--parent", lead, "--name", "api-map", "--cwd", cwd, "--", BASH, WORKER,
  '$ claude -p "Map the checkout API" (plan mode)', "",
  "POST /api/cart/items      cart.ts:42", "DELETE /api/cart/items/:id cart.ts:77",
  "POST /api/checkout         checkout.ts:18", "GET /api/coupons/:code    (none yet)", "",
  "Coupons: add a route next to checkout.ts:18.");
hc("run", "--bg", "--json", "--parent", lead, "--name", "test-map", "--cwd", cwd, "--", BASH, WORKER,
  '$ codex exec --sandbox read-only "Which tests cover checkout?"', "",
  "tests/checkout.spec.ts   12 cases", "tests/cart.spec.ts        8 cases", "", "No test covers discounts yet.");

// A plain shell with an open Claude session in this core's log: the status bar offers Resume.
const infra = json(app("ls")).spaces.find((s) => s.name === "infra-scripts").id;
const shell = json(app("do", "tab.new", JSON.stringify({ space: infra, name: "shell", folder: path.join(DEMO, "infra-scripts"), focus: false }))).terminal;
const core = json(hc("server", "status", "--json")).core.id;
const dir = path.join(os.homedir(), ".config", "herdr-nagne", "sessions", core);
fs.mkdirSync(dir, { recursive: true });
fs.appendFileSync(path.join(dir, `${shell}.jsonl`), JSON.stringify({
  e: "start", app: "claude", id: "3f2a9c1e-7b44-4d0e-9a51-6c8e2b17d903", cwd: path.join(DEMO, "infra-scripts"), at: Date.now() - 3 * 3600e3,
}) + "\n");

app("do", "space.select", JSON.stringify({ index: 1 }));
console.log(`Staged: agents in 4 spaces, workers api-map and test-map under ${lead}, a resumable shell ${shell}.`);
