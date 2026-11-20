// Status bar: herdr's shipped workspace-status (cloned, Apache-2.0) plus usage chips for the
// providers switched on in ~/.config/herdr-nagne/providers.json (Claude, Codex, Grok, OpenRouter)
// and History/Skills buttons, and a "Resume N agents" chip after herdr-core restarted (the list is the
// resume mod).
// Network: only each vendor's own usage endpoint, with the login its CLI already keeps
// (~/.claude/.credentials.json or the macOS keychain; ~/.codex/auth.json) or, for OpenRouter, the key
// named in providers.json (an environment variable or a file). Grok is asked through its own CLI
// (`grok usage --json`). Tokens and keys are never stored or logged.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, exec, hc, home, readTextFile, writeTextFile, shared, setShared, watchFolder, notify } from "herdr";
import * as fs from "fs/promises";

// The usage endpoints are rate limited; five minutes is fresh enough for a status bar.
const REFRESH_MS = 5 * 60 * 1000;
const REFRESH_SPIN_MS = 700;
// Bump when fetchUsage starts returning different bars, so an update asks again
// instead of showing a cached answer without them until the next refresh.
const USAGE_SHAPE = 2;
const WIN = /^[A-Za-z]:/.test(home());
const DIR = `${home()}/.config/herdr-nagne`;
const CONFIG = `${DIR}/providers.json`;
// Claude sessions noted by nagne-session-hook: sessions/<core id>/<terminal>.jsonl (see scanSessions).
const SESSIONS = `${DIR}/sessions`;
const SHELL = /^(powershell|pwsh|cmd|bash|zsh|fish|sh|dash|ksh|nu)(\.exe)?$/i;
const SCAN_MS = 30 * 1000;
const NAMES = { claude: "Claude", codex: "Codex", grok: "Grok", openrouter: "OpenRouter" };
// Each provider's bar in its brand color; "fg" and "muted" follow the theme, so the black brands
// stay visible in a dark theme. providers.json can set its own: "color": "#rrggbb".
const BRAND = { claude: "#d97757", codex: "fg", grok: "muted", openrouter: "#6467f2" };
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
      // A model with its own weekly limit (e.g. Fable) comes as a "weekly_scoped" entry in
      // `limits`; each one gets a bar after wk, labeled with the model's name.
      ...(Array.isArray(d.limits) ? d.limits : [])
        .filter((l) => l?.kind === "weekly_scoped" && l.scope?.model?.display_name)
        .map((l) => [l.scope.model.display_name, l.percent, Date.parse(l.resets_at)]),
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

// The session a terminal's log leaves open: the last start whose id has no later end or dismiss.
// A nested `claude -p` opens and closes its own id, so the pane's session stays the open one.
function openSession(text) {
  const closed = new Set();
  for (const line of (text ?? "").trim().split(/\r?\n/).reverse()) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.e === "start" && !closed.has(j.id)) return j;
    if (j.e === "end" || j.e === "dismiss") closed.add(j.id);
  }
  return null;
}

