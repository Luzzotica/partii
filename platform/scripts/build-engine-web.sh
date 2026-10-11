#!/usr/bin/env bash
# Build the engine for browsers: sdk/engine-web/partii_engine.{js,wasm,d.ts}.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
RUSTFLAGS='--cfg getrandom_backend="wasm_js"' cargo build -p partii-engine --target wasm32-unknown-unknown --no-default-features --release
wasm-bindgen --target web --out-dir sdk/engine-web target/wasm32-unknown-unknown/release/partii_engine.wasm
ls -la sdk/engine-web
