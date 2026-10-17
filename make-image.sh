#!/bin/bash
# Build the playlist-server image and export it as a tar for your docker
# server. On the server you only need: docker-compose.yml + this tar.
#
#   ./make-image.sh
#   scp iptv-playlist-server.tar playlist-server/docker-compose.yml user@server:/opt/iptv/
#   ssh user@server
#     cd /opt/iptv && docker load -i iptv-playlist-server.tar && docker compose up -d
#
# Or push to a registry (GHCR/Docker Hub) and use `image:` pull instead.

set -e
cd "$(dirname "$0")"

if ! docker info >/dev/null 2>&1; then
    echo "error: Docker is not running. Start Docker Desktop and retry." >&2
    exit 1
fi

echo "Building iptv-playlist-server:latest ..."
docker build -t iptv-playlist-server:latest playlist-server/

echo "Exporting iptv-playlist-server.tar ..."
docker save -o iptv-playlist-server.tar iptv-playlist-server:latest
ls -lh iptv-playlist-server.tar
echo "Done. Ship the tar + playlist-server/docker-compose.yml to your server."
