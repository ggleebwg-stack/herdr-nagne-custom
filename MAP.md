# Project map

Where everything is in this repository, where the installer puts it, and how the pieces talk to each other at run time. [한국어](MAP.ko.md)

## Files

```
herdr-nagne-custom/
├── mods/                      herdr panels (JavaScript, gpui-kit)  -> ~/.config/herdr-app/mods/
│   ├── workers/               worker chips + pins the chosen worker into the right column
│   │   ├── main.js
│   │   ├── mod.json
│   │   └── terminal.svg, x.svg
│   ├── status-plus/           status bar: a usage chip per provider, refresh, History/Skills buttons
│   │   ├── main.js
│   │   ├── mod.json           cloned_from: workspace-status (herdr-app 0.1.16)
│   │   └── refresh.svg
│   ├── providers/             Providers window: on/off, sign in/out, OpenRouter key and model
│   │   ├── main.js
│   │   └── mod.json           opens as a window (Ctrl+Shift+U, or the gear in status-plus)
│   ├── resume/                "Resume agents" list after herdr-core restarted
│   │   ├── main.js
│   │   └── mod.json           opens as a dialog from status-plus's Resume chip or its notification
│   ├── scrollback/            Full history window: herdr-core's whole history of a terminal, and history_mb
│   │   ├── main.js
│   │   └── mod.json           opens as a window (Ctrl+Shift+Y, or Full history in an agent's right-click menu)
│   ├── projects/              sidebar list of project folders
│   │   ├── main.js
│   │   ├── mod.json
│   │   └── folder.svg, plus.svg, x.svg
│   ├── skills/                Claude Code skills browser, sends /skill to an idle agent
│   │   ├── main.js
│   │   └── mod.json
│   └── agent-folders/         Agents list in colored folders (from kiote/pi-setup)
│       ├── main.js
│       ├── mod.json
│       └── NOTICE, LICENSE-apache-2.0, LICENSE-mit-kiote
├── layouts/
│   └── supervisor.json        the window layout that wires the mods together  -> ~/.config/herdr-app/layouts/
├── templates/                 worker templates  -> %APPDATA%\herdr-core\templates\ (Windows)
│   ├── explore.md             provider claude: claude --model haiku --permission-mode plan --tools Read,Grep,Glob   ~/.config/herdr-core/templates/ (macOS/Linux)
│   ├── grok-explore.md        provider grok: grok --permission-mode plan --no-subagents --sandbox read-only (no shell)
│   ├── openrouter-explore.md  provider openrouter: opencode run --agent plan -m openrouter/${OPENROUTER_MODEL}
│   ├── spec-check.md          provider codex: codex --no-daemon -s read-only
│   └── astra-review.md        provider codex: codex --no-daemon -m <model> -s read-only
├── hw                         worker launcher (bash)  -> ~/.local/bin/hw (+ hw.cmd on Windows)
├── nagne-session-hook         Claude Code SessionStart/SessionEnd hook (bash)  -> ~/.local/bin/
├── herdr-link                 link computers over Tailscale without ssh: bridge + tailscale serve  -> ~/.local/bin/
├── claude-hooks.snippet.json  the two hook entries to add to ~/.claude/settings.json by hand
├── hermes/herdr-status/       Hermes Agent plugin: reports its status to herdr (OSC 7501) -> <hermes home>/plugins/, with --hermes-status
├── codex.rules                lets hw and hc ls/get/wait/read out of Codex's sandbox -> ~/.codex/rules/herdr-nagne.rules
├── providers.example.json     which providers are on, where keys come from  -> ~/.config/herdr-nagne/providers.json (once)
├── keys.snippet.json          key bindings to merge into ~/.config/herdr-app/keys.json by hand
├── bin/install.js             the installer run by npx: repo -> this machine (moves replaced files to ~/.herdr-config-backup/<time>/)
├── bin/compat.js              the herdr versions the kit was tested with, and the ones installed here
├── package.json               npx entry point, the files it ships, and "testedWith" (herdr-app, hc)
├── scripts/
│   ├── compat-check.js        after a herdr update: do the mods load, do the commands and hc options still exist
│   ├── export.sh              this machine -> repo (writes the projects root back as ~/Projects)
│   ├── paths.sh               shared paths and the list of mods, sourced by export.sh
│   └── demo/                  stage.js sets up the screenshot scene in a separate demo window and core;
│                              demo-agent / demo-worker stand in for agents and workers, demo-log for a long log
├── docs/                      README screenshots, cropped from that demo scene (never a real session)
├── README.md, README.ko.md    overview and install guide
├── MAP.md, MAP.ko.md          this file
└── LICENSE, NOTICE, LICENSE-Lucide.txt
```

## The layout

`layouts/supervisor.json` is herdr's `main` layout with these blocks changed or added:

```
root (row)
├── sidebar (column)
│   ├── brand                     workspace-chrome   (herdr)
│   ├── sidebar-lists
│   │   ├── spaces                spaces             (herdr)
│   │   ├── projects              projects           ← this kit, props.root = your projects folder
│   │   └── agents                agent-folders      ← this kit (replaces herdr's agents)
│   └── sidebar-footer            workspace-chrome   (herdr)
└── work (column)
    ├── tabs                      tabs               (herdr)
    ├── work-body (row)
    │   ├── main                  the active tab's panes
    │   ├── watch (column)        ← this kit; shown while a worker exists, Ctrl+Shift+A toggles
    │   │   ├── watch-bar         workers            ← this kit
    │   │   └── watch-agent       {terminal: <id>}   created and re-created by the workers mod
    │   └── panel                 files / changes    (herdr)
    └── status-row (row)
        ├── status                status-plus        ← this kit (replaces workspace-status)
        └── workers-toggle        workers {toggle}   ← this kit; always shown, so it opens/closes watch
```

