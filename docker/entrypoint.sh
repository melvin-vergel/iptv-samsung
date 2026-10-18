#!/bin/bash

set -o errexit
set -o nounset
set -o pipefail

IFS=$'\n\t'

function is_bound {
    if [[ ! -d "$1" ]]; then
        echo "Not dir" >&2
        return 1
    fi
    # mounted volumes live on a different device than the container root
    if [[ "$(stat --format=%d /)" = "$(stat --format=%d "$1")" ]]; then
        echo "same device" >&2
        return 1
    fi
    return 0
}

if ! is_bound "/cert"; then
    echo "Error: /cert directory must be mounted as a volume" >&2
    echo "Usage: docker run -v /path/to/cert:/cert ..." >&2
    exit 1
fi

if [[ ! -f /src/config.xml ]]; then
    echo "Error: /src must contain the app source (config.xml missing)" >&2
    exit 1
fi

mkdir -p /build

# Infer host UID/GID from the owner of the /cert volume so generated
# certificate files are owned by the host user.
PUID="${PUID:-$(stat --format=%u /cert)}"
PGID="${PGID:-$(stat --format=%g /cert)}"

echo "launch build with PUID=$PUID PGID=$PGID"

userdel builder 2>/dev/null || true
groupdel builder 2>/dev/null || true
# GID may already exist in the image (e.g. host staff group = 20 on macOS,
# or GID 0 for a root-owned volume) — reuse it.
groupadd --gid "$PGID" builder 2>/dev/null || true
if [[ "$PUID" != "0" ]]; then
    useradd --uid "$PUID" --gid "$PGID" --home-dir /build --no-create-home --shell /bin/bash builder
fi
chown -R "${PUID}:${PGID}" /cert /build

# Root-owned volumes (UID 0) can't be assumed by a "builder" user — run
# the build directly as root in that case.
if [[ "$PUID" == "0" ]]; then
    exec tini -- /run.sh
fi
exec tini -- sudo -H -E -u builder /run.sh
