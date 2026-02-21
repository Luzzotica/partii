FROM rust:1.85-bookworm AS builder

WORKDIR /build

# The server embeds map JSON from ../game/maps via include_str!,
# so copy the full gyrii tree (server + game assets).
COPY games/gyrii ./games/gyrii

WORKDIR /build/games/gyrii/server
RUN cargo build --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/games/gyrii/server/target/release/gyrii-server /usr/local/bin/gyrii-server

EXPOSE 4000

CMD ["gyrii-server"]
