// Provider settings inside herdr: switch each provider on or off (what the status bar shows and
// which worker templates hw starts), see whether its CLI is signed in, sign in or out, and set the
// OpenRouter usage key and worker model. Everything is written to ~/.config/herdr-nagne/providers.json
// (one provider per line) and, for the OpenRouter key, ~/.config/herdr-nagne/openrouter.key.
// Sign-in itself always runs in the vendor's own CLI, in a terminal tab: this mod never sees a
// password or token. It reads only whether a login exists (and Claude's plan name).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, run, exec, home, readTextFile, writeTextFile, watchFolder, props, closeOverlay, setShared } from "herdr";

const WIN = /^[A-Za-z]:/.test(home());
const DIR = `${home()}/.config/herdr-nagne`;
const CONFIG = `${DIR}/providers.json`;
const KEY_FILE = "~/.config/herdr-nagne/openrouter.key";
const MODEL_VAR = "OPENROUTER_MODEL";
const expand = (p) => p.replace(/^~(?=$|[\\/])/, home());
// After Log in, the login is re-checked every few seconds for this long.
const WATCH_MS = 5 * 60 * 1000;

const PROVIDERS = [
  { key: "claude", name: "Claude", about: "Claude Code plan: 5-hour and weekly limits.",
    login: ["claude", "auth", "login"], logout: ["claude", "auth", "logout"] },
  { key: "codex", name: "Codex", about: "ChatGPT plan used by the Codex CLI: 5-hour and weekly limits.",
    login: ["codex", "login"], logout: ["codex", "logout"] },
  { key: "grok", name: "Grok", about: "Grok CLI. Its plan usage shows only inside grok (/usage).",
    login: ["grok", "login"], logout: ["grok", "logout"] },
  { key: "openrouter", name: "OpenRouter", about: "Pay-as-you-go credits. Workers run through opencode, which keeps its own login.",
    login: ["opencode", "auth", "login", "openrouter"], logout: ["opencode", "auth", "logout", "openrouter"] },
];
const DEFAULTS = { claude: { enabled: true }, codex: { enabled: true }, grok: { enabled: false },
  openrouter: { enabled: false, keyEnv: "OPENROUTER_API_KEY" } };

// npm installs codex and opencode as .cmd shims on Windows, which a plain exec doesn't find.
async function cli(argv, timeout = 20000) {
  const [cmd, ...args] = argv;
  try { return await exec(cmd, args, { timeout }); } catch (e) {
    if (WIN) return exec(`${cmd}.cmd`, args, { timeout });
    throw e;
  }
}

// { state: "in" | "out" | "missing", text }
async function loginOf(key) {
  const missing = { state: "missing", text: "CLI not found" };
  if (key === "claude") {
    const r = await cli(["claude", "auth", "status", "--json"]).catch(() => null);
    if (!r) return missing;
    let j = null; try { j = JSON.parse(r.stdout); } catch {}
    if (!j?.loggedIn) return { state: "out", text: "Not signed in" };
    return { state: "in", text: `Signed in · ${j.subscriptionType ?? j.authMethod ?? "account"}` };
  }
  if (key === "codex") {
    const r = await cli(["codex", "login", "status"]).catch(() => null);
    if (!r) return missing;
    const out = `${r.stdout}\n${r.stderr}`;
    if (r.code !== 0 || !/logged in/i.test(out) || /not logged in/i.test(out)) return { state: "out", text: "Not signed in" };
    return { state: "in", text: `Signed in · ${out.match(/using\s+(.+)/i)?.[1]?.trim() ?? "account"}` };
  }
  if (key === "grok") {
    const raw = await readTextFile(`${home()}/.grok/auth.json`).catch(() => null);
    let j = null; try { j = JSON.parse(raw); } catch {}
    if (j && Object.values(j).some((v) => v && (v.refresh_token || v.key))) return { state: "in", text: "Signed in" };
    const r = await cli(["grok", "--version"]).catch(() => null);
    return r ? { state: "out", text: "Not signed in" } : missing;
  }
  if (key === "openrouter") {
    const r = await cli(["opencode", "auth", "list"]).catch(() => null);
    if (!r) return { state: "missing", text: "opencode not found" };
    return /openrouter/i.test(r.stdout) ? { state: "in", text: "opencode signed in" } : { state: "out", text: "opencode not signed in" };
  }
  return missing;
}