## Run-time connections

```
 terminal in herdr ── hw <template> <name> "<task>" ──► templates/<template>.md
                                                          │ provider: off in providers.json? -> refused
                                                          │ ${VAR} in command: environment, else the provider's "env"
                                                          │ command + prompt (one line)
                                                          ▼
                                    hc run --bg --name <name> -- <command> "<prompt>"
                                                          │ worker terminal, parent = your terminal
                                                          ▼
   workers mod ◄── terminals() with a parent ──────── herdr-core (hc)
        │ click a chip
        ▼
   layout.set → watch-agent shows that worker live
   parent collects results: hc wait --children all ; hc read <name>
```

| Mod | Reads | Writes / runs | Shared state keys |
|---|---|---|---|
| workers | `terminals()`, `layout()` | `layout.set`, `layout.show` / `layout.hide` / `layout.toggle` (the watch column; only the status-row copy, since a hidden column's mod never starts), `terminal.peek`, `terminal.kill` | none |
| status-plus | watches `~/.config/herdr-nagne/` (refreshes on change); `sessions/<core id>/*.jsonl` (this herdr-core only) + `hc server status` / `hc ls` / `hc get` to find agents to resume; `providers.json`, `~/.claude/.credentials.json` (macOS: keychain), `~/.codex/auth.json`, the OpenRouter key (`keyEnv` / `keyFile`) | HTTPS GET to `api.anthropic.com/api/oauth/usage`, `chatgpt.com/backend-api/wham/usage`, `openrouter.ai/api/v1/key`; runs `grok usage --json` | `status-plus.usage.<provider>` (last good answer), `status-plus.blocked.<provider>` (429 wait) |
| providers | `~/.config/herdr-nagne/providers.json`, `openrouter.key`; runs `claude auth status`, `codex login status`, `opencode auth list`; reads whether `~/.grok/auth.json` holds a login | writes `providers.json` (one provider per line) and `openrouter.key`; `terminal.open` a tab with the CLI's login; runs the CLI's logout; `app.settings` (Machines) | clears `status-plus.usage.<provider>` when a login changes |
| resume | shared `resume.candidates` | `hc get` (re-check the pane), `hc send <terminal> "claude --resume <id>"`, `pane.focus`; appends a dismiss line to `sessions/<core id>/<terminal>.jsonl` | `resume.sent`, `resume.candidates` |
| scrollback | `hc read --lines 1000000 <terminal>`; herdr-core's `config.toml` (`%APPDATA%\herdr-core\` on Windows) | writes `history_mb` there on Save | none |
| projects | folder names under `props.root` (PowerShell / `ls`), `spaces()`, `panes()` | `space.select`, `space.new` | `projects.hidden` |
| skills | `~/.claude/skills`, `<repo>/.claude/skills`, `~/.claude/plugins/installed_plugins.json` | `hc send --if idle <agent> "/skill args"` | none |
| agent-folders | `agents()`, `terminals()`, `spaces()`, `panes()`, `layout()` | `hc label <terminal> agentfolders.folder=…`, `pane.focus`, `terminal.peek`, `terminal.pin`, `layout.resize` | `agentFolders`, `sidebar.width`, `sidebar.collapsed` |

Shared state lives in herdr's `~/.config/herdr-app/shared.json`. The scripts never copy or back it up, so hidden projects and agent folders stay on each machine.

## Resume after a reboot

```
 claude in a herdr pane (env HC_TERMINAL_ID=t7)
   SessionStart / SessionEnd ──► nagne-session-hook ──► ~/.config/herdr-nagne/sessions/<core id>/t7.jsonl  (append only)
                                                          {"e":"start","app":"claude","id":…,"cwd":…,"at":…}

 reboot: herdr-core gives pane t7 a fresh shell, same address
   status-plus  scanSessions(): open session (start without end/dismiss)
                + hc ls: t7 exists, no parent, no agent status
                + hc get t7: foreground is a shell          ──► shared resume.candidates ──► "Resume 1 agent" chip
   resume mod   click Resume: hc get again ──► hc send t7 "claude --resume <id>"  (cd first if the folder differs)
```

## Install and export flow

```
   npx github:ggleebwg-stack/herdr-nagne-custom        scripts/export.sh
 repo ───────────────────────────► machine   machine ─────────────────────────► repo
 mods/*            → ~/.config/herdr-app/mods/          (same paths, reversed)
 layouts/*.json    → ~/.config/herdr-app/layouts/       projects root → "~/Projects"
                     (keeps your projects root, or --projects-root)
 templates/*.md    → herdr-core templates folder        keys.json / settings.json never exported
 hw, nagne-session-hook, herdr-link → ~/.local/bin/   (Windows: + hw.cmd, herdr-link.cmd)
 providers.example.json → ~/.config/herdr-nagne/providers.json (only if missing)   providers.json never exported
 keys.snippet.json → keys.json, with --keys (else by hand)
 claude-hooks.snippet.json → ~/.claude/settings.json, with --claude-hooks
 codex.rules       → ~/.codex/rules/herdr-nagne.rules, with --codex-rules
 hermes/herdr-status → <hermes home>/plugins/herdr-status, enabled, with --hermes-status
```

## Other computers (Tailscale, no ssh)

```
 this computer                                        home / office computer (same Tailscale user)
                                                      herdr-link on:
 herdr-link add <name> <host>                           tailscale serve :47710 (tailnet only)
   hc machine add --via                                   → bridge on 127.0.0.1:47711 (login item)
     'node herdr-link dial <host>'  ──Tailscale──►        → tailscale whois: same user? else refuse
                                                          → herdr-core connect
 herdr window: spaces and terminals on <name>  ◄────  agents run there; addressed as <name>/t7
```
