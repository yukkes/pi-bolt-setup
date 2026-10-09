# Pi-Bolt setup

Reproduces Pi-Bolt, its plugins (equivalent to `pi install`), model and subagent settings, and a two-row Nerd Font footer.
To set up another machine, **copy the whole `pi-setup/` directory**. Credentials and sessions are not included.

```sh
sh ~/environment/pi-setup/install-pi-bolt.sh                   # Pi-Bolt + plugins + settings + footer
sh ~/environment/pi-setup/install-pi-bolt.sh --configure-only  # re-apply settings and footer only
```

The script can run from any working directory because it reads files relative to its own location.
`--configure-only` requires Pi-Bolt and `pi-better-footer@0.1.4` to be installed already.
On first start run `/login` in Pi; in a running Pi use `/reload` to apply changes.
Set a Nerd Font such as JetBrainsMono Nerd Font in your terminal. The installer does not change terminal settings.

## Layout

```text
pi-setup/
├── config.json        # plugins, models, per-agent models, other managed settings
├── install-pi-bolt.sh # installs Pi-Bolt, runs pi-bolt install, runs configure.js
├── configure.js       # applies settings, agents and footer (runs on Pi-Bolt's bundled Bun)
├── agents/*.md        # subagent prompts and tool limits (model is injected from config.json)
├── footer-render.ts   # two-row footer with │ separators
├── footer-speed.ts    # local whole-reply throughput measurement
├── test-footer-speed.ts # deterministic speed/lifecycle regression tests
├── test-install.py    # installer test in an isolated HOME
└── test-footer.ts     # rendering test using the real Pi TUI
```

## config.json

| Key | Purpose |
|---|---|
| `plugins` | Sources passed to `pi-bolt install`, in order |
| `models.default` | Default model as `provider/model` (sets `defaultProvider` / `defaultModel`) |
| `models.enabled` | Enabled models (`enabledModels`) |
| `agents` | Agent name → model; inserted as `model:` after the `description:` line of `agents/<name>.md` |
| `files` | JSON settings merged as-is (`better-footer.json`: no model restore or exhausted-model skipping; `subagents.json`: `scopeModels`) |

Current setup: default `gpt-6.1-sol`. Agents: general-purpose uses sol, Explore uses luna (read-only), and Plan / Review use opus (read-only).
Plugins: subagents, TODO, goal, the footer base (`pi-better-footer@0.1.4`) and search/fetch (latest Git).
Pi-Bolt itself and Git sources install the latest version, so those are not fully pinned.
Enabling another TODO plugin at the same time may cause tool-name conflicts.

Settings go to `~/.pi/agent`, or to `PI_CODING_AGENT_DIR` when set.
Managed fields are re-applied, including same-named keys in the Pi-Bolt `piBolt` override. Managed agent files are also re-applied.
Unrelated settings, extra agents and credentials are kept.
The first time a file changes, the original is saved as `*.pre-config.bak`.

## Footer

![Footer preview](footer.svg)

```text
 environment │  gpt-6.1-sol  medium │  rem 19080/30000
 116k/1.1M │  CH99% R6.9M W105k │  300  39k │ $1.346  94t/s
```

The footer reuses the auth, quota fetching and refresh logic from `pi-better-footer@0.1.4`.
The installer builds a local copy in `~/.pi/agent/local-packages/nerd-footer` with `footer-render.ts` swapped in and upstream speed measurement replaced by `footer-speed.ts`.
Quota and session cost aggregation are not changed by the speed replacement; no additional runtime dependencies are installed.
The upstream footer's display extension is disabled, so only the local copy is loaded.

- Both rows are left-aligned. Groups are separated by a light-gray `│` with one space on each side, and there is no center padding.
- Row 1: workspace / branch │ model + reasoning effort │ Copilot quota (`rem` remaining/total).
- Row 2: context used/capacity │ cache hit rate + total read/write │ total input/output │ cost + speed.
- There are no bars and no context percentage.
  - Context is Pi's estimate; it shows `?/capacity` when unknown.
  - The percentage only sets the warning color: yellow at 50% or more, red at 80% or more.
- `CH` is the cache hit rate of the latest request: green at 70% or more, yellow at 40% or more, red below that.
- `R` / `W` are session totals and are hidden when 0. Cost is shown only when it is above 0.
- Speed is output tokens divided by the whole assistant reply duration (`message_start` → `message_end`), including initial latency and hidden reasoning, but excluding tool execution. This is observed reply throughput, not pure decoder speed.
  - Using the full duration avoids dividing whole-message usage by a tiny interval when a provider buffers its output. Samples shorter than 1 second are hidden, not clamped to an invented speed.
  - Streaming speed is a cumulative character-based estimate marked `~`. At completion, reported output usage (including reasoning and tool arguments) replaces it; missing/invalid usage and failed/aborted replies keep a marked estimate.
  - Starting a reply or switching models/sessions clears the previous speed. After completion it remains until the next reply. Live updates are event-driven, at most four times per second.
- Model uses `nf-fa-cube` (`U+F1B2`) and thinking uses `nf-fa-lightbulb_o` (`U+F0EB`), from the widely supported Font Awesome set in Nerd Fonts. The SVG preview uses the same glyph shapes as paths, without requiring a browser font.
- Icons are cyan and values are white. No purple and no faint `dim` text; light themes use a darker palette.
- The `github-copilot/` prefix is omitted; other providers are shown.
- `idle` and the static `search[search:…]` text are hidden. Extension statuses (such as goal) and `queued` appear as an extra group when there is room.
- Other providers' quota windows (5h/1w, etc.) show usage, for example `5h used 25%`. Windows that cannot be fetched are hidden.
- On narrow terminals, whole groups are dropped first (cost/speed, then cache amounts), and the context amount is kept. Long branch names in row 1 are shortened.

Theme, credentials and `statusline.py` are not changed.
After editing `footer-render.ts` or `footer-speed.ts`, regenerate the footer with `--configure-only`.

## Tests

```sh
python3 ~/environment/pi-setup/test-install.py
BUN_BE_BUN=1 ~/.local/bin/pi-bolt ~/environment/pi-setup/test-footer-speed.ts

rm -f /tmp/pi-footer-test-result.txt
~/.local/bin/pi-bolt --offline --no-extensions \
  -e ~/environment/pi-setup/test-footer.ts --mode rpc --no-session < /dev/null
grep '^PASS:' /tmp/pi-footer-test-result.txt
```

The installer test runs in an isolated HOME. Only the download and `pi-bolt install` are mocked; `configure.js` runs on the real bundled Bun.
It checks:
- Pi-Bolt-override, top-level and mixed settings layouts
- single footer activation
- preserved credentials
- backups
- idempotence

The footer test checks the installed footer with the real Pi TUI and makes no model requests.
The result file is written only on success, because Pi can exit with code 0 even when an extension fails.
