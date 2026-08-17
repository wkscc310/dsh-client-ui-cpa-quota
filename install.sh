#!/usr/bin/env sh
# Install dsh-client-ui-cpa-quota into the DSH web profile.
# Idempotent: safe to re-run. Symlinks the plugin into the profile's
# node_modules (falls back to copying when symlinks are unavailable,
# e.g. Windows without Developer Mode) and registers the loader entry.
set -eu

NAME="dsh-client-ui-cpa-quota"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PLUGIN_DIR="$DSH_HOME/plugins/$NAME"
LINK_DIR="$DSH_HOME/profiles/node_modules/$NAME"
PATCH="$DSH_HOME/profiles/web/cordis.patch.yml"
REPO="${REPO:-https://github.com/wkscc310/dsh-client-ui-cpa-quota}"

say() { printf '[install] %s\n' "$1"; }

copy_contents() {
    source_dir=$1
    destination_dir=$2
    mkdir -p "$destination_dir"
    for item in "$source_dir"/* "$source_dir"/.[!.]* "$source_dir"/..?*; do
        [ -e "$item" ] || [ -L "$item" ] || continue
        name=${item##*/}
        case "$name" in
            .git|node_modules) continue ;;
        esac
        cp -R "$item" "$destination_dir/"
    done
}

sync_remote_source() {
    stage=$(mktemp -d "${TMPDIR:-/tmp}/$NAME.XXXXXX")
    clone_dir="$stage/$NAME"
    if command -v git >/dev/null 2>&1 && git clone --depth 1 "$REPO" "$clone_dir"; then
        copy_contents "$clone_dir" "$PLUGIN_DIR"
        rm -rf -- "$stage"
        say "updated from $REPO"
        return 0
    fi

    say "git unavailable/failed — downloading zip"
    archive="$stage/src.zip"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$REPO/archive/refs/heads/main.zip" -o "$archive"
    else
        wget -q "$REPO/archive/refs/heads/main.zip" -O "$archive"
    fi
    unzip -q "$archive" -d "$stage"
    copy_contents "$stage/$NAME-main" "$PLUGIN_DIR"
    rm -rf -- "$stage"
    say "downloaded and updated from $REPO"
}

# 1. Source: reuse this script's own checkout when run from the repo,
#    otherwise clone (git) or download (zip) it.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f "$SCRIPT_DIR/lib/client.js" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
    [ "$SCRIPT_DIR" = "$PLUGIN_DIR" ] || { mkdir -p "$DSH_HOME/plugins"; copy_contents "$SCRIPT_DIR" "$PLUGIN_DIR"; }
    say "source ready: $PLUGIN_DIR"
else
    mkdir -p "$DSH_HOME/plugins"
    if ! sync_remote_source && [ ! -d "$PLUGIN_DIR/lib" ]; then
        say "unable to obtain $NAME from $REPO"
        exit 1
    fi
fi

# 2. Link into the profile's node_modules so the DSH loader can resolve it.
mkdir -p "$DSH_HOME/profiles/node_modules"
if [ -L "$LINK_DIR" ]; then
    say "profile symlink already exists: $LINK_DIR"
elif [ -e "$LINK_DIR" ]; then
    copy_contents "$PLUGIN_DIR" "$LINK_DIR"
    say "updated copied plugin: $LINK_DIR"
else
    if ln -s "$PLUGIN_DIR" "$LINK_DIR" 2>/dev/null; then
        say "symlinked $LINK_DIR -> $PLUGIN_DIR"
    else
        copy_contents "$PLUGIN_DIR" "$LINK_DIR"
        say "symlink unavailable — copied to $LINK_DIR"
    fi
fi

# 3. Register the loader entry (append only when missing).
mkdir -p "$(dirname -- "$PATCH")"
touch "$PATCH"
if grep -q "name: ['\"]\?$NAME" "$PATCH"; then
    say "patch entry already present in $PATCH"
else
    printf '\n- insert:\n    - id: ui-cpa-quota\n      name: %s\n' "$NAME" >> "$PATCH"
    say "patch entry appended to $PATCH"
fi

say "done. Restart the DSH web host, then paste your management key in"
say "Settings -> Plugins -> CliProxyAPI Quota."
