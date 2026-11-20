// Full history: a terminal's whole history as herdr-core keeps it, in a window you can scroll,
// search, select and copy. A terminal pane itself scrolls back at most 10,000 lines (a limit built
// into herdr-app) and fewer after the window reopens; herdr-core keeps more, and how much is set
// here: `history_mb` in herdr-core's config.toml, megabytes per terminal, read when a terminal
// starts. Opened for the focused terminal (Ctrl+Shift+Y), or for an agent from its right-click menu.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, EditorState, Editor } from "gpui-base";
import { theme, hc, home, readTextFile, writeTextFile, focused, terminals, props, closeOverlay, settings } from "herdr";

const WIN = /^[A-Za-z]:/.test(home());
// herdr-core's own settings file (hc --help: "Settings: ~/.config/herdr-core/config.toml").
const CONFIG = WIN ? `${home()}/AppData/Roaming/herdr-core/config.toml` : `${home()}/.config/herdr-core/config.toml`;
const CONFIG_SHOWN = WIN ? "%APPDATA%\\herdr-core\\config.toml" : "~/.config/herdr-core/config.toml";
const KEY = /^\s*history_mb\s*=\s*(\d+)\s*(#.*)?$/m;
const MAX_MB = 500;

// The top-level `history_mb` (keys after a [section] belong to that section, so only the part
// before the first section counts), and the text with it set to `mb`.
const topLevel = (text) => text.split(/^\s*\[/m)[0];
const readMb = (text) => Number(topLevel(text ?? "").match(KEY)?.[1]) || null;
function withMb(text, mb) {
  const top = topLevel(text ?? "");
  if (KEY.test(top)) return `${top.replace(KEY, `history_mb = ${mb}`)}${(text ?? "").slice(top.length)}`;
  return `history_mb = ${mb}\n${text ?? ""}`;
}

export default class Scrollback extends View {
  init(_props, cx) {
    this.terminal = props()?.terminal ?? focused()?.terminal ?? null;
    this.text = null;
    this.note = null;
    this.configText = null;
    this.mb = null;
    this.saved = null;
    const font = settings().font;
    this.editor = EditorState.new({ readonly: true, folding: false, value: "", ...(typeof font === "string" ? { font_family: font } : {}) });
    this.find = InputState.new({ placeholder: "Find (Enter: next)" });
    this.find.on("submit", (_e, cx) => this.next(cx));
    this.size = InputState.new({ placeholder: "default" });
    this.size.on("submit", (_e, cx) => this.saveMb(cx));
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      await Promise.all([this.load(), this.loadConfig()]);
      cx.notify();
      cx.timer.after(50, () => this.toEnd());
    });
  }

  async load() {
    if (!this.terminal) { this.note = "No terminal is focused. Click into one, then open this again."; return; }
    const r = await hc(["read", "--lines", "1000000", this.terminal]).catch((e) => ({ code: -1, stderr: String(e?.message ?? e) }));
    if (r.code !== 0) { this.note = `Could not read ${this.terminal}: ${(r.stderr || r.stdout || "").trim().split("\n")[0]}`; return; }
    // hc adds a closing line of its own when the oldest output was already dropped.
    const lines = r.stdout.replace(/\s+$/, "").split("\n");
    const clipped = /^\[hc\] incomplete/.test(lines.at(-1) ?? "");
    if (clipped) lines.pop();
    this.text = lines.join("\n");
    this.lines = lines.length;
    this.clipped = clipped;
    this.editor.set_value(this.text);
    this.note = null;
  }

  // Start at the newest output, as the pane does. The editor scrolls to its cursor once it has
  // been laid out with the text, so this runs a moment after the text is shown.
  toEnd() {
    if (!this.text) return;
    this.editor.set_selected_range({ start: this.text.length, end: this.text.length });
    this.editor.focus();
  }

  async loadConfig() {
    this.configText = await readTextFile(CONFIG).catch(() => null);
    this.mb = readMb(this.configText);
    this.size.set_value(this.mb ? String(this.mb) : "");
  }

  next(cx) {
    const q = this.find.value();
    if (!q || !this.text) return;
    const from = this.editor.selected_range().end;
    let at = this.text.toLowerCase().indexOf(q.toLowerCase(), from);
    if (at < 0) at = this.text.toLowerCase().indexOf(q.toLowerCase());
    this.found = at < 0 ? "no match" : null;
    if (at >= 0) {
      this.editor.set_selected_range({ start: at, end: at + q.length });
      this.editor.focus();
    }
    cx.notify();
  }

  saveMb(cx) {
    const raw = this.size.value().trim();
    const mb = Number(raw);
    if (!/^\d+$/.test(raw) || mb < 1 || mb > MAX_MB) { this.saved = `Enter whole megabytes, 1 to ${MAX_MB}.`; cx.notify(); return; }
    cx.spawn(async (cx) => {
      const old = await readTextFile(CONFIG).catch(() => null);
      try {
        await writeTextFile(CONFIG, withMb(old, mb), old);
        this.saved = `Saved: ${mb} MB per terminal, for terminals started from now on.`;
      } catch (e) {
        this.saved = `Could not write ${CONFIG_SHOWN}: ${e?.message ?? e}`;
      }
      await this.loadConfig();
      cx.notify();
    });
  }

  stop(el) {
    return el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
  }

  icon(t, id, file, tip, onClick) {
    return this.stop(div().id(id).p(4).rounded(5).text_color(t.muted).tooltip(tip)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick).child(svg(file).size(14)));
  }

  button(t, id, label, onClick) {
    return this.stop(div().id(id).px(10).py(3).rounded(6).border_1().border_color(t.border).bg(t.raised)
      .cursor_pointer().text_size(12).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click(onClick).child(label));
  }

  field(t, state, w) {
    return this.stop(div().w(w).child(Input.new(state).h(26).px(8).rounded(6).border_1()
      .border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground)));
  }

  render() {
    const t = theme();
    const close = () => closeOverlay(props()?.overlay);
    const term = terminals().find((x) => x.address === this.terminal);
    const title = [this.terminal, term?.name, term?.cwd?.split(/[\\/]/).filter(Boolean).pop()].filter(Boolean).join(" · ");
    const count = this.text === null ? "reading…" : `${String(this.lines).replace(/\B(?=(\d{3})+$)/g, ",")} lines${this.clipped ? ", older ones already dropped" : ""}`;
    return v_flex().id("root").size_full().bg(t.popover).rounded(10).border_1().border_color(t.border)
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(h_flex().w_full().gap(10).items_center().px(14).py(8).border_b(1).border_color(t.border)
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Full history"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(`${title}   ${count}`))
        .child(this.field(t, this.find, 200))
        .when(Boolean(this.found), (el) => el.child(div().text_size(12).text_color(t.dim).child(this.found)))
        .child(this.icon(t, "reload", "mods/status-plus/refresh.svg", "Read it again", (_e, cx) => cx.spawn(async (cx) => { await this.load(); cx.notify(); cx.timer.after(50, () => this.toEnd()); })))
        .child(this.icon(t, "close", "mods/workspace-chrome/x.svg", "Close (Esc)", close)))
      .child(this.note
        ? div().flex_1().p(16).text_size(13).text_color(t.muted).child(this.note)
        : this.stop(div().flex_1().min_h(0).child(Editor.new(this.editor).size_full())))
      .child(v_flex().w_full().gap(4).px(14).py(8).border_t(1).border_color(t.border)
        .child(h_flex().w_full().gap(8).items_center()
          .child(div().text_size(12).text_color(t.muted).child("Keep per terminal"))
          .child(this.field(t, this.size, 70))
          .child(div().text_size(12).text_color(t.muted).child("MB"))
          .child(this.button(t, "save", "Save", (_e, cx) => this.saveMb(cx)))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim)
            .child(this.saved ?? `${this.mb ? `${this.mb} MB` : "Default, about 5 MB"}: roughly 600 to 1,000 lines per MB. Applies to terminals started after saving.`)))
        .child(div().text_size(11.5).text_color(t.dim)
          .child(`Kept by herdr-core, in ${CONFIG_SHOWN} (history_mb). The pane itself scrolls back at most 10,000 lines, a limit built into herdr-app.`)));
  }
}
