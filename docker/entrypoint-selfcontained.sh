#!/bin/bash

# Entrypoint for the SELF-CONTAINED installer image (installer.Dockerfile).
# Instead of relying on a mounted /src, this clones the app source from GitHub
# at runtime so testing from the VM always uses the latest committed code.
# If /src IS mounted (e.g. for local development), that source is used instead.

set -o errexit
set -o nounset
set -o pipefail

IFS=$'\n\t'

SOURCE_REPO="${SOURCE_REPO:-https://github.com/melvin-vergel/iptv-samsung.git}"
SOURCE_BRANCH="${SOURCE_BRANCH:-main}"

function is_bound {
    if [[ ! -d "$1" ]]; then return 1; fi
    if [[ "$(stat --format=%d /)" = "$(stat --format=%d "$1")" ]]; then return 1; fi
    return 0
}

mkdir -p /build

if is_bound /src; then
    echo "Using mounted /src (development mode)"
else
    echo "Cloning $SOURCE_REPO ($SOURCE_BRANCH) ..."
    rm -rf /src/* /src/.* 2>/dev/null || true
    git clone --depth 1 --branch "$SOURCE_BRANCH" "$SOURCE_REPO" /tmp/iptv-src
    cp -a /tmp/iptv-src/. /src/
    rm -rf /tmp/iptv-src
fi

exec /entrypoint.sh
