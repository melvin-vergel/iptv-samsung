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

userdel builder 2>/dev/null || true
groupdel builder 2>/dev/null || true
groupadd --gid "$PGID" builder
useradd --uid "$PUID" --gid "$PGID" --home-dir /build --no-create-home --shell /bin/bash builder
chown -R "${PUID}:${PGID}" /cert /build

echo "launch build with PUID=$PUID PGID=$PGID"
exec tini -- sudo -H -E -u builder /run.sh
