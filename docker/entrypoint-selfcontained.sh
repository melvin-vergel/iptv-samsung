#!/bin/bash

# Entrypoint for the SELF-CONTAINED installer image (installer.Dockerfile):
# the app source already lives in /src inside the image, so unlike the
# repo-based flow nothing must be mounted there — only /cert and /build.

set -o errexit
set -o nounset
set -o pipefail

IFS=$'\n\t'

if [[ ! -d /src ]]; then
    echo "Error: image is broken, /src (baked-in app source) is missing" >&2
    exit 1
fi

# /build must be a real mounted dir so the Tizen Studio download (~1.8GB)
# and package output land on the host and are reused next run.
mkdir -p /build

exec /entrypoint.sh
