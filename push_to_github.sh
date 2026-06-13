#!/usr/bin/env bash
# =============================================================================
# push_to_github.sh
#
# Sets up this project as a Git repository and pushes it to GitHub so
# the Actions workflow immediately kicks off and builds the APK.
#
# Usage:
#   chmod +x push_to_github.sh
#   ./push_to_github.sh                          # interactive
#   GITHUB_REPO=username/my-repo ./push_to_github.sh   # non-interactive
#
# Prerequisites:
#   • git  (brew install git / apt install git)
#   • gh   (brew install gh / see https://cli.github.com)
#   • An authenticated GitHub session:  gh auth login
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[info]${RESET}  $*"; }
success() { echo -e "${GREEN}[ok]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET}  $*"; }
error()   { echo -e "${RED}[error]${RESET} $*" >&2; exit 1; }

# ── Dependency checks ─────────────────────────────────────────────────────────
command -v git >/dev/null 2>&1 || error "git is not installed."
command -v gh  >/dev/null 2>&1 || error "GitHub CLI (gh) is not installed. See https://cli.github.com"

# ── Authentication check ──────────────────────────────────────────────────────
if ! gh auth status >/dev/null 2>&1; then
    warn "Not logged in to GitHub CLI."
    info "Running: gh auth login"
    gh auth login
fi

GH_USER=$(gh api user --jq '.login')
info "Authenticated as: ${BOLD}${GH_USER}${RESET}"

# ── Repo name ─────────────────────────────────────────────────────────────────
if [[ -z "${GITHUB_REPO:-}" ]]; then
    echo ""
    echo -e "${BOLD}Enter the GitHub repository (format: username/repo-name)${RESET}"
    echo "  • To create a NEW repo: just type a name, e.g. ${GH_USER}/alpine-shell"
    echo "  • To push to EXISTING: type the existing repo slug"
    read -rp "Repository: " GITHUB_REPO
fi

REPO_NAME="${GITHUB_REPO##*/}"
REPO_OWNER="${GITHUB_REPO%%/*}"

# ── Visibility ────────────────────────────────────────────────────────────────
if [[ -z "${REPO_VISIBILITY:-}" ]]; then
    echo ""
    echo -e "${BOLD}Repository visibility:${RESET}"
    select VIS in "public" "private"; do
        REPO_VISIBILITY="$VIS"
        break
    done
fi

# ── Create repo if it doesn't exist ──────────────────────────────────────────
if ! gh repo view "${GITHUB_REPO}" >/dev/null 2>&1; then
    info "Creating ${REPO_VISIBILITY} repository: ${GITHUB_REPO}"
    gh repo create "${GITHUB_REPO}" \
        "--${REPO_VISIBILITY}" \
        --description "Alpine Linux running on Android via PRoot — no root required" \
        --homepage ""
    success "Repository created: https://github.com/${GITHUB_REPO}"
else
    info "Repository already exists: https://github.com/${GITHUB_REPO}"
fi

# ── Git init ──────────────────────────────────────────────────────────────────
cd "$(dirname "$0")"

if [[ ! -d .git ]]; then
    info "Initialising git repository…"
    git init -b main
fi

# ── .gitignore ────────────────────────────────────────────────────────────────
cat > .gitignore << 'GITIGNORE'
# Node
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# React Native
.expo/
.expo-shared/
*.jks
*.keystore
!android/app/debug.keystore

# Android build outputs
android/app/build/
android/build/
android/.gradle/
*.apk
*.aab

# IDE
.idea/
.vscode/
*.iml
.DS_Store

# Bundle
android/app/src/main/assets/index.android.bundle
android/app/src/main/assets/index.android.bundle.map

# Large binary assets (fetched by CI)
android/app/src/main/assets/proot-*
android/app/src/main/assets/alpine-minirootfs.tar.gz
GITIGNORE

# ── Stage + commit ────────────────────────────────────────────────────────────
info "Staging files…"
git add -A

if git diff --cached --quiet; then
    info "Nothing new to commit."
else
    git commit -m "chore: initial Alpine Shell project

- React Native 0.73 bare workflow (Android only)
- PRoot-based Alpine Linux environment (no root required)
- Foreground service with WakeLock + BootReceiver
- ANSI terminal UI with modifier key toolbar
- GitHub Actions CI: fetches proot + Alpine rootfs, builds APK"
    success "Committed initial project."
fi

# ── Remote ────────────────────────────────────────────────────────────────────
REMOTE_URL="https://github.com/${GITHUB_REPO}.git"

if git remote get-url origin >/dev/null 2>&1; then
    info "Remote 'origin' already set — updating to ${REMOTE_URL}"
    git remote set-url origin "${REMOTE_URL}"
else
    info "Adding remote origin: ${REMOTE_URL}"
    git remote add origin "${REMOTE_URL}"
fi

# ── Push ──────────────────────────────────────────────────────────────────────
info "Pushing to GitHub…"
git push -u origin main

success "Push complete!"
echo ""
echo -e "${BOLD}Next steps:${RESET}"
echo -e "  1. GitHub Actions is now building your APK:"
echo -e "     ${CYAN}https://github.com/${GITHUB_REPO}/actions${RESET}"
echo ""
echo -e "  2. The debug APK will appear as a build artifact once the workflow finishes."
echo ""
echo -e "  3. For a ${BOLD}signed release APK${RESET}, add these secrets to your repo:"
echo -e "     ${YELLOW}KEYSTORE_FILE_PATH${RESET}     path to your .jks inside the runner"
echo -e "     ${YELLOW}KEYSTORE_PASSWORD${RESET}"
echo -e "     ${YELLOW}KEY_ALIAS${RESET}"
echo -e "     ${YELLOW}KEY_PASSWORD${RESET}"
echo -e "     Then create a git tag:  git tag v1.0.0 && git push origin v1.0.0"
echo ""
echo -e "  4. If the CI fails on the PRoot download step, see scripts/fetch_proot.sh"
echo -e "     to fetch the binaries locally for bundling."
