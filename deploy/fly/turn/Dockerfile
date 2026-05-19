FROM coturn/coturn:4.6

# Install Node.js (used by the usage reporter that wraps coturn and parses
# its stdout for per-API-key bandwidth). Debian bookworm's `nodejs` is v18,
# which is enough for stdlib fetch + readline + child_process.
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY turnserver.conf /etc/coturn/turnserver.conf
COPY usage-reporter.mjs /opt/usage-reporter.mjs

EXPOSE 3478/udp 3478/tcp 49160-49200/udp

# Run as root inside the Fly VM. The coturn/coturn base image doesn't ship a
# `turnserver` Unix user; Fly's init requires the configured USER to exist,
# so we leave it as root. The Firecracker VM is the security boundary here,
# not the in-container UID.

ENTRYPOINT ["node", "/opt/usage-reporter.mjs"]