const hcJson = async (args) => {
  const r = await hc([...args, "--json"]).catch(() => null);
  try { return r?.code === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
};

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
    // A change to providers.json (by hand or from the Providers window) shows at once. The
    // Providers window drops a provider's cached usage when its login changes, so it is asked again.
    cx.spawn(async (cx) => {
      for (;;) {
        const changed = await watchFolder(DIR).catch(() => null);
        if (!changed?.length) return; // no such folder yet, or this copy closed
        const inSessions = (p) => /[\\/]sessions([\\/]|$)/.test(p);
        if (changed.some((p) => !inSessions(p))) this.refresh(cx);
        if (changed.some((p) => !/[\\/](providers\.json|openrouter\.key)$/.test(p))) this.scanSessions(cx);
      }
    });
    this.scanSessions(cx);
    cx.timer.every(SCAN_MS, (cx) => this.scanSessions(cx));
    // The History button needs the separately installed `history` mod.
    cx.spawn(async (cx) => {
      this.hasHistory = await readTextFile(`${home()}/.config/herdr-app/mods/history/mod.json`).then(() => true, () => false);
      cx.notify();
    });
  }

  // The last good answer is kept in shared (persisted) state: a mod reload or app restart
  // reuses it instead of calling again (the Claude endpoint answers 429 to rapid calls),
  // and a failed call keeps showing it, marked stale in the tooltip. A click forces a call.
  // providers.json is read on every refresh.
  refresh(cx, force = false) {
    if (force) {
      if (this.refreshing) return;
      this.refreshing = true;
      cx.notify();
    }
    cx.spawn(async (cx) => {
      try {
        const raw = await readTextFile(CONFIG).catch(() => null);
        let conf = DEFAULT_CONFIG;
        this.confError = null;
        if (raw) {
          try { conf = JSON.parse(raw); } catch (e) { this.confError = `providers.json: ${e?.message ?? e}`; }
        }
        this.providers = Object.entries(conf).filter(([k, v]) => v?.enabled && NAMES[k]).map(([key, cfg]) => ({ key, cfg }));
        for (const p of this.providers) this.load(cx, p.key, p.cfg, force);
        cx.notify();
      } finally {
        if (force) cx.timer.after(REFRESH_SPIN_MS, (cx) => {
          this.refreshing = false;
          cx.notify();
        });
      }
    });
  }

  load(cx, key, cfg, force) {
    const cacheKey = `status-plus.usage.${key}`;
    const cached = shared(cacheKey);
    if (!force && cached?.at && cached.shape === USAGE_SHAPE && Date.now() - cached.at < REFRESH_MS - 30000) {
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
      if (!r.error) setShared(cacheKey, { ...r, at: Date.now(), shape: USAGE_SHAPE });
      if (r.error === "HTTP 429") setShared(`status-plus.blocked.${key}`, Date.now() + Math.max(r.retryAfter, 60) * 1000);
      this.usage[key] = r.error && cached?.windows ? { ...cached, stale: r.error } : r;
      cx.notify();
    });
  }

  // Agents to resume: a terminal whose log has an open Claude session, that still exists, isn't a
  // worker, and now shows a plain shell (after a reboot herdr-core gives each kept pane a shell in
  // its last folder, same address). Asked of the core itself, not the app's live lists, so a window
  // that is still connecting can't make a running agent look gone. Logs of terminals that no longer
  // exist are emptied. Only this window's core's folder is read: another core on this computer has
  // its own t1, t2… The list goes to shared state; the resume mod acts on it.
  scanSessions(cx) {
    if (this.scanning) return;
    this.scanning = true;
    cx.spawn(async (cx) => {
      try {
        const core = (await hcJson(["server", "status"]))?.core?.id;
        if (!/^[0-9a-f]{8,64}$/.test(core ?? "")) return; // core not reachable: decide nothing
        const dir = `${SESSIONS}/${core}`;
        const files = (await fs.readdir(dir).catch(() => [])).filter((f) => /^t[0-9a-z]+\.jsonl$/.test(f));
        const ls = files.length ? await hcJson(["ls"]) : [];
        if (!ls) return;
        const live = new Map((Array.isArray(ls) ? ls : ls.terminals ?? []).map((t) => [t.address, t]));
        const sent = shared("resume.sent") ?? {};
        const found = [];
        for (const f of files) {
          const address = f.slice(0, -6);
          const path = `${dir}/${f}`;
          const text = await readTextFile(path).catch(() => null);
          const term = live.get(address);
          if (!term) { if (text) await writeTextFile(path, "", text).catch(() => null); continue; }
          const s = openSession(text);
          if (!s || term.parent || term.status || Date.now() - (sent[address] ?? 0) < 120000) continue;
          const fg = (await hcJson(["get", address]))?.foreground;
          if (!SHELL.test(fg?.name ?? "")) continue;
          const space = spaces().find((x) => x.id === term.labels?.["herdr.space"]);
          found.push({ terminal: address, app: s.app, id: s.id, cwd: s.cwd, at: s.at, where: space?.name ?? "", log: path });
        }
        if (JSON.stringify(found) !== JSON.stringify(shared("resume.candidates") ?? [])) setShared("resume.candidates", found);
        // One note per session, the first time it can be resumed.
        const told = shared("resume.told") ?? [];
        const fresh = found.filter((c) => !told.includes(c.id));
        if (fresh.length) {
          setShared("resume.told", [...told, ...fresh.map((c) => c.id)].slice(-50));
          notify({ title: "Resume agents", body: `${found.length} Claude session${found.length > 1 ? "s were" : " was"} running before herdr-core restarted. Click to choose.`,
            level: "info", action: { name: "mod.open", args: { name: "resume" } } });
        }
      } finally {
        this.scanning = false;
        cx.notify();
      }
    });
  }

  // Dismiss every candidate, as the resume mod's Dismiss does one: a dismiss line in its log, so
  // the next scan leaves it out. The panes and their shells stay as they are.
  dismissAll(cx) {
    const list = shared("resume.candidates") ?? [];
    setShared("resume.candidates", []);
    cx.notify();
    cx.spawn(async () => {
      for (const c of list) {
        const path = c.log;
        if (!path) continue;
        const old = (await readTextFile(path).catch(() => null)) ?? "";
        const sep = old && !old.endsWith("\n") ? "\n" : "";
        await writeTextFile(path, `${old}${sep}${JSON.stringify({ e: "dismiss", id: c.id, at: Date.now() })}\n`, old || null).catch(() => null);
      }
    });
  }

  resumeChip(t) {
    const n = (shared("resume.candidates") ?? []).length;
    return h_flex().items_center().rounded(5).border_1().border_color(t.accent).text_color(t.accent)
      .child(div().id("resume-open").pl(8).pr(4).py(1).rounded_l(5)
        .tooltip("Agents that were running before herdr-core restarted (reboot, logout). Click to choose which to resume.")
        .hover((s) => s.bg(t.hover)).on_click(() => run("mod.open", { name: "resume" }))
        .child(`Resume ${n} agent${n > 1 ? "s" : ""}`))
      .child(div().id("resume-dismiss").px(5).py(1).rounded_r(5).tooltip("Don't resume: dismiss all and hide this")
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.dismissAll(cx))
        .child("×"));
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
  // The bar fills with the share used, in the provider's color, red from 90%. The number turns
  // yellow from 80% and red from 90%.
  quota(t, key, name, cfg) {
    const u = this.usage[key];
    const BAR = 56;
    const own = /^#[0-9a-f]{6}$/i.test(cfg?.color ?? "") ? cfg.color : BRAND[key] ?? "fg";
    const brand = own === "fg" ? t.foreground : own === "muted" ? t.muted : own;
    const warn = (used) => used >= 90 ? t.ansi1 : t.ansi3;
    const fill = (used) => used >= 90 ? t.ansi1 : brand;
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
          .child(div().w(30).text_right().text_color(used >= 80 ? warn(used) : t.foreground).child(`${used}%`))
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

  refreshButton(t) {
    const busy = this.refreshing || this.pending > 0;
    return div().id("quota-refresh").p(3).rounded(4).text_color(busy ? t.accent : t.muted)
      .tooltip(busy ? "Refreshing usage…" : "Refresh usage now")
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { if (!(this.pending > 0)) this.refresh(cx, true); })
      .child(svg("mods/status-plus/refresh.svg").size(13).when(busy, (el) => el.spin(REFRESH_SPIN_MS)));
  }

  // Opens the Providers window: switch providers, sign in or out, OpenRouter key and model.
  settingsButton(t) {
    return div().id("providers-open").p(3).rounded(4).text_color(t.muted).tooltip("Providers: switch on/off, sign in (Ctrl+Shift+U)")
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => run("mod.open", { name: "providers" }))
      .child(svg("mods/workspace-chrome/settings.svg").size(13));
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
        .when((shared("resume.candidates") ?? []).length > 0, (el) => el.child(this.resumeChip(t)))
        .children((this.providers ?? []).map((p) => this.quota(t, p.key, NAMES[p.key], p.cfg)))
        .when(Boolean(this.confError), (el) => el.child(div().id("providers-error").text_color(t.blocked).tooltip(this.confError).child("providers.json ⚠")))
        .child(h_flex().gap(1).items_center().child(this.refreshButton(t)).child(this.settingsButton(t))))
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
