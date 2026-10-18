#!/bin/bash

# One-command installer: builds (if needed) and runs the Docker-based
# Tizen packager/installer for the IPTV app.
#
#   cp .env.default .env   # then edit: cert password + TV IP
#   ./install.sh

set -o errexit
set -o nounset
set -o pipefail

IFS=$'\n\t'

__DIR__="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

function error() {
    echo -e "\033[31merror:\033[m ${*}" >&2
}

if [[ ! -f "${__DIR__}/.env" ]]; then
    error ".env is missing. Run: cp .env.default .env and edit it (CERT_PASSWORD + TIZEN_TV_IP)."
    exit 1
fi

# shellcheck disable=SC1091
set +e
source "${__DIR__}/.env"
set -e

for var in CERT_ALIAS CERT_COUNTRY CERT_NAME CERT_PASSWORD TIZEN_TV_IP; do
    if [[ -z "${!var:-}" ]]; then
        error "$var is missing, check ${__DIR__}/.env"
        exit 1
    fi
done

if ! docker info >/dev/null 2>&1; then
    error "Docker daemon is not running. Start Docker Desktop and retry."
    exit 1
fi

DOCKER_IMAGE_NAME="${DOCKER_IMAGE_NAME:-iptv-tizen-installer}"

echo "Building installer image..."
docker build --platform linux/amd64 --tag "${DOCKER_IMAGE_NAME}:latest" "${__DIR__}/docker"

mkdir -p "${__DIR__}/cert" "${__DIR__}/build"

echo "Running installer (first run downloads Tizen Studio ~1.8GB, later runs reuse the cache)..."
# shellcheck disable=SC2086
docker run --rm -it \
    -e PUID="$(id -u)" \
    -e PGID="$(id -g)" \
    -e CERT_ALIAS="${CERT_ALIAS}" \
    -e CERT_COUNTRY="${CERT_COUNTRY}" \
    -e CERT_NAME="${CERT_NAME}" \
    -e CERT_PASSWORD="${CERT_PASSWORD}" \
    -e TIZEN_TV_IP="${TIZEN_TV_IP}" \
    -e APP_ID="${APP_ID:-IPTVa1b2c3.IPTV}" \
    -e WGT_NAME="${WGT_NAME:-IPTV.wgt}" \
    -e TIZEN_STUDIO_VERSION="${TIZEN_STUDIO_VERSION:-5.6}" \
    -v "${__DIR__}/cert:/cert" \
    -v "${__DIR__}/build:/build" \
    -v "${__DIR__}:/src:ro" \
    "${DOCKER_IMAGE_NAME}:latest"
