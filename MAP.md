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
│   ├── status-plus/           status bar: usage bars, refresh, History/Skills buttons
│   │   ├── main.js
│   │   ├── mod.json           cloned_from: workspace-status (herdr-app 0.1.16)
│   │   └── refresh.svg
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
│   ├── explore.md             claude --model haiku --permission-mode plan      ~/.config/herdr-core/templates/ (macOS/Linux)
│   ├── spec-check.md          codex --no-daemon -s read-only
│   └── astra-review.md        codex --no-daemon -m <model> -s read-only
├── hw                         worker launcher (bash)  -> ~/.local/bin/hw
├── keys.snippet.json          key bindings to merge into ~/.config/herdr-app/keys.json by hand
├── scripts/
│   ├── install.sh             repo -> this machine (moves replaced files to ~/.herdr-config-backup/<time>/)
│   ├── export.sh              this machine -> repo (writes the projects root back as ~/Projects)
│   └── paths.sh               shared paths and the list of mods, sourced by both scripts
├── docs/                      README screenshots (taken from a demo project)
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
    └── status                    status-plus        ← this kit (replaces workspace-status)
```

## Run-time connections

```
 terminal in herdr ── hw <template> <name> "<task>" ──► templates/<template>.md
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
| workers | `terminals()`, `layout()` | `layout.set`, `layout.show` / `layout.hide` (the watch column), `terminal.peek`, `terminal.kill` | none |
| status-plus | `~/.claude/.credentials.json` (macOS: keychain), `~/.codex/auth.json` | HTTPS GET to `api.anthropic.com/api/oauth/usage`, `chatgpt.com/backend-api/wham/usage` | `status-plus.usage.<provider>` (last good answer), `status-plus.blocked.<provider>` (429 wait) |
| projects | folder names under `props.root` (PowerShell / `ls`), `spaces()`, `panes()` | `space.select`, `space.new` | `projects.hidden` |
| skills | `~/.claude/skills`, `<repo>/.claude/skills`, `~/.claude/plugins/installed_plugins.json` | `hc send --if idle <agent> "/skill args"` | none |
| agent-folders | `agents()`, `terminals()`, `spaces()`, `panes()`, `layout()` | `hc label <terminal> agentfolders.folder=…`, `pane.focus`, `terminal.peek`, `terminal.pin`, `layout.resize` | `agentFolders`, `sidebar.width`, `sidebar.collapsed` |

Shared state lives in herdr's `~/.config/herdr-app/shared.json`. The scripts never copy or back it up, so hidden projects and agent folders stay on each machine.

## Install and export flow

```
            scripts/install.sh                         scripts/export.sh
 repo ───────────────────────────► machine   machine ─────────────────────────► repo
 mods/*            → ~/.config/herdr-app/mods/          (same paths, reversed)
 layouts/*.json    → ~/.config/herdr-app/layouts/       projects root → "~/Projects"
 templates/*.md    → herdr-core templates folder        keys.json / settings.json never exported
 hw                → ~/.local/bin/hw
 keys.snippet.json → (merge by hand)
```
