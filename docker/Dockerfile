# One-command Docker installer for the IPTV app (same approach as
# jellyfin-tizen-installer, adapted for this project).
#
# The Tizen Studio SDK (~2GB) is downloaded at RUNTIME (respecting Samsung's
# licensing) and cached in ./build/. Your signing certificate is stored in
# ./cert/ and reused, so you can reinstall/update without uninstalling.

FROM debian:13-slim AS runtime

LABEL org.opencontainers.image.source=https://github.com/melvinvergel/samsung-iptv

# Packages needed by the Tizen Studio CLI at runtime
ENV DEBIAN_FRONTEND=noninteractive
RUN \
    apt-get update && \
    apt-get install --no-install-recommends -y \
        curl \
        default-jre \
        expect \
        sudo \
        tini && \
    rm -rf \
        /var/cache/apt/*.bin \
        /var/cache/apt/archives/*.deb \
        /var/lib/apt/lists/*

COPY --chmod=0755 entrypoint.sh /entrypoint.sh
COPY --chmod=0755 run.sh /run.sh

# App source is mounted here at runtime (see install.sh)
WORKDIR /src

CMD ["/entrypoint.sh"]
