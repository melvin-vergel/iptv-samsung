# Self-contained TV installer image: same as docker/Dockerfile but the app
# source is baked in, so you can run it from any Docker host (your VM) with
# just:  docker run -v ./cert:/cert -v ./build:/build -e ... melvinvergel/...
#
# Build + push from the Mac with ./build-and-push-installer.sh
# (must be linux/amd64: the Tizen Studio CLI only exists for x86_64)

FROM debian:13-slim AS runtime

LABEL org.opencontainers.image.source=https://github.com/melvin-vergel/iptv-samsung

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

COPY --chmod=0755 docker/entrypoint.sh /entrypoint.sh
COPY --chmod=0755 docker/run.sh /run.sh
COPY --chmod=0755 docker/entrypoint-selfcontained.sh /entrypoint-selfcontained.sh

# App source baked into the image (override by mounting your own /src if you want)
COPY config.xml index.html icon.png /src/
COPY css /src/css
COPY js /src/js

WORKDIR /src

CMD ["/entrypoint-selfcontained.sh"]
