# Multi-stage: compile a static Go binary, ship it in a scratch image.
# The build stage always runs natively (TARGETPLATFORM is passed via buildx)
# and Go cross-compiles, so no QEMU emulation is needed.
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS build
ARG TARGETOS TARGETARCH
RUN apk add --no-cache ca-certificates
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags="-s -w" -o /server .

FROM scratch
# TLS roots (so future https upstreams work) + CA certs for Alpine-built Go
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /server /server

ENV PORT=8080
EXPOSE 8080
USER 65534:65534
WORKDIR /data

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s \
    CMD ["/server", "-healthcheck"]

ENTRYPOINT ["/server"]
