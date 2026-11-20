// Projects: every folder under a root (props.root), newest first. Click selects the space already
// working there, else opens a new space in that folder with a plain shell. Nothing runs until clicked.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, panes, run, theme, props, checking, shared, setShared, home } from "herdr";

// The root comes from the layout block's props ({"mod": "projects", "props": {"root": "..."}}),
// else ~/Projects. A Windows home starts with a drive letter ("C:\Users\x").
const WIN = /^[A-Za-z]:/.test(home());
const SEP = WIN ? "\\" : "/";
const HIDDEN = "projects.hidden";
// A missing root exits with this code, so the list can say how to set it instead of a shell error.
const MISSING = 3;
const SET_ROOT = "npx github:ggleebwg-stack/herdr-nagne-custom --projects-root <folder>";
const norm = (p) => (p ?? "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();

// Folder -> space id for local spaces. A space's `folder` is where it was made; its panes' live
// folders say where it works now (a space started in ~ and cd'ed into a project counts there).
function spaceByFolder() {
  const byTab = new Map();
  for (const s of spaces()) if (!s.machine) for (const tb of s.tabs ?? []) byTab.set(tb.id, s.id);
  const map = new Map();
  for (const s of spaces()) if (!s.machine && s.folder) map.set(norm(s.folder), s.id);
  for (const p of panes()) if (p.cwd && byTab.has(p.tab)) map.set(norm(p.cwd), byTab.get(p.tab));
  return map;
}

export default class Projects extends View {
  init(_props, cx) {
    this.folders = [];
    this.error = null;
    this.missing = false;
    if (checking()) return;
    // Folder list changes rarely; a minute is plenty.
    cx.timer.every(60000, (cx) => this.load(cx));
    this.load(cx);
  }

  root() {
    const root = props()?.root ?? "~/Projects";
    return root.replace(/^~(?=$|[\\/])/, home()).replace(/[\\/]/g, SEP);
  }

  load(cx) {
    cx.spawn(async (cx) => {
      try {
        // A single-quoted PowerShell string escapes ' as ''.
        const root = this.root().replace(/'/g, "''");
        const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; if (-not (Test-Path -LiteralPath '${root}' -PathType Container)) { exit ${MISSING} }; Get-ChildItem -Directory -LiteralPath '${root}' | Sort-Object LastWriteTime -Descending | ForEach-Object Name`;
        // Newest first, folders only: PowerShell on Windows, `ls -t` elsewhere (trailing / marks folders).
        const r = WIN
          ? await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script])
          : await exec("sh", ["-c", `[ -d "$1" ] || exit ${MISSING}; ls -1tp -- "$1" | sed -n 's#/$##p'`, "sh", this.root()]);
        // Dot folders (.worktrees: herdr's checkouts, see settings.json) are not projects.
        this.folders = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("."));
        this.missing = r.code === MISSING;
        this.error = r.code === 0 || this.missing ? null : r.stderr.trim().split(/\r?\n/)[0];
      } catch (e) {
        this.error = String(e);
      }
      cx.notify();
    });
  }

  open(name) {
    const path = `${this.root()}${SEP}${name}`;
    const id = spaceByFolder().get(norm(path));
    if (id) run("space.select", { id });
    else run("space.new", { name, folder: path });
  }

  // Hidden folder names, kept in shared state so they survive restarts. Hiding never touches the folder.
  hidden() {
    return new Set(shared(HIDDEN) ?? []);
  }

  toggleHidden(name) {
    const set = this.hidden();
    set.has(name) ? set.delete(name) : set.add(name);
    setShared(HIDDEN, [...set].sort());
  }

  render() {
    const t = theme();
    const openFolders = spaceByFolder();
    const hidden = this.hidden();
    const hiddenCount = this.folders.filter((n) => hidden.has(n)).length;
    const rows = this.folders.filter((n) => this.showHidden || !hidden.has(n));
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .child("Projects")
        .when(hiddenCount > 0, (el) => el.child(div().id("projects-show-hidden").px(6).py(1).rounded(4).text_size(11)
          .text_color(this.showHidden ? t.accent : t.dim).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.showHidden = !this.showHidden; cx.notify(); })
          .child(this.showHidden ? "숨김 닫기" : `숨김 ${hiddenCount}`))))
      .child(v_flex().id("projects-list").flex_1().min_h(0).px(8).pb(10).overflow_y_scrollbar()
        .when(this.missing, (el) => el.child(v_flex().px(8).gap(4).text_size(11.5)
          .child(div().text_color(t.blocked).child(`Folder not found: ${this.root()}`))
          .child(div().text_color(t.dim).child("Pick your projects folder from a terminal:"))
          .child(div().text_color(t.muted).child(SET_ROOT))))
        .when(!!this.error, (el) => el.child(div().px(8).text_color(t.blocked).text_size(11.5).child(this.error)))
        .children(rows.map((name) => {
          const on = openFolders.has(norm(`${this.root()}${SEP}${name}`));
          const isHidden = hidden.has(name);
          return h_flex().id(`p-${name}`).flex_none().h(28).pl(8).pr(4).gap(8).items_center().rounded(6)
            .hover((s) => s.bg(t.hover))
            .on_hover((h, cx) => { this.hovered = h ? name : this.hovered === name ? null : this.hovered; cx.notify(); })
            .on_click(() => (isHidden ? this.toggleHidden(name) : this.open(name)))
            .child(svg("mods/projects/folder.svg").size(13).flex_none().text_color(on ? t.accent : t.dim))
            .child(div().flex_1().truncate().text_color(isHidden ? t.dim : on ? t.foreground : t.muted).child(name))
            .when(isHidden || this.hovered === name, (el) => el.child(
              div().id(`h-${name}`).flex_none().p(3).rounded(4).text_color(t.dim)
                .hover((s) => s.bg(t.raised).text_color(t.foreground))
                .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
                .on_click((_e, cx) => { cx.stop_propagation(); this.toggleHidden(name); })
                .child(svg(`mods/projects/${isHidden ? "plus" : "x"}.svg`).size(11))));
        })));
  }
}
