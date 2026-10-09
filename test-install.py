#!/usr/bin/env python3
"""Run install-pi-bolt.sh in an isolated HOME without network access or real user changes.

Only curl and `pi-bolt install` are mocked; configure.js runs with the real Pi-Bolt bundled Bun.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "config.json").read_text())
PROVIDER, MODEL = CONFIG["models"]["default"].split("/", 1)
MANAGED = {"enabledModels": CONFIG["models"]["enabled"], "defaultProvider": PROVIDER, "defaultModel": MODEL}
FOOTER = "npm:pi-better-footer@0.1.4"
MOCKS = {
    "curl": """#!/bin/sh
[ "$2" = https://pi-bolt.opensec.in/install.sh ] && echo 'echo mock official installer' > "$4"
""",
    "pi-bolt": """#!/bin/sh
case "$1" in
--version) echo mock Pi-Bolt ;;
install)
	echo "$2" >> "$INSTALL_LOG"
	case "$2" in npm:pi-better-footer@*)
		mkdir -p "$PI_CODING_AGENT_DIR/npm/node_modules" && cp -r "$UPSTREAM_FOOTER" "$PI_CODING_AGENT_DIR/npm/node_modules/" ;;
	esac ;;
*) exec "$REAL_PI" "$@" ;;
esac
""",
}
# Initial settings layouts: Pi-Bolt override only, top-level only, and both.
SCENARIOS = {
    "pibolt": {"unrelated": "keep", "piBolt": {"defaultModel": "old", "packages": []}},
    "top-level": {**MANAGED, "packages": [FOOTER, "LOCAL"], "unrelated": "keep"},
    "mixed": {**MANAGED, "packages": [FOOTER, "LOCAL"], "unrelated": "keep", "piBolt": {"packages": [FOOTER]}},
}


def load(path):
    return json.loads(path.read_text())


def snapshot(directory):
    return {path: path.read_bytes() for path in directory.rglob("*") if path.is_file()}


with tempfile.TemporaryDirectory(prefix="pi-install-test-") as tmp:
    home = Path(tmp)
    bins = home / ".local/bin"
    bins.mkdir(parents=True)
    for name, body in MOCKS.items():
        (bins / name).write_text(body)
        (bins / name).chmod(0o755)
    env = {**os.environ, "HOME": tmp, "PATH": f"{bins}:{os.environ['PATH']}", "INSTALL_LOG": f"{tmp}/install.log",
           "REAL_PI": str(Path.home() / ".local/bin/pi-bolt"),
           "UPSTREAM_FOOTER": str(Path.home() / ".pi/agent/npm/node_modules/pi-better-footer")}

    for scenario, initial in SCENARIOS.items():
        agent = home / scenario
        local = str(agent / "local-packages/nerd-footer")
        agent.mkdir()
        baseline = json.dumps(initial, indent=2).replace("LOCAL", local) + "\n"
        (agent / "settings.json").write_text(baseline)
        (agent / "better-footer.json").write_text('{"keepRecentModel": true, "unrelated": "keep"}')
        (agent / "auth.json").write_text("DO-NOT-TOUCH\n")
        run = lambda *args: subprocess.run(["sh", str(ROOT / "install-pi-bolt.sh"), *args], env={**env, "PI_CODING_AGENT_DIR": str(agent)},
                                           cwd="/tmp", check=True, capture_output=True, text=True)
        run()

        # Managed models are reproduced (including Pi-Bolt overrides); unrelated settings are kept.
        settings = load(agent / "settings.json")
        for key, value in MANAGED.items():
            assert settings[key] == value and settings.get("piBolt", {}).get(key, value) == value, (scenario, key)
        assert settings["unrelated"] == "keep"
        # Exactly one local footer is loaded; every upstream footer entry has its extensions disabled.
        lists = [owner["packages"] for owner in (settings, settings.get("piBolt", {})) if "packages" in owner]
        assert sum(packages.count(local) for packages in lists) == 1, scenario
        upstream = [e for packages in lists for e in packages if e != local and "pi-better-footer" in str(e)]
        assert upstream and all(e == {"source": FOOTER, "extensions": []} for e in upstream), scenario
        assert (agent / "local-packages/nerd-footer/extensions/footer/render.ts").read_bytes() == (ROOT / "footer-render.ts").read_bytes()
        footer_dir = agent / "local-packages/nerd-footer/extensions/footer"
        assert (footer_dir / "speed.ts").read_bytes() == (ROOT / "footer-speed.ts").read_bytes()
        index = (footer_dir / "index.ts").read_text()
        assert index.count("registerTokenSpeed(pi,") == 1
        assert not any(name in index for name in ("measureTokenSpeed", "estimateRate", "updateLiveSpeed", "resetStreamTiming"))
        assert 'pi.on("after_provider_response"' in index and 'pi.on("message_end"' in index, "quota lifecycle must remain"
        # The local speed replacement must not change upstream session usage/cost aggregation.
        assert (footer_dir / "session-stats.ts").read_bytes() == (Path(env["UPSTREAM_FOOTER"]) / "extensions/footer/session-stats.ts").read_bytes()
        # Other managed files, agents (model from config.json), credentials and the one-time backup.
        for name, value in CONFIG["files"].items():
            assert load(agent / name) == ({**value, "unrelated": "keep"} if name == "better-footer.json" else value)
        for name, model in CONFIG["agents"].items():
            expected = re.sub(r"^(description:.*\n)", lambda m: f"{m[1]}model: {model}\n", (ROOT / f"agents/{name}.md").read_text(), count=1, flags=re.M)
            assert (agent / f"agents/{name}.md").read_text() == expected, name
        assert (agent / "auth.json").read_text() == "DO-NOT-TOUCH\n"
        assert (agent / "settings.json.pre-config.bak").read_text() == baseline, "backup must hold the original settings"
        # Re-applying is idempotent and does not install packages.
        before = snapshot(agent)
        run("--configure-only")
        assert snapshot(agent) == before, f"{scenario}: configuration is not idempotent"

    assert (home / "install.log").read_text().splitlines() == CONFIG["plugins"] * len(SCENARIOS), "pi install sources differ from config.json"
    print("PASS: installer with mocked download/install and real Bun; Pi-Bolt/top-level/mixed settings; models, agents, "
          "single footer activation, preserved credentials/unrelated settings, backups, configure-only idempotence.")
