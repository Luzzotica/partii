#!/usr/bin/env bash
# Build the partii CLI for Linux (the torture containers' arch) into
# platform/target-linux/bin/partii. Cargo caches live in Docker volumes.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
docker run --rm \
  -v "$here":/src -w /src \
  -v partii-cargo-registry:/usr/local/cargo/registry \
  -v partii-target-linux:/src/target-linux/cache \
  -e CARGO_TARGET_DIR=/src/target-linux/cache \
  -e CARGO_INCREMENTAL=0 \
  rust:1-bookworm \
  sh -c 'cargo build -p partii-cli --release && mkdir -p /src/target-linux/bin && cp /src/target-linux/cache/release/partii /src/target-linux/bin/partii.new && mv -f /src/target-linux/bin/partii.new /src/target-linux/bin/partii'
echo "built $here/target-linux/bin/partii"
