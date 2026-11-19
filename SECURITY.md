# Security

## Supported versions

Only the newest release gets fixes. Running the installer again always fetches it:

```
npx github:ggleebwg-stack/herdr-nagne-custom
```

## Reporting a vulnerability

Please report it privately, not in a public issue: open the repository's **Security** tab and choose
**Report a vulnerability**, or go straight to
<https://github.com/ggleebwg-stack/herdr-nagne-custom/security/advisories/new>.

It helps to include the installed version (`~/.config/herdr-nagne/installed.json`), your OS, and the
steps that show the problem.

## What matters most here

- **`herdr-link`** lets your other computers reach herdr over Tailscale. Its bridge listens on
  loopback only and lets in only devices signed in as the same Tailscale user. Anything that gets
  around that check is a vulnerability.
- **Read-only workers** rely on each CLI's own sandbox or permission mode
  ([how that is enforced](README.md#how-read-only-is-enforced)). A shipped template that lets a
  worker write or run a shell where the README says it cannot is a vulnerability.
- **Keys and logins**: the kit stores one secret itself, the OpenRouter usage key in
  `~/.config/herdr-nagne/openrouter.key`. Sign-in for Claude, Codex, Grok and opencode is done by
  each vendor's own CLI. A way to read or leak any of these through the kit is a vulnerability.
- **The installer** edits `keys.json` and `~/.claude/settings.json` only when you pass `--keys` or
  `--claude-hooks`, and moves replaced files to a backup folder. Writing anywhere else is a bug worth
  reporting.

Problems in herdr itself, or in the vendor CLIs, belong with their own projects.
