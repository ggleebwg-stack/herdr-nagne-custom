// Status bar: herdr's shipped workspace-status (cloned, Apache-2.0) plus usage chips for the
// providers switched on in ~/.config/herdr-nagne/providers.json (Claude, Codex, Grok, OpenRouter)
// and History/Skills buttons.
// Network: only each vendor's own usage endpoint, with the login its CLI already keeps
// (~/.claude/.credentials.json or the macOS keychain; ~/.codex/auth.json) or, for OpenRouter, the key
// named in providers.json (an environment variable or a file). Grok is asked through its own CLI
// (`grok usage --json`). Tokens and keys are never stored or logged.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec, home, readTextFile, shared, setShared } from "herdr";

// The usage endpoints are rate limited; five minutes is fresh enough for a status bar.
const REFRESH_MS = 5 * 60 * 1000;
const WIN = /^[A-Za-z]:/.test(home());
const CONFIG = `${home()}/.config/herdr-nagne/providers.json`;
const NAMES = { claude: "Claude", codex: "Codex", grok: "Grok", openrouter: "OpenRouter" };
// Without a providers.json the bar shows what it always showed.
const DEFAULT_CONFIG = { claude: { enabled: true }, codex: { enabled: true } };

const readJson = async (path) => JSON.parse(await readTextFile(path));

// An environment variable's value. herdr may have started before the variable was set, so on
// Windows the user's stored value is read too; elsewhere a login shell picks up the profile.
async function readEnv(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name ?? "")) return null;
  const r = WIN
    ? await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command",
        `$v=[Environment]::GetEnvironmentVariable('${name}'); if(-not $v){$v=[Environment]::GetEnvironmentVariable('${name}','User')}; [Console]::Out.Write($v)`]).catch(() => null)
    : await exec("sh", ["-lc", `printf %s "\${${name}:-}"`]).catch(() => null);
  return (r?.code === 0 && r.stdout.trim()) || null;
}

// A provider's API key: from the file named by keyFile, else the variable named by keyEnv.
async function readKey(cfg) {
  if (cfg?.keyFile) {
    const k = await readTextFile(cfg.keyFile.replace(/^~(?=$|[\\/])/, home())).catch(() => null);
    if (k?.trim()) return k.trim();
  }
  return readEnv(cfg?.keyEnv);
}

const money = (n) => `$${Number(n).toFixed(2)}`;

// Claude Code keeps its OAuth login in the macOS keychain, elsewhere in a file.
async function claudeLogin() {
  if (window()?.platform === "macos") {
    const r = await exec("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"]).catch(() => null);
    if (r?.code === 0) return JSON.parse(r.stdout);
  }
  return readJson(`${home()}/.claude/.credentials.json`);
}

