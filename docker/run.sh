#!/bin/bash

# Downloads + installs the Tizen Studio CLI, creates/reuses the signing
# certificate, packages the app as a .wgt and installs it on the TV.
#
# Adapted from jellyfin-tizen-installer (GPL-3.0) by ldotlopez /
# babagreensheep for this IPTV project.

set -o errexit
set -o nounset
set -o pipefail

if [[ "${TRACE-0}" == "1" ]]; then
    set -o xtrace
fi

IFS=$'\n\t'

TIZEN_STUDIO_VERSION="${TIZEN_STUDIO_VERSION:-5.6}"
TIZEN_STUDIO_URL="https://download.tizen.org/sdk/Installer/tizen-studio_${TIZEN_STUDIO_VERSION}/web-cli_Tizen_Studio_${TIZEN_STUDIO_VERSION}_ubuntu-64.bin"
APP_ID="${APP_ID:-IPTVa1b2c3.IPTV}"
WGT_NAME="${WGT_NAME:-IPTV.wgt}"

for var in TIZEN_TV_IP CERT_NAME CERT_ALIAS CERT_COUNTRY CERT_PASSWORD; do
    if [[ -z "${!var:-}" ]]; then
        echo "Error: $var environment variable is required" >&2
        exit 1
    fi
done

#
# Download and install Tizen Studio CLI (cached in /build volume; installed
# at runtime to avoid redistributing Samsung's software)
#
TIZEN_STUDIO_INSTALL_DIR="/build/tizen-studio"
if [[ ! -f "/build/tizen-studio.bin" ]]; then
    echo "Downloading Tizen Studio CLI ${TIZEN_STUDIO_VERSION} (~1.8GB, first run only)..."
    curl --fail --location --output "/build/tizen-studio.bin.tmp" "$TIZEN_STUDIO_URL"
    mv "/build/tizen-studio.bin.tmp" "/build/tizen-studio.bin"
fi

chmod +x "/build/tizen-studio.bin"

if [[ ! -x "${TIZEN_STUDIO_INSTALL_DIR}/tools/ide/bin/tizen" ]]; then
    echo "Installing Tizen Studio CLI to ${TIZEN_STUDIO_INSTALL_DIR} (first run only)..."
    "/build/tizen-studio.bin" \
        --accept-license \
        "$TIZEN_STUDIO_INSTALL_DIR"
fi
PATH="${PATH}:${TIZEN_STUDIO_INSTALL_DIR}/tools/ide/bin:${TIZEN_STUDIO_INSTALL_DIR}/tools"

#
# Create the signing certificate once and keep it in /cert. Reinstalling with
# a DIFFERENT certificate would require uninstalling the old app from the TV.
#
if [[ ! -f "/cert/${CERT_NAME}.p12" ]]; then
    echo "Creating new signing certificate '${CERT_NAME}'..."
    tizen \
        certificate \
        --alias "${CERT_ALIAS}" \
        --password "${CERT_PASSWORD}" \
        --country "${CERT_COUNTRY}" \
        --city "${CERT_COUNTRY}" \
        --name "${CERT_NAME}" \
        --filename "${CERT_NAME}"
    cp "/build/tizen-studio-data/keystore/author/${CERT_NAME}.p12" "/cert/${CERT_NAME}.p12"
else
    echo "Reusing existing certificate /cert/${CERT_NAME}.p12"
fi

tizen \
    security-profiles add \
    --name "${CERT_NAME}" \
    --author "/cert/${CERT_NAME}.p12" \
    --password "${CERT_PASSWORD}"

# Patch the profile so the CLI can package non-interactively:
# drop the (nonexistent) author-password file reference and use the known
# Samsung default distributor certificate password.
sed -i "s|/cert/${CERT_NAME}.pwd||g" /build/tizen-studio-data/profile/profiles.xml
sed -i "s|/build/tizen-studio-data/tools/certificate-generator/certificates/distributor/tizen-distributor-signer.pwd|tizenpkcs12passfordsigner|" /build/tizen-studio-data/profile/profiles.xml

#
# Build and package the .wgt. Stage only the app files out of /src first so
# the ./build cache and other repo content never end up inside the package.
#
echo "Building web package from app source..."
STAGE_DIR=/build/app-stage
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
cp /src/config.xml /src/index.html /src/icon.png "$STAGE_DIR/"
cp -R /src/css /src/js "$STAGE_DIR/"
if [[ -d /src/www ]]; then cp -R /src/www "$STAGE_DIR/"; fi
tizen build-web --output /build/build-web -- "$STAGE_DIR"

cat >/build/tizen-package-wrapper.sh <<EOF
#!/usr/bin/expect -f
set timeout -1
spawn tizen package --type wgt --output /build/package -- /build/build-web
expect "Author password: "
send -- "$CERT_PASSWORD\r"
expect "Yes: (Y), No: (N) ?"
send -- "Y\r"
expect eof
EOF
chmod +x /build/tizen-package-wrapper.sh
/build/tizen-package-wrapper.sh

#
# Install on the TV over the network (TV must be in Developer Mode with
# this Docker host's IP allowed)
#
if ! sdb connect "$TIZEN_TV_IP"; then
    echo "Error: Could not connect to $TIZEN_TV_IP" >&2
    echo "Check: TV powered on, Developer Mode enabled, correct IPs, same network." >&2
    exit 1
fi

DEVICE_ID="$(sdb devices | grep "^${TIZEN_TV_IP}:" | awk '{print $3}')"
if [[ -z "$DEVICE_ID" ]]; then
    echo "Error: Could not find device ID for $TIZEN_TV_IP" >&2
    echo "Available devices:" >&2
    sdb devices >&2
    exit 1
fi

echo "Installing ${WGT_NAME} on device ${DEVICE_ID}..."
tizen install --name "${WGT_NAME}" --target "${DEVICE_ID}" -- /build/package

# Launch the app immediately (non-fatal if this step fails)
sdb -t "$DEVICE_ID" shell 0 launch "$APP_ID" 2>/dev/null \
    || echo "Installed. Launch it manually from the TV's Apps row ('IPTV')."

echo "Done."
