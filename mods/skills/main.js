// Skills: Claude Code skills you can send to an agent with one click.
// Idea from SimonBystromTableCheck/herdr-mods (skills); written anew for Windows (no sh/nvim),
// with installed plugin skills, and without network or self-update.
// Sources: ~/.claude/skills/*/SKILL.md (/name), installed plugins' skills (/plugin:name),
// and the focused repo's .claude/skills (/name). Run pastes "/name args" into an idle agent
// of this tab (hc send --if idle), so a working agent is never interrupted.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, panes, focused, spaces, exec, hc, home, readTextFile, theme, window } from "herdr";

const SOURCE = { repo: "repo", personal: "personal", plugin: "plugin" };

// Enough YAML for skill frontmatter: `key: value`, quoted values, folded blocks.
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/), fm = {};
  if (!m) return fm;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[>|][-+]?$/.test(v)) { const parts = []; while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim()); v = parts.join(" "); }
    fm[kv[1]] = v.replace(/^(["'])(.*)\1$/, "$2");
  }
  return fm;
}

const firstSentence = (d) => {
  const s = (d ?? "").match(/^.*?[.!?](?=\s|$)/)?.[0] ?? d ?? "";
  return s.length > 140 ? s.slice(0, 137).trimEnd() + "…" : s;
};

// SKILL.md files one level under each root: one program call for all roots.
async function skillFiles(roots) {
  if (!roots.length) return [];
  if (window()?.platform === "windows") {
    const list = roots.map((r) => `'${r.replace(/'/g, "''")}'`).join(",");
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; foreach ($r in @(${list})) { if (Test-Path -LiteralPath $r) { Get-ChildItem -LiteralPath $r -Directory | ForEach-Object { $f = Join-Path $_.FullName 'SKILL.md'; if (Test-Path -LiteralPath $f) { $f } } } }`;
    const r = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  const r = await exec("sh", ["-c", 'for root in "$@"; do for d in "$root"/*/; do [ -f "$d/SKILL.md" ] && printf "%s\\n" "${d%/}/SKILL.md"; done; done; true', "skills", ...roots]);
  return r.stdout.split("\n").filter(Boolean);
}

const norm = (p) => (p ?? "").replace(/\\/g, "/").toLowerCase();
const dirOf = (p) => p.replace(/[\\/]SKILL\.md$/i, "");
const baseName = (p) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();

export default class Skills extends View {
  init(_props, cx) {
    this.skills = [];
    this.filter = "";
    this.flashMsg = null;
    this.target = null; // chosen agent address; else the first idle agent of this tab
    this.search = InputState.new({ placeholder: "Filter skills" });
    this.search.on("change", (_e, cx) => { this.filter = this.search.value(); cx.notify(); });
    this.args = InputState.new({ placeholder: "Arguments (optional)" });
    this.refresh(cx);
    // The repo follows the focused folder; checking it is cheap, listing only runs on change.
    cx.timer.every(3000, (cx) => { if (this.cwdNow() !== this.cwd) this.refresh(cx); });
  }

  cwdNow() {
    const f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    return pane?.cwd || f?.cwd || spaces().find((s) => s.active)?.folder || null;
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    const cwd = this.cwdNow();
    cx.spawn(async (cx) => {
      try {
        const top = cwd ? await exec("git", ["rev-parse", "--show-toplevel"], { cwd }).catch(() => null) : null;
        const repo = top?.code === 0 ? top.stdout.trim() : null;
        const roots = [{ dir: `${home()}/.claude/skills`, source: SOURCE.personal }];
        if (repo) roots.unshift({ dir: `${repo}/.claude/skills`, source: SOURCE.repo });
        // Installed plugins only (not every marketplace entry): their skills are /plugin:name.
        const installed = JSON.parse((await readTextFile(`${home()}/.claude/plugins/installed_plugins.json`).catch(() => null)) ?? "{}");
        for (const [key, entries] of Object.entries(installed.plugins ?? {})) {
          const plugin = key.split("@")[0];
          for (const e of entries ?? []) if (e?.installPath) roots.push({ dir: `${e.installPath}/skills`, source: SOURCE.plugin, plugin });
        }
        const files = await skillFiles(roots.map((r) => r.dir));
        const out = [];
        for (const path of files) {
          const root = roots.find((r) => norm(dirOf(path)).startsWith(norm(r.dir) + "/"));
          if (!root) continue;
          const fm = frontmatter((await readTextFile(path).catch(() => null)) ?? "");
          const name = fm.name || baseName(dirOf(path));
          const command = root.source === SOURCE.plugin ? `/${root.plugin}:${name}` : `/${name}`;
          out.push({ name, command, source: root.source, plugin: root.plugin, description: fm.description ?? "", hint: fm["argument-hint"] ?? "", path });
        }
        // A one-skill plugin keeps SKILL.md at its root (awwwards, jury).
        for (const r of roots.filter((r) => r.source === SOURCE.plugin)) {
          const path = `${r.dir.replace(/\/skills$/, "")}/SKILL.md`;
          const text = await readTextFile(path).catch(() => null);
          if (text === null) continue;
          const fm = frontmatter(text);
          const name = fm.name || r.plugin;
          out.push({ name, command: `/${r.plugin}:${name}`, source: SOURCE.plugin, plugin: r.plugin, description: fm.description ?? "", hint: fm["argument-hint"] ?? "", path });
        }
        const order = { repo: 0, personal: 1, plugin: 2 };
        out.sort((a, b) => order[a.source] - order[b.source] || a.command.localeCompare(b.command));
        Object.assign(this, { cwd, repo, skills: out, error: null });
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  // Agents of the active tab first (where this pane lives), then the rest of the space.
  candidates() {
    const f = focused();
    const list = agents().filter((a) => a.space === f?.space);
    return [...list.filter((a) => a.tab === f?.tab), ...list.filter((a) => a.tab !== f?.tab)];
  }

  chosen(list) {
    return list.find((a) => a.address === this.target) ?? list.find((a) => a.status === "idle" || a.status === "done") ?? list[0] ?? null;
  }

  flash(text, cx) {
    this.flashMsg = text;
    const mine = text;
    cx.timer.after(5000, (cx) => { if (this.flashMsg === mine) { this.flashMsg = null; cx.notify(); } });
    cx.notify();
  }

  send(skill, cx) {
    const agent = this.chosen(this.candidates());
    if (!agent) return this.flash("No agent in this space to send to", cx);
    const args = this.args.value().trim();
    const text = args ? `${skill.command} ${args}` : skill.command;
    cx.spawn(async (cx) => {
      const r = await hc(["send", "--if", "idle", agent.address, text]).catch((e) => ({ code: 1, stderr: String(e) }));
      const who = agent.program?.name ?? agent.address;
      if (r.code === 0) this.flash(`Sent ${text} to ${who}`, cx);
      else if (r.code === 10) this.flash(`${who} is busy: not sent (wait until it is idle)`, cx);
      else this.flash(`Not sent: ${(r.stderr || r.stdout || "").trim().slice(0, 160)}`, cx);
    });
  }

  render() {
    const t = theme();
    const list = this.candidates();
    const target = this.chosen(list);
    const q = this.filter.trim().toLowerCase();
    const items = q ? this.skills.filter((s) => `${s.command} ${s.description}`.toLowerCase().includes(q)) : this.skills;
    const chipColor = { repo: t.ansi6, personal: t.ansi5, plugin: t.ansi4 };
    const count = (src) => this.skills.filter((s) => s.source === src).length;

    return v_flex().id("skills").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12.5)
      .child(h_flex().h(40).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(13).child("Skills"))
        .child(div().text_size(11).text_color(t.dim).child(`${count("personal")} personal · ${count("plugin")} plugin${this.repo ? ` · ${count("repo")} repo` : ""}`))
        .child(div().flex_1())
        .child(div().id("skills-refresh").px(6).py(1).rounded(4).text_size(11).text_color(t.dim)
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.refresh(cx))
          .child(this.loading ? "…" : "Refresh")))
      // Where Run sends: an idle agent of this tab unless you pick another.
      .child(h_flex().id("skills-targets").flex_none().px(12).py(6).gap(6).items_center().flex_wrap().border_b(1).border_color(t.border).text_size(11.5)
        .child(div().text_color(t.dim).child("Send to"))
        .when(!list.length, (el) => el.child(div().text_color(t.ansi3).child("no agent in this space")))
        .children(list.slice(0, 6).map((a) => {
          const on = a.address === target?.address;
          const busy = a.status === "working" || a.status === "blocked";
          return div().id(`target-${a.address}`).px(7).py(2).rounded(5).border_1()
            .border_color(on ? t.accent : t.border).bg(on ? t.selected : t.surface)
            .text_color(busy ? t.dim : t.foreground).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => { this.target = a.address; cx.notify(); })
            .child(`${a.program?.name ?? a.app ?? "agent"} · ${a.tab_name ?? a.address}${busy ? ` (${a.status})` : ""}`);
        })))
      .child(v_flex().flex_none().px(12).py(8).gap(6).border_b(1).border_color(t.border)
        .child(Input.new(this.search).h(28).px(8).rounded(6).border_1().border_color(t.input).bg(t.surface).text_size(12))
        .child(Input.new(this.args).h(28).px(8).rounded(6).border_1().border_color(t.input).bg(t.surface).text_size(12)))
      .when(Boolean(this.flashMsg), (el) => el.child(div().flex_none().px(12).py(5).text_size(11.5).text_color(t.accent).bg(t.surface).child(this.flashMsg)))
      .when(Boolean(this.error), (el) => el.child(div().flex_none().px(12).py(5).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(v_flex().id("skills-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(4)
        .when(!items.length, (el) => el.child(div().p(8).text_color(t.dim).child(this.loading ? "Loading…" : q ? "No matching skills" : "No skills found")))
        .children(items.map((s) => h_flex().id(`skill-${s.command}`).flex_none().px(8).py(6).gap(8).items_center().rounded(7)
          .hover((st) => st.bg(t.hover))
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(h_flex().gap(6).items_center().min_w(0)
              .child(div().flex_none().px(4).rounded(3).border_1().border_color(chipColor[s.source]).text_size(10).text_color(chipColor[s.source]).child(s.source))
              .child(div().min_w(0).truncate().font_semibold().child(s.command)))
            .child(div().text_size(11.5).text_color(t.muted).truncate().child(firstSentence(s.description) || "No description"))
            .when(Boolean(s.hint), (el) => el.child(div().text_size(10.5).text_color(t.dim).truncate().child(`args: ${s.hint}`))))
          .child(div().id(`run-${s.command}`).flex_none().px(10).py(3).rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(11.5)
            .hover((st) => st.opacity(0.85)).on_click((_e, cx) => this.send(s, cx)).child("Run")))));
  }
}