// Each HTTP provider: how to build the request, and how to read the answer into
// { windows: [{ label, used (0-100), resetsAt (ms, optional) }], note (optional text) }.
const PROVIDERS = {
  claude: {
    url: "https://api.anthropic.com/api/oauth/usage",
    async headers() {
      const token = (await claudeLogin())?.claudeAiOauth?.accessToken;
      return token && { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" };
    },
    windows: (d) => [
      ["5h", d.five_hour?.utilization, Date.parse(d.five_hour?.resets_at)],
      ["wk", d.seven_day?.utilization, Date.parse(d.seven_day?.resets_at)],
    ],
  },
  codex: {
    url: "https://chatgpt.com/backend-api/wham/usage",
    async headers() {
      const t = (await readJson(`${home()}/.codex/auth.json`))?.tokens;
      return t?.access_token && { Authorization: `Bearer ${t.access_token}`, "ChatGPT-Account-Id": t.account_id ?? "" };
    },
    windows: (d) => [
      ["5h", d.rate_limit?.primary_window?.used_percent, d.rate_limit?.primary_window?.reset_at * 1000],
      ["wk", d.rate_limit?.secondary_window?.used_percent, d.rate_limit?.secondary_window?.reset_at * 1000],
    ],
  },
  // OpenRouter credits for the key: a bar when the key has a limit, else the amount spent.
  openrouter: {
    url: "https://openrouter.ai/api/v1/key",
    async headers(cfg) {
      const key = await readKey(cfg);
      return key && { Authorization: `Bearer ${key}` };
    },
    windows: (d) => {
      const k = d.data ?? {};
      return typeof k.limit === "number" && k.limit > 0 ? [["key", (100 * (k.usage ?? 0)) / k.limit]] : [];
    },
    note: (d) => {
      const k = d.data ?? {};
      if (typeof k.limit_remaining === "number") return `${money(k.limit_remaining)} left`;
      return typeof k.usage === "number" ? `${money(k.usage)} used` : null;
    },
    missing: (cfg) => `no key: set ${cfg?.keyEnv ?? "keyEnv"} or keyFile in providers.json`,
  },
};

// Grok has no public usage endpoint. Its CLI prints the plan's usage only when Grok's background
// service (the "daemon route") is in use; otherwise it says to run /usage inside grok.
async function grokUsage(cfg) {
  const r = await exec(cfg?.command ?? "grok", ["usage", "--json"]).catch(() => null);
  if (!r) return { error: "grok not found (install the Grok CLI or set command in providers.json)" };
  if (r.code !== 0) {
    if (/not signed in/i.test(r.stderr)) return { error: "not logged in (run grok login)" };
    return { windows: [], note: "/usage", info: "Grok shows its plan usage only inside grok: type /usage there." };
  }
  return { windows: [], note: "plan", info: `grok usage: ${r.stdout.trim().slice(0, 400)}` };
}

// { windows, note?, info? } on success, { error, retryAfter (s) } otherwise.
async function fetchUsage(key, cfg) {
  if (key === "grok") return grokUsage(cfg);
  const p = PROVIDERS[key];
  if (!p) return { error: "unknown provider" };
  const headers = await p.headers(cfg).catch(() => null);
  if (!headers) return { error: p.missing?.(cfg) ?? "not logged in" };
  const res = await fetch(p.url, { headers });
  if (!res.ok) return { error: `HTTP ${res.status}`, retryAfter: Number(res.headers?.get?.("retry-after")) || 0 };
  const d = await res.json();
  const windows = p.windows(d)
    .filter(([, used]) => typeof used === "number")
    .map(([label, used, resetsAt]) => ({ label, used, resetsAt }));
  return { windows, note: p.note?.(d) ?? null };
}

function untilText(ms) {
  // Two units, spaced, the second zero-padded so the columns keep their width: "4d 21h", "2h 05m", "36m".
  const mins = Math.max(0, Math.round((ms - Date.now()) / 60000));
  const pad = (n) => String(n).padStart(2, "0");
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${pad(Math.floor((mins % 1440) / 60))}h`;
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${pad(mins % 60)}m`;
  return `${mins}m`;
}

export default class StatusPlus extends View {
  init(_props, cx) {
    this.usage = {};
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
    // The History button needs the separately installed `history` mod.
    cx.spawn(async (cx) => {
      this.hasHistory = await readTextFile(`${home()}/.config/herdr-app/mods/history/mod.json`).then(() => true, () => false);
      cx.notify();
    });
  }

  // The last good answer is kept in shared (persisted) state: a mod reload or app restart
  // reuses it instead of calling again (the Claude endpoint answers 429 to rapid calls),
  // and a failed call keeps showing it, marked stale in the tooltip. A click forces a call.
  // providers.json is read on every refresh, so an edit shows on the next refresh or click.
  refresh(cx, force = false) {
    cx.spawn(async (cx) => {
      const raw = await readTextFile(CONFIG).catch(() => null);
      let conf = DEFAULT_CONFIG;
      this.confError = null;
      if (raw) {
        try { conf = JSON.parse(raw); } catch (e) { this.confError = `providers.json: ${e?.message ?? e}`; }
      }
      this.providers = Object.entries(conf).filter(([k, v]) => v?.enabled && NAMES[k]).map(([key, cfg]) => ({ key, cfg }));
      for (const p of this.providers) this.load(cx, p.key, p.cfg, force);
      cx.notify();
    });
  }

  load(cx, key, cfg, force) {
    const cacheKey = `status-plus.usage.${key}`;
    const cached = shared(cacheKey);
    if (!force && cached?.at && Date.now() - cached.at < REFRESH_MS - 30000) {
      this.usage[key] = cached;
      cx.notify();
      return;
    }
    // After a 429 the vendor names a wait; calling sooner (even by click) only extends it.
    const blockedUntil = shared(`status-plus.blocked.${key}`) ?? 0;
    if (Date.now() < blockedUntil) {
      const wait = `rate limited, retry in ${untilText(blockedUntil)}`;
      this.usage[key] = cached?.windows ? { ...cached, stale: wait } : { error: wait };
      cx.notify();
      return;
    }
    this.pending = (this.pending ?? 0) + 1;
    cx.spawn(async (cx) => {
      let r;
      try { r = await fetchUsage(key, cfg); } catch (e) { r = { error: String(e?.message ?? e) }; }
      this.pending -= 1;
      if (!r.error) setShared(cacheKey, { ...r, at: Date.now() });
      if (r.error === "HTTP 429") setShared(`status-plus.blocked.${key}`, Date.now() + Math.max(r.retryAfter, 60) * 1000);
      this.usage[key] = r.error && cached?.windows ? { ...cached, stale: r.error } : r;
      cx.notify();
    });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  // One provider, drawn like Orca's usage bars: "Claude 5h ▬── 11% 2h 13m  wk ▬▬─ 47% 3d 04h".
  // The bar fills with the share used: green, yellow from 80%, red from 90%.
  quota(t, key, name) {
    const u = this.usage[key];
    const BAR = 56;
    const fill = (used) => used >= 90 ? t.ansi1 : used >= 80 ? t.ansi3 : t.ansi2;
    let body, tip;
    if (!u) {
      body = [div().text_color(t.dim).child("…")];
      tip = `${name}: loading`;
    } else if (u.error) {
      body = [div().text_color(t.dim).child("—")];
      tip = `${name}: ${u.error} (click to retry)`;
    } else {
      body = u.windows.map((w) => {
        const used = Math.min(100, Math.max(0, Math.round(w.used)));
        return h_flex().gap(5).items_center()
          .child(div().text_color(t.muted).child(w.label))
          .child(div().w(BAR).h(7).rounded(4).bg(t.border).overflow_hidden()
            .child(div().h(7).rounded(4).w(Math.max(used > 0 ? 3 : 0, Math.round((BAR * used) / 100))).bg(fill(used))))
          .child(div().w(30).text_right().text_color(used >= 80 ? fill(used) : t.foreground).child(`${used}%`))
          .when(Number.isFinite(w.resetsAt), (el) => el.child(div().w(46).text_right().text_color(t.dim).child(untilText(w.resetsAt))));
      });
      if (u.note) body.push(div().text_color(u.windows.length ? t.dim : t.muted).child(u.note));
      const resets = u.windows.filter((w) => Number.isFinite(w.resetsAt)).map((w) => `${w.label} resets in ${untilText(w.resetsAt)}`);
      tip = [u.info ?? `${name} used`, ...resets].join(" · ") + " (click to refresh)";
      if (u.stale) tip = `${tip}\nAs of ${new Date(u.at).toTimeString().slice(0, 5)}; latest check failed: ${u.stale}`;
    }
    // A chip per provider so the two read as separate groups.
    return h_flex().id(`quota-${key}`).gap(10).items_center().px(8).py(1).rounded(5)
      .bg(t.hover).border_1().border_color(t.border).tooltip(tip)
      .on_click((_e, cx) => this.refresh(cx, true))
      .child(div().text_color(t.foreground).child(name))
      .children(body);
  }

  // Refresh both providers now; shows a spinner while a call is in flight.
  refreshButton(t) {
    const busy = (this.pending ?? 0) > 0;
    return div().id("quota-refresh").p(3).rounded(4).text_color(busy ? t.accent : t.muted)
      .tooltip(busy ? "Refreshing usage…" : "Refresh usage now")
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { if (!busy) this.refresh(cx, true); })
      .child(svg(busy ? "mods/workspace-chrome/spinner.svg" : "mods/status-plus/refresh.svg").size(13));
  }

  // A text button: History opens as its own tab, Skills beside the focused agent.
  button(t, id, text, tip, action) {
    return div().id(id).px(6).py(1).rounded(4).text_color(t.muted).tooltip(tip)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(action).child(text);
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    // Quota sits bottom-left; the machine, branch, agents and buttons moved to the right.
    return h_flex().size_full().px(10).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(h_flex().gap(8).items_center()
        .children((this.providers ?? []).map((p) => this.quota(t, p.key, NAMES[p.key])))
        .when(Boolean(this.confError), (el) => el.child(div().id("providers-error").text_color(t.blocked).tooltip(this.confError).child("providers.json ⚠")))
        .child(this.refreshButton(t)))
      .child(div().flex_1())
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(h_flex().gap(2).items_center()
        .when(Boolean(this.hasHistory), (el) => el.child(this.button(t, "open-history", "History", "Past Claude/Codex sessions (Ctrl+Shift+H)", () => run("tab.new", { name: "History", mod: "history" }))))
        .child(this.button(t, "open-skills", "Skills", "Send a skill to an agent (Ctrl+Shift+J)", () => run("pane.split", { direction: "right", mod: "skills" }))))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