// One provider per line, keys aligned, as providers.example.json is written.
function inline(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const parts = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
    return parts.length ? `{ ${parts.join(", ")} }` : "{}";
  }
  return JSON.stringify(v);
}
function format(conf) {
  const keys = Object.keys(conf);
  const width = Math.max(...keys.map((k) => JSON.stringify(k).length + 1));
  return `{\n${keys.map((k) => `  ${`${JSON.stringify(k)}:`.padEnd(width + 1)}${inline(conf[k])}`).join(",\n")}\n}\n`;
}

export default class Providers extends View {
  init(_props, cx) {
    this.conf = null;
    this.raw = null;
    this.error = null;
    this.login = {};
    this.watching = {}; // provider -> until (ms) after Log in
    this.confirm = null; // provider waiting for a second click on Log out
    this.message = null;
    this.keyInput = InputState.new({ placeholder: "sk-or-…  (paste, then Enter)" });
    this.keyInput.set_masked(true);
    this.keyInput.on("submit", (_e, cx) => this.saveKey(cx));
    this.modelInput = InputState.new({ placeholder: "e.g. qwen/qwen3-coder" });
    this.modelInput.on("submit", (_e, cx) => this.saveModel(cx));
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      await this.load();
      this.modelInput.set_value(this.conf?.openrouter?.env?.[MODEL_VAR] ?? "");
      cx.notify();
      await this.checkAll(cx);
    });
    // An edit made elsewhere (by hand, or hw's folder) shows here too. A model being typed is kept.
    cx.spawn(async (cx) => {
      for (;;) {
        const changed = await watchFolder(DIR).catch(() => null);
        if (!changed?.length) return;
        const shownModel = this.conf?.openrouter?.env?.[MODEL_VAR] ?? "";
        await this.load();
        if (this.modelInput.value() === shownModel) this.modelInput.set_value(this.conf?.openrouter?.env?.[MODEL_VAR] ?? "");
        cx.notify();
      }
    });
    cx.timer.every(3000, (cx) => {
      const now = Date.now();
      for (const [key, until] of Object.entries(this.watching)) {
        if (now > until) delete this.watching[key];
        else this.check(cx, key);
      }
    });
  }

  async load() {
    this.raw = await readTextFile(CONFIG).catch(() => null);
    this.error = null;
    try { this.conf = this.raw ? JSON.parse(this.raw) : { ...DEFAULTS }; }
    catch (e) { this.conf = null; this.error = `providers.json is not valid JSON (${e?.message ?? e}). Fix it by hand; nothing is written until then.`; }
    this.keySet = Boolean((await readTextFile(expand(this.conf?.openrouter?.keyFile ?? KEY_FILE)).catch(() => null))?.trim());
  }

  // Writes providers.json; the status bar watches the folder and refreshes. Re-reads once if the
  // file changed underneath (an edit by hand), so that edit is kept.
  async save(cx, change) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.conf) return;
      const next = JSON.parse(JSON.stringify(this.conf));
      change(next);
      try {
        await writeTextFile(CONFIG, format(next), this.raw);
        this.conf = next;
        this.raw = format(next);
        cx.notify();
        return;
      } catch (e) {
        await this.load();
        if (attempt) { this.message = `Could not write providers.json: ${e?.message ?? e}`; cx.notify(); }
      }
    }
  }

  async checkAll(cx) {
    await Promise.all(PROVIDERS.map((p) => this.check(cx, p.key)));
  }

  // Re-reads one login. When it changes, the status bar's cached usage for it is dropped and
  // providers.json is rewritten, so the bar asks again with the new login.
  async check(cx, key) {
    const before = this.login[key]?.state;
    const now = await loginOf(key).catch(() => ({ state: "missing", text: "check failed" }));
    this.login[key] = now;
    if (before && before !== now.state) {
      delete this.watching[key];
      setShared(`status-plus.usage.${key}`, null);
      await this.save(cx, () => {});
    }
    cx.notify();
  }

  signIn(p, cx) {
    run("terminal.open", { argv: p.login, place: "tab", name: `${p.name} login` });
    this.watching[p.key] = Date.now() + WATCH_MS;
    this.message = `${p.name}: finish signing in in the "${p.name} login" tab. This window updates by itself.`;
    cx.notify();
  }

  signOut(p, cx) {
    if (this.confirm !== p.key) { this.confirm = p.key; cx.notify(); return; }
    this.confirm = null;
    this.login[p.key] = { ...this.login[p.key], busy: true };
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await cli(p.logout, 30000).catch((e) => ({ code: -1, stderr: String(e?.message ?? e) }));
      this.message = r.code === 0 ? `${p.name}: signed out.` : `${p.name}: sign-out failed. ${(r.stderr || r.stdout || "").trim().slice(0, 160)}`;
      await this.check(cx, p.key);
    });
  }

  toggle(cx, key) {
    cx.spawn(async (cx) => this.save(cx, (c) => {
      c[key] = { ...(DEFAULTS[key] ?? {}), ...(c[key] ?? {}) };
      c[key].enabled = !c[key].enabled;
    }));
  }

  saveKey(cx) {
    const key = this.keyInput.value().trim();
    if (!key) return;
    cx.spawn(async (cx) => {
      const file = expand(this.conf?.openrouter?.keyFile ?? KEY_FILE);
      const old = await readTextFile(file).catch(() => null);
      try {
        await writeTextFile(file, `${key}\n`, old);
      } catch (e) {
        this.message = `Could not save the key: ${e?.message ?? e}`;
        cx.notify();
        return;
      }
      this.keyInput.set_value("");
      this.keySet = true;
      this.message = "OpenRouter usage key saved.";
      setShared("status-plus.usage.openrouter", null);
      await this.save(cx, (c) => { c.openrouter = { ...DEFAULTS.openrouter, ...(c.openrouter ?? {}), keyFile: KEY_FILE }; });
    });
  }

  clearKey(cx) {
    cx.spawn(async (cx) => {
      const file = expand(this.conf?.openrouter?.keyFile ?? KEY_FILE);
      const old = await readTextFile(file).catch(() => null);
      if (old !== null) await writeTextFile(file, "", old).catch(() => null);
      this.keySet = false;
      this.message = `OpenRouter usage key cleared (the ${this.conf?.openrouter?.keyEnv ?? "keyEnv"} variable is still used if set).`;
      setShared("status-plus.usage.openrouter", null);
      await this.save(cx, () => {});
    });
  }

  saveModel(cx) {
    const model = this.modelInput.value().trim();
    cx.spawn(async (cx) => this.save(cx, (c) => {
      c.openrouter = { ...DEFAULTS.openrouter, ...(c.openrouter ?? {}) };
      const env = { ...(c.openrouter.env ?? {}) };
      if (model) env[MODEL_VAR] = model; else delete env[MODEL_VAR];
      if (Object.keys(env).length) c.openrouter.env = env; else delete c.openrouter.env;
      this.message = model ? `Workers from openrouter-explore use ${model}.` : "Model cleared.";
    }));
  }

  // Controls stop the press so the window isn't dragged by them.
  stop(el) {
    return el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
  }

  button(t, id, label, onClick, tone) {
    const fg = tone === "danger" ? t.blocked : tone === "primary" ? t.solid_foreground : t.foreground;
    const bg = tone === "primary" ? t.solid : t.raised;
    return this.stop(div().id(id).px(10).py(4).rounded(6).border_1().border_color(t.border).bg(bg)
      .cursor_pointer().text_size(12.5).text_color(fg).hover((s) => s.bg(tone === "primary" ? t.solid : t.hover))
      .on_click(onClick).child(label));
  }

  switcher(t, id, on, onClick) {
    return this.stop(div().id(id).w(36).h(20).rounded(10).p(2).cursor_pointer().bg(on ? t.accent : t.hover)
      .flex().when(on, (el) => el.justify_end()).on_click(onClick)
      .child(div().w(16).h(16).rounded(8).bg(on ? t.accent_foreground : t.muted)));
  }

  field(t, state) {
    return this.stop(div().flex_1().min_w(0).child(Input.new(state).h(28).px(8).rounded(6).border_1()
      .border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground)));
  }

  provider(t, p) {
    const cfg = this.conf?.[p.key] ?? DEFAULTS[p.key];
    const on = Boolean(cfg?.enabled);
    const l = this.login[p.key];
    const dot = !l ? t.dim : l.state === "in" ? t.ansi2 : l.state === "out" ? t.blocked : t.dim;
    const status = !l || l.busy ? "checking…" : this.watching[p.key] ? `${l.text} · waiting for sign-in…` : l.text;
    const asking = this.confirm === p.key;
    const actions = h_flex().gap(6).items_center()
      .when(l?.state === "in" && !l.busy, (el) => el.child(this.button(t, `out-${p.key}`, asking ? "Confirm sign out" : "Sign out", (_e, cx) => this.signOut(p, cx), asking ? "danger" : null)))
      .when(l?.state === "out", (el) => el.child(this.button(t, `in-${p.key}`, "Sign in", (_e, cx) => this.signIn(p, cx), "primary")));
    const row = v_flex().w_full().py(12).gap(8).border_b(1).border_color(t.border)
      .child(h_flex().w_full().gap(14).items_center()
        .child(this.switcher(t, `on-${p.key}`, on, (_e, cx) => this.toggle(cx, p.key)))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().gap(8).items_center()
            .child(div().text_size(14).text_color(on ? t.foreground : t.muted).child(p.name))
            .child(h_flex().gap(5).items_center().text_size(12).text_color(t.muted)
              .child(div().size(7).rounded(4).bg(dot)).child(status)))
          .child(div().text_size(12).line_height("17px").text_color(t.dim).child(p.about)))
        .child(actions));
    if (p.key !== "openrouter") return row;
    const env = cfg?.keyEnv ?? "OPENROUTER_API_KEY";
    return row
      .child(h_flex().w_full().gap(8).items_center().pl(50)
        .child(div().w(92).text_size(12).text_color(t.muted).child("Usage key"))
        .child(this.field(t, this.keyInput))
        .child(this.button(t, "key-save", "Save", (_e, cx) => this.saveKey(cx)))
        .when(this.keySet, (el) => el.child(this.button(t, "key-clear", "Clear", (_e, cx) => this.clearKey(cx)))))
      .child(div().pl(50 + 100).text_size(11.5).text_color(t.dim)
        .child(this.keySet ? `A key is saved in ${KEY_FILE}. Only the status bar reads it.` : `None saved; the status bar uses $${env} if it is set.`))
      .child(h_flex().w_full().gap(8).items_center().pl(50)
        .child(div().w(92).text_size(12).text_color(t.muted).child("Worker model"))
        .child(this.field(t, this.modelInput))
        .child(this.button(t, "model-save", "Save", (_e, cx) => this.saveModel(cx))));
  }

  render() {
    const t = theme();
    const close = () => closeOverlay(props()?.overlay);
    return v_flex().id("root").w_full().bg(t.popover).rounded(10).border_1().border_color(t.border).px(20).pt(14).pb(16)
      .track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(h_flex().w_full().items_center().pb(6)
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Providers"))
        .child(this.stop(div().id("refresh-logins").p(4).rounded(5).text_color(t.muted).tooltip("Check the logins again")
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.login = {}; cx.notify(); cx.spawn(async (cx) => this.checkAll(cx)); })
          .child(svg("mods/status-plus/refresh.svg").size(14))))
        .child(this.stop(div().id("close").p(4).rounded(5).text_color(t.muted).tooltip("Close (Esc)")
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(close)
          .child(svg("mods/workspace-chrome/x.svg").size(14)))))
      .child(div().text_size(12).text_color(t.dim).pb(4)
        .child("On: a usage chip in the status bar, and hw starts its worker templates. Sign-in runs in the vendor's CLI."))
      .when(Boolean(this.error), (el) => el.child(div().py(8).text_size(12.5).text_color(t.blocked).child(this.error)))
      .children(this.conf ? PROVIDERS.map((p) => this.provider(t, p)) : [])
      .when(Boolean(this.message), (el) => el.child(div().pt(10).text_size(12).text_color(t.muted).child(this.message)))
      .child(h_flex().w_full().pt(12).gap(8).items_center()
        .child(div().flex_1().text_size(11.5).text_color(t.dim).truncate().child("~/.config/herdr-nagne/providers.json"))
        .child(this.button(t, "machines", "Other computers…", () => run("app.settings", { section: "machines" }))));
  }
}
