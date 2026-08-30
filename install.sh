#!/usr/bin/env sh
# Install dsh-client-ui-cpa-quota into the current dsh web profile.
# Idempotent: safe to re-run.
#
# New dsh (0.1.1-rc.x) flow: the plugin's node half imports
# @deepseek-ai/dsh-settings, so the package must materialize as a real
# directory inside a node_modules that also carries the hoisted
# @deepseek-ai dependencies. Preference order:
#   1. `dsh plugin --profile web add` (official pnpm forwarder)
#   2. copy into <profile>/node_modules/<name>
#   3. copy into the shared <dsh home>/profiles/node_modules/<name>
# Symlinks are no longer used: Node resolves modules from the link target's
# realpath, which cannot see the profile's hoisted dependencies. Finally the
# loader entry is registered in the profile's cordis.patch.yml.
set -eu

NAME="dsh-client-ui-cpa-quota"
PROFILE="web"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PLUGIN_DIR="$DSH_HOME/plugins/$NAME"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PROFILE_LINK="$PROFILE_DIR/node_modules/$NAME"
LEGACY_LINK="$DSH_HOME/profiles/node_modules/$NAME"
PATCH="$PROFILE_DIR/cordis.patch.yml"
REPO="${REPO:-https://github.com/wkscc310/dsh-client-ui-cpa-quota}"

say() { printf '[install] %s\n' "$1"; }

# REPO ends up as command arguments (git/curl/wget); reject anything that is
# not a plain http(s) URL before it is ever interpolated.
case "$REPO" in
    https://*|http://*) ;;
    *) printf '[install] REPO must be an http(s) URL, got: %s\n' "$REPO" >&2; exit 1 ;;
esac

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

# Replace whatever sits at the destination (old copy or symlink) with a fresh
# copy of the plugin. Only ever called on our own package's path.
place_copy() {
    destination_dir=$1
    if [ -L "$destination_dir" ] || [ -d "$destination_dir" ]; then
        rm -rf "$destination_dir"
    fi
    mkdir -p "$(dirname -- "$destination_dir")"
    copy_contents "$PLUGIN_DIR" "$destination_dir"
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

# 2. Materialize the package where the dsh loader can resolve it.
installed=""
if command -v dsh >/dev/null 2>&1; then
    native_path=$PLUGIN_DIR
    # Git Bash / MSYS: hand pnpm a Windows path, not a /c/... translation.
    if command -v cygpath >/dev/null 2>&1; then
        native_path=$(cygpath -w "$PLUGIN_DIR")
    fi
    if dsh plugin --profile "$PROFILE" add "$native_path"; then
        installed="dsh"
        say "installed into the $PROFILE profile via dsh plugin add"
    else
        say "dsh plugin add failed — falling back to a direct copy"
    fi
else
    say "dsh CLI not found on PATH — falling back to a direct copy"
fi

if [ -z "$installed" ]; then
    if place_copy "$PROFILE_LINK" 2>/dev/null; then
        installed="profile"
        say "copied plugin: $PROFILE_LINK"
    elif place_copy "$LEGACY_LINK"; then
        installed="shared"
        say "copied plugin: $LEGACY_LINK"
    else
        say "unable to write the plugin into any profile node_modules"
        exit 1
    fi
fi

# A pre-existing symlinked install cannot resolve the node half's imports
# (Node walks the link target's realpath), so retire it when present.
if [ -L "$LEGACY_LINK" ] && [ "$installed" != "shared" ]; then
    rm "$LEGACY_LINK"
    say "removed legacy symlink: $LEGACY_LINK"
fi

# 3. Loader activation. The package declares a `dsh.bundle` manifest, so a
#    successful `dsh plugin add` already joined the profile's bundle layers —
#    a manual patch entry would insert the plugin twice. Migrate any entry a
#    previous installer version wrote (our exact generated block is dropped;
#    a hand-customized one is left alone with a warning). The copy fallback
#    path still needs the manual entry, because nothing reconciled the
#    bundle layer in that mode.
if [ "$installed" = "dsh" ] && grep -q '"bundle"[[:space:]]*:' "$PLUGIN_DIR/package.json"; then
    if [ -f "$PATCH" ]; then
        tmp=$(mktemp "${TMPDIR:-/tmp}/$NAME-patch.XXXXXX")
        status=0
        awk -v name="$NAME" '
            { line[NR] = $0 }
            END {
                dropped = 0; custom = 0; i = 1
                while (i <= NR) {
                    if (line[i] ~ /^[[:space:]]*- insert:[[:space:]]*$/ &&
                        line[i+1] ~ /^[[:space:]]*- id: ui-cpa-quota[[:space:]]*$/ &&
                        line[i+2] ~ ("^[[:space:]]*name: [\"'\'']?" name "[\"'\'']?[[:space:]]*$")) {
                        boundary = (i + 3 > NR) || (line[i+3] == "") || (line[i+3] ~ /^[[:space:]]*(#|- )/)
                        if (boundary) { dropped++; i += 3; continue }
                        custom++
                    }
                    print line[i]; i += 1
                }
                exit (dropped > 0 ? 0 : (custom > 0 ? 3 : 1))
            }' "$PATCH" > "$tmp" || status=$?
        mv "$tmp" "$PATCH"
        # A comments-only remainder parses as null, which the profile loader
        # rejects ("must be a top-level YAML array") — keep it a valid empty list.
        if ! grep -v '^[[:space:]]*#' "$PATCH" | grep -v '^[[:space:]]*$' | grep -q .; then
            printf '\n[]\n' >> "$PATCH"
        fi
    else
        status=1
    fi
    case $status in
        0) say "bundle active via dsh plugin add — legacy manual patch entry removed from $PATCH" ;;
        3) say "WARNING: $PATCH keeps a hand-customized ui-cpa-quota entry; the bundle layer now activates the plugin too — remove the manual entry to avoid double activation" ;;
        *) say "bundle active via dsh plugin add — no manual patch entry needed" ;;
    esac
else
    if [ "$installed" != "dsh" ]; then
        mkdir -p "$(dirname -- "$PATCH")"
        touch "$PATCH"
    fi
    if grep -q "name: ['\"]\?$NAME" "$PATCH" 2>/dev/null; then
        say "patch entry already present in $PATCH"
    elif [ -f "$PATCH" ] && grep -v '^[[:space:]]*#' "$PATCH" | grep -v '^[[:space:]]*$' | grep -q '^\[\][[:space:]]*$'; then
        tmp=$(mktemp "${TMPDIR:-/tmp}/$NAME-patch.XXXXXX")
        awk -v name="$NAME" '!done && $0 ~ /^\[\][[:space:]]*$/ { printf "- insert:\n    - id: ui-cpa-quota\n      name: %s\n", name; done=1; next } { print }' "$PATCH" > "$tmp"
        mv "$tmp" "$PATCH"
        say "patch entry written into $PATCH (replaced the placeholder [])"
    else
        [ -f "$PATCH" ] || touch "$PATCH"
        printf '\n- insert:\n    - id: ui-cpa-quota\n      name: %s\n' "$NAME" >> "$PATCH"
        say "patch entry appended to $PATCH"
    fi
fi

say "done. Restart the DSH web host, then paste your management key in"
say "Settings -> Plugins -> CliProxyAPI Quota."
