// Resume agents: the Claude sessions that status-plus found in panes that came back as a plain shell
// after herdr-core restarted (reboot, logout, crash). Resume types `claude --resume <id>` into that
// pane, after checking again that the pane still shows a shell, and changes to the session's folder
// first when the pane is elsewhere. Dismiss forgets a session. Nothing runs without a click.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, run, hc, home, readTextFile, writeTextFile, shared, setShared, props, closeOverlay } from "herdr";

const WIN = /^[A-Za-z]:/.test(home());
const SHELL = /^(powershell|pwsh|cmd|bash|zsh|fish|sh|dash|ksh|nu)(\.exe)?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPS = { claude: { name: "Claude", command: (id) => `claude --resume ${id}` } };

const norm = (p) => {
  const s = (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  return WIN ? s.toLowerCase() : s;
};
const base = (p) => (p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";

function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// The line typed into the pane, in that shell's syntax.
function lineFor(shell, paneCwd, c) {
  const start = APPS[c.app].command(c.id);
  if (!c.cwd || norm(paneCwd) === norm(c.cwd)) return start;
  const s = shell.toLowerCase().replace(/\.exe$/, "");
  if (s === "powershell" || s === "pwsh") return `Set-Location -LiteralPath '${c.cwd.replace(/'/g, "''")}'; ${start}`;
  if (s === "cmd") return `cd /d "${c.cwd}" && ${start}`;
  return `cd '${c.cwd.replace(/'/g, "'\\''")}' && ${start}`;
}

export default class Resume extends View {
  init(_props, cx) {
    this.notes = {}; // terminal -> what happened
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  forget(terminal) {
    setShared("resume.candidates", (shared("resume.candidates") ?? []).filter((x) => x.terminal !== terminal));
  }

  resume(cx, c) {
    this.notes[c.terminal] = "checking…";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await hc(["get", c.terminal, "--json"]).catch(() => null);
      let fg = null;
      try { fg = JSON.parse(r?.stdout ?? "").foreground; } catch {}
      let note;
      if (!APPS[c.app] || !UUID.test(c.id)) note = "unknown session";
      else if (!r || r.code !== 0) note = "that pane is gone";
      else if (!SHELL.test(fg?.name ?? "")) note = `busy (${fg?.name ?? "no program"}), not at a shell prompt`;
      else {
        const sent = await hc(["send", c.terminal, lineFor(fg.name, fg.cwd, c)]).catch(() => null);
        if (sent?.code === 0) {
          setShared("resume.sent", { ...(shared("resume.sent") ?? {}), [c.terminal]: Date.now() });
          this.forget(c.terminal);
          note = "resumed";
        } else note = "could not type into the pane";
      }
      this.notes[c.terminal] = note;
      cx.notify();
    });
  }

  dismiss(cx, c) {
    cx.spawn(async (cx) => {
      const path = c.log; // status-plus's scan: sessions/<core id>/<terminal>.jsonl
      if (!path) return;
      const old = (await readTextFile(path).catch(() => null)) ?? "";
      const sep = old && !old.endsWith("\n") ? "\n" : "";
      await writeTextFile(path, `${old}${sep}${JSON.stringify({ e: "dismiss", id: c.id, at: Date.now() })}\n`, old || null).catch(() => null);
      this.forget(c.terminal);
      cx.notify();
    });
  }

  button(t, id, label, onClick, primary) {
    return div().id(id).px(10).py(4).rounded(6).border_1().border_color(t.border).cursor_pointer().text_size(12.5)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.bg(primary ? t.solid : t.hover)).on_click(onClick).child(label);
  }

  row(t, c) {
    return h_flex().w_full().gap(12).py(10).items_center().border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(14).text_color(t.foreground).child(APPS[c.app]?.name ?? c.app))
          .child(div().text_size(13).text_color(t.muted).truncate().child(base(c.cwd))))
        .child(div().text_size(12).text_color(t.dim).truncate()
          .child([c.where, c.terminal, `started ${ago(c.at)}`].filter(Boolean).join(" · "))))
      .child(h_flex().gap(6).items_center()
        .child(this.button(t, `show-${c.terminal}`, "Show", () => run("pane.focus", { terminal: c.terminal })))
        .child(this.button(t, `dismiss-${c.terminal}`, "Dismiss", (_e, cx) => this.dismiss(cx, c)))
        .child(this.button(t, `resume-${c.terminal}`, "Resume", (_e, cx) => this.resume(cx, c), true)));
  }

  render() {
    const t = theme();
    const list = shared("resume.candidates") ?? [];
    const notes = Object.entries(this.notes).filter(([, n]) => n !== "checking…");
    const close = () => closeOverlay(props()?.overlay);
    return v_flex().w_full().px(20).pt(14).pb(16).bg(t.popover)
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Resume agents"))
      .child(div().pt(4).pb(6).text_size(12).line_height("17px").text_color(t.dim)
        .child("These Claude sessions were running when herdr-core stopped (a reboot, logout or crash). Their panes came back as a shell in the same place. Resume types claude --resume <session> there."))
      .children(list.map((c) => this.row(t, c)))
      .when(list.length === 0, (el) => el.child(div().py(14).text_size(13).text_color(t.muted).child("Nothing to resume.")))
      .when(notes.length > 0, (el) => el.child(v_flex().pt(10).gap(2).text_size(12).text_color(t.muted)
        .children(notes.map(([term, n]) => div().child(`${term}: ${n}`)))))
      .child(h_flex().w_full().pt(14).gap(8).items_center()
        .child(div().flex_1())
        .child(this.button(t, "close", "Close", close))
        .when(list.length > 1, (el) => el.child(this.button(t, "resume-all", `Resume all ${list.length}`, (_e, cx) => list.forEach((c) => this.resume(cx, c)), true))));
  }
}
