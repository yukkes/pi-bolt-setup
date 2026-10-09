#!/bin/sh
# Pi-Bolt setup for coding-only EC2 hosts (no npm needed).
# Installs Pi-Bolt from GitHub Releases and reproduces the plugins, models and subagents in
# config.json plus the two-row Nerd Font footer. Copy the whole pi-setup/ directory.
# Credentials are not copied; run /login after installing if not logged in.
#
#   sh install-pi-bolt.sh
#   sh install-pi-bolt.sh --configure-only  # only re-apply settings on an existing install

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$#:${1:-}" in
	0: | 1:) CONFIGURE_ONLY=no ;;
	1:--configure-only) CONFIGURE_ONLY=yes ;;
	*) echo "Usage: sh $0 [--configure-only]" >&2; exit 1 ;;
esac
for file in config.json configure.js footer-render.ts agents; do
	[ -e "$SCRIPT_DIR/$file" ] || { echo "Missing setup file: $SCRIPT_DIR/$file" >&2; exit 1; }
done

# Run the official installer non-interactively (it auto-selects x64 / x64-baseline by AVX2 support).
export PIBOLT_SOURCE=github PIBOLT_EXTENSIONS=no PIBOLT_YES=1
if [ "$CONFIGURE_ONLY" = no ]; then
	echo "==> Installing Pi-Bolt from GitHub Releases"
	INSTALLER_TMP=$(mktemp)
	trap 'rm -f "$INSTALLER_TMP"' EXIT HUP INT TERM
	curl -fsSL https://pi-bolt.opensec.in/install.sh -o "$INSTALLER_TMP"
	sh "$INSTALLER_TMP"
	rm -f "$INSTALLER_TMP"
	trap - EXIT HUP INT TERM
fi

PI_BOLT="$HOME/.local/bin/pi-bolt"
[ -x "$PI_BOLT" ] || { echo "pi-bolt not found in $HOME/.local/bin" >&2; exit 1; }
echo "==> Version"
"$PI_BOLT" --version
configure() { BUN_BE_BUN=1 "$PI_BOLT" "$SCRIPT_DIR/configure.js" "$@"; }

if [ "$CONFIGURE_ONLY" = no ]; then
	echo "==> Installing plugins (equivalent to pi install)"
	PLUGINS=$(configure --plugins)
	set -f
	for source in $PLUGINS; do "$PI_BOLT" install "$source"; done
	set +f
fi

# Only managed fields are reproduced; other settings and credentials are kept (originals backed up once as *.pre-config.bak).
echo "==> Configuring models, subagents and the two-row Nerd Font footer (use a Nerd Font such as JetBrainsMono Nerd Font in your terminal)"
configure

echo "==> Done. Make sure ~/.local/bin is on PATH, then run pi-bolt."
echo "    Run /login on first start, or /reload in a running Pi to apply the settings."
