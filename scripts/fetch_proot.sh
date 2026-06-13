#!/usr/bin/env bash
# =============================================================================
# fetch_proot.sh
#
# Downloads pre-compiled PRoot static binaries from SourceForge and copies
# them into android/app/src/main/assets/ so they are bundled into the APK
# and can be extracted on first launch.
#
# Also optionally downloads the Alpine miniRootfs tarball so the APK works
# fully offline (no download needed on first launch).
#
# Run this once before building locally OR let the CI workflow do it.
#
# Usage:
#   chmod +x scripts/fetch_proot.sh
#   ./scripts/fetch_proot.sh
#   ./scripts/fetch_proot.sh --skip-alpine   # skip the 3 MB rootfs download
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; RESET='\033[0m'

info()    { echo -e "${CYAN}>>>${RESET} $*"; }
success() { echo -e "${GREEN}[ok]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET} $*"; }
error()   { echo -e "${RED}[error]${RESET} $*" >&2; exit 1; }

# ── Args ──────────────────────────────────────────────────────────────────────
SKIP_ALPINE=false
for arg in "$@"; do
    [[ "$arg" == "--skip-alpine" ]] && SKIP_ALPINE=true
done

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}"
# Allow running from scripts/ subdirectory too
[[ -d "${ROOT_DIR}/scripts" ]] && ROOT_DIR="${ROOT_DIR}"
ASSETS_DIR="${ROOT_DIR}/android/app/src/main/assets"

mkdir -p "${ASSETS_DIR}"

# ── PRoot download sources ────────────────────────────────────────────────────
# We download the proot binary from the official Termux package repository.
# Termux packages proot for Android/bionic, which is what we need.
# The binary is extracted from the .deb archive.
PROOT_VERSION="5.1.107.78-1"
DEB_BASE="https://packages.termux.dev/apt/termux-main/pool/main/p/proot"

declare -A ABI_MAP=(
    ["arm64-v8a"]="aarch64"
    ["x86_64"]="x86_64"
)

info "Downloading PRoot ${PROOT_VERSION} from Termux package repository…"
for abi in "${!ABI_MAP[@]}"; do
    arch="${ABI_MAP[$abi]}"
    deb_file="proot_${PROOT_VERSION}_${arch}.deb"
    url="${DEB_BASE}/${deb_file}"
    dest="${ASSETS_DIR}/proot-${abi}"

    if [[ -f "${dest}" ]]; then
        warn "  ${dest} already exists — skipping (delete to re-download)"
        continue
    fi

    info "  Fetching ${deb_file}…"
    tmpdir=$(mktemp -d)
    pushd "${tmpdir}" >/dev/null

    if command -v curl >/dev/null 2>&1; then
        curl -fsSL --retry 3 --retry-delay 2 "${url}" -o "${deb_file}"
    elif command -v wget >/dev/null 2>&1; then
        wget -q --tries=3 "${url}" -O "${deb_file}"
    else
        error "Neither curl nor wget is available. Install one and retry."
    fi

    # Extract proot binary from the .deb package
    if command -v dpkg-deb >/dev/null 2>&1; then
        dpkg-deb --fsys-tarfile "${deb_file}" | tar -xO ./data/data/com.termux/files/usr/bin/proot > "${dest}"
    elif command -v ar >/dev/null 2>&1; then
        ar x "${deb_file}"
        tar -xJf data.tar.xz ./data/data/com.termux/files/usr/bin/proot -O > "${dest}"
    else
        error "Neither dpkg-deb nor ar is available. Install binutils and retry."
    fi

    popd >/dev/null
    rm -rf "${tmpdir}"

    chmod +x "${dest}"
    size=$(du -h "${dest}" | cut -f1)
    success "  proot-${abi} → ${dest} (${size})"
done

# ── Alpine miniRootfs ─────────────────────────────────────────────────────────
ALPINE_VERSION="3.19.1"
ALPINE_DEST="${ASSETS_DIR}/alpine-minirootfs.tar.gz"

if [[ "${SKIP_ALPINE}" == "true" ]]; then
    warn "Skipping Alpine miniRootfs download (--skip-alpine passed)."
    warn "  The app will download it on first launch — device needs internet access."
else
    if [[ -f "${ALPINE_DEST}" ]]; then
        warn "  ${ALPINE_DEST} already exists — skipping (delete to re-download)"
    else
        ALPINE_URL="https://dl-cdn.alpinelinux.org/alpine/v${ALPINE_VERSION%.*}/releases/aarch64/alpine-minirootfs-${ALPINE_VERSION}-aarch64.tar.gz"
        info "Downloading Alpine ${ALPINE_VERSION} miniRootfs (ARM64)…"
        info "  URL: ${ALPINE_URL}"

        if command -v curl >/dev/null 2>&1; then
            curl -fsSL --retry 3 --retry-delay 2 --progress-bar "${ALPINE_URL}" \
                -o "${ALPINE_DEST}"
        else
            wget -q --show-progress --tries=3 "${ALPINE_URL}" -O "${ALPINE_DEST}"
        fi

        size=$(du -h "${ALPINE_DEST}" | cut -f1)
        success "  Alpine rootfs → ${ALPINE_DEST} (${size})"
    fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
success "Assets directory contents:"
ls -lh "${ASSETS_DIR}/"

echo ""
info "You can now build the APK:"
echo "  cd android && ./gradlew assembleDebug"
echo ""
info "Or run on a connected device:"
echo "  npx react-native run-android"
