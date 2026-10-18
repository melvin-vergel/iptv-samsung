#!/bin/bash
# Rebuild the self-contained TV-installer image (amd64 — the Tizen Studio CLI
# only ships x86_64) and push it to Docker Hub. Run this on the Mac whenever
# app source (config.xml / index.html / css / js) changes, then just rerun
# ./install-tv-samsung on the VM.
#
#   ./build-and-push-installer.sh

set -e
cd "$(dirname "$0")"

IMAGE="${IMAGE:-melvinvergel/iptv-tizen-installer:latest}"
SERVER_URL="${SERVER_URL:-http://192.168.100.118:8080}"

if ! docker info >/dev/null 2>&1; then
    echo "error: Docker is not running. Start Docker Desktop and retry." >&2
    exit 1
fi

echo "Building $IMAGE (linux/amd64) for SERVER_URL=$SERVER_URL ..."
docker build --platform linux/amd64 --build-arg SERVER_URL="$SERVER_URL" -f installer.Dockerfile -t "$IMAGE" .

echo "Pushing $IMAGE ..."
docker push "$IMAGE"

echo "Done. On the VM: ./install-tv-samsung"
