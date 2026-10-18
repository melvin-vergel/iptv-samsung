#!/bin/bash
# Build the playlist-server image for linux/amd64 + linux/arm64 and push it to
# Docker Hub, so `docker compose pull` works on any server architecture.
#
#   ./make-image.sh
#
# On the server (no source files needed):
#   docker compose pull && docker compose up -d
#
# Optional: EXPORT_TAR=1 ./make-image.sh also writes a single-arch tar
# (docker save can't export multi-arch images) for air-gapped servers.


set -e
cd "$(dirname "$0")"

IMAGE="${IMAGE:-docker.io/melvinvergel/iptv-playlist-server:latest}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

if ! docker info >/dev/null 2>&1; then
    echo "error: Docker is not running. Start Docker Desktop and retry." >&2
    exit 1
fi

# Multi-arch images cannot be exported with `docker save` (tar is single-arch),
# so the registry push is the way to ship amd64 + arm64 together.
echo "Building $IMAGE for $PLATFORMS and pushing ..."
docker buildx create --name multiarch --driver docker-container --use 2>/dev/null || docker buildx use multiarch
docker buildx inspect --bootstrap multiarch >/dev/null
docker buildx build --builder multiarch --platform "$PLATFORMS" --tag "$IMAGE" --push playlist-server/

# Optional single-arch tar (target arch = PLATFORMS' first entry, or native):
if [ "${EXPORT_TAR:-0}" = "1" ]; then
    echo "Exporting iptv-playlist-server.tar (single-arch, native platform) ..."
    docker buildx build --load --tag iptv-playlist-server:latest playlist-server/
    docker save -o iptv-playlist-server.tar iptv-playlist-server:latest
    ls -lh iptv-playlist-server.tar
fi

echo "Done. On the server: docker compose pull && docker compose up -d"
