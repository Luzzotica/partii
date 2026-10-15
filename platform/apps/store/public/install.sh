#!/bin/sh
# Install the partii CLI (macOS and Linux):
#   curl -fsSL https://partii.games/install.sh | sh
# Puts `partii` in ~/.local/bin (or $PARTII_INSTALL). Re-run to update.
# PARTII_VERSION=0.2.0 picks a version; the newest otherwise.
set -eu
REPO=Luzzotica/partii
DEST=${PARTII_INSTALL:-$HOME/.local/bin}

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=aarch64-apple-darwin ;;
  Darwin-x86_64) target=x86_64-apple-darwin ;;
  Linux-x86_64) target=x86_64-unknown-linux-gnu ;;
  Linux-aarch64 | Linux-arm64) target=aarch64-unknown-linux-gnu ;;
  *) echo "partii: no build for $(uname -s) $(uname -m) yet; build it with cargo (github.com/$REPO, platform/crates/partii-cli)" >&2; exit 1 ;;
esac

if [ -n "${PARTII_VERSION:-}" ]; then
  tag="cli-v${PARTII_VERSION#v}"
else
  tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=30" | grep -o '"tag_name": *"cli-v[^"]*"' | head -1 | sed 's/.*"\(cli-v[^"]*\)"/\1/')
  [ -n "$tag" ] || { echo "partii: couldn't find a release" >&2; exit 1; }
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
base="https://github.com/$REPO/releases/download/$tag"
curl -fsSL "$base/partii-$target.tar.gz" -o "$tmp/partii.tar.gz"
curl -fsSL "$base/partii-$target.tar.gz.sha256" -o "$tmp/sum"
want=$(cut -d' ' -f1 < "$tmp/sum")
if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/partii.tar.gz" | cut -d' ' -f1); else got=$(shasum -a 256 "$tmp/partii.tar.gz" | cut -d' ' -f1); fi
[ "$want" = "$got" ] || { echo "partii: checksum mismatch; not installing" >&2; exit 1; }

tar -xzf "$tmp/partii.tar.gz" -C "$tmp"
mkdir -p "$DEST"
mv "$tmp/partii" "$DEST/partii"
chmod +x "$DEST/partii"

echo "Installed $("$DEST/partii" --version 2>/dev/null || echo partii) to $DEST/partii"
case ":$PATH:" in
  *":$DEST:"*) ;;
  *) echo "Add it to your PATH: export PATH=\"$DEST:\$PATH\"" ;;
esac
echo "Next: partii login --email you@example.com   (then the code from the email: partii login --email you@example.com --code 123456)"
echo "Every command: partii help --json. The guide for AI agents: https://partii.games/llms.txt"
