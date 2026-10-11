#!/usr/bin/env bash
# Build the engine for browsers: sdk/engine-web/partii_engine.{js,wasm,d.ts}.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
RUSTFLAGS='--cfg getrandom_backend="wasm_js"' cargo build -p partii-engine --target wasm32-unknown-unknown --no-default-features --release
# The CLI must match the wasm-bindgen crate version in Cargo.lock.
V=$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | grep version | cut -d'"' -f2)
[ "$(wasm-bindgen --version | cut -d' ' -f2)" = "$V" ] || cargo install wasm-bindgen-cli --version "$V" --locked
wasm-bindgen --target web --out-dir sdk/engine-web target/wasm32-unknown-unknown/release/partii_engine.wasm
ls -la sdk/engine-web
