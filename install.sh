#!/bin/sh
# Installs CURI on macOS or Linux from the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/kaizensx/curi/main/install.sh | sh
#
# Every download is checked against the release's SHA256SUMS before anything is installed.
# Options (environment variables):
#   CURI_VERSION=3.7.0   install that version instead of the latest
#   CURI_FROM=<dir|url>  install from a folder or URL that holds the release files and SHA256SUMS
set -eu

REPO="kaizensx/curi"
say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'CURI installer: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "this needs '$1', which isn't installed."; }

need curl
os="$(uname -s)"
arch="$(uname -m)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

# ---------- where the files come from ----------
if [ -n "${CURI_FROM:-}" ]; then
  base="${CURI_FROM%/}"
elif [ -n "${CURI_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/v${CURI_VERSION#v}"
else
  tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$tag" ] || die "couldn't find the latest release on GitHub."
  base="https://github.com/$REPO/releases/download/$tag"
fi

fetch() { # fetch <file> <dest>
  case "$base" in
    http://*|https://*) curl -fL --progress-bar "$base/$1" -o "$2" ;;
    *) cp "$base/$1" "$2" ;;
  esac
}

fetch SHA256SUMS "$tmp/SHA256SUMS" || die "couldn't download SHA256SUMS."

# pick <pattern>: the file in this release whose name matches
pick() { awk '{print $2}' "$tmp/SHA256SUMS" | sed 's/^\*//' | grep -E "$1" | head -n 1; }

verify() { # verify <file>
  want="$(grep -E "[ *]$1\$" "$tmp/SHA256SUMS" | awk '{print $1}')"
  if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$tmp/$1" | awk '{print $1}')"
  else got="$(shasum -a 256 "$tmp/$1" | awk '{print $1}')"; fi
  [ -n "$want" ] && [ "$want" = "$got" ] || die "checksum mismatch for $1; nothing was installed."
}

download() { # download <file>
  say "Downloading $1"
  fetch "$1" "$tmp/$1" || die "couldn't download $1."
  verify "$1"
}

# ---------- macOS ----------
install_macos() {
  file="$(pick '_universal\.dmg$')"
  [ -n "$file" ] || file="$(pick '\.dmg$')"
  [ -n "$file" ] || die "this release has no macOS build."
  download "$file"
  dest="/Applications"
  [ -w "$dest" ] || dest="$HOME/Applications"
  mkdir -p "$dest"
  mnt="$tmp/mnt"
  hdiutil attach -nobrowse -quiet -mountpoint "$mnt" "$tmp/$file" || die "couldn't open the disk image."
  # Quit a running copy so the new one replaces it cleanly.
  pkill -f "CURI.app/Contents/MacOS/curi-desktop" 2>/dev/null || true
  rm -rf "$dest/CURI.app"
  cp -R "$mnt/CURI.app" "$dest/" || { hdiutil detach -quiet "$mnt"; die "couldn't copy CURI to $dest."; }
  hdiutil detach -quiet "$mnt" || true
  # Downloaded with curl, so macOS hasn't flagged it; clear the flag anyway in case a browser did.
  xattr -dr com.apple.quarantine "$dest/CURI.app" 2>/dev/null || true
  say "CURI is in $dest. Opening it…"
  open "$dest/CURI.app"
}

# ---------- Linux ----------
install_linux() {
  case "$arch" in
    x86_64|amd64) deb_arch=amd64 ;;
    aarch64|arm64) deb_arch=arm64 ;;
    *) die "there's no Linux build for $arch yet." ;;
  esac
  if command -v apt-get >/dev/null 2>&1; then
    file="$(pick "_${deb_arch}\\.deb\$")"
    [ -n "$file" ] || die "this release has no .deb for $deb_arch."
    download "$file"
    sudo=""; [ "$(id -u)" -eq 0 ] || sudo="sudo"
    say "Installing $file (asks for your password)"
    $sudo apt-get install -y "$tmp/$file" >/dev/null || die "apt couldn't install $file."
    say "CURI is installed. Open it from your apps, or run: curi-desktop"
    if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then (nohup curi-desktop >/dev/null 2>&1 &) ; fi
  else
    [ "$deb_arch" = amd64 ] || die "on ARM, CURI needs a Debian or Ubuntu system (apt)."
    file="$(pick '_amd64\.AppImage$')"
    [ -n "$file" ] || die "this release has no AppImage."
    download "$file"
    bin="$HOME/.local/bin"; apps="$HOME/.local/share/applications"
    mkdir -p "$bin" "$apps"
    install -m 755 "$tmp/$file" "$bin/curi"
    cat > "$apps/curi.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=CURI
Comment=Everything your AI agents can do, in one place
Exec="$bin/curi"
Terminal=false
Categories=Development;
EOF
    say "CURI is in $bin/curi and in your apps menu."
    if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then (nohup "$bin/curi" >/dev/null 2>&1 &) ; fi
  fi
}

case "$os" in
  Darwin) install_macos ;;
  Linux) install_linux ;;
  *) die "this script is for macOS and Linux. On Windows run: irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex" ;;
esac
