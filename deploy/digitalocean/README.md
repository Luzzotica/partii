# Gyrii on DigitalOcean (Docker + Caddy)

This deploy target runs:

- `gyrii-server` in Docker (internal port `4000`)
- `caddy` for automatic TLS and WebSocket proxy on `443`

Clients should connect to:

- `wss://gyrii.sterlinglong.me`

## 1) Create a Droplet

Recommended:

- Ubuntu 24.04 LTS
- Basic shared CPU (`s-1vcpu-1gb` is fine to start)
- Region near your players
- Add your SSH key

## 2) Point DNS

Create an `A` record:

- Host: `gyrii`
- Value: `<DROPLET_PUBLIC_IP>`

Wait until DNS resolves before first TLS issuance.

## 3) Install Docker on Droplet

```bash
ssh root@<DROPLET_PUBLIC_IP>
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## 4) Upload project to Droplet

Run from your local repo root:

```bash
rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".next" \
  ./ root@<DROPLET_PUBLIC_IP>:/opt/partii
```

## 5) Set production server env on Droplet

```bash
cp /opt/partii/games/gyrii/server/.env.prod.example /opt/partii/games/gyrii/server/.env.prod
nano /opt/partii/games/gyrii/server/.env.prod
```

Set real values for:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## 6) Bring up services

```bash
cd /opt/partii/deploy/digitalocean
docker compose up -d --build
docker compose logs -f
```

## 7) Open firewall on Droplet (optional but recommended)

If using UFW:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## 8) Point frontend to production WebSocket URL

Set frontend env:

```env
NEXT_PUBLIC_GYRII_USE_NEW_SERVER=true
NEXT_PUBLIC_GYRII_SERVER_WS=wss://gyrii.sterlinglong.me
```

## Updating after code changes

```bash
rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".next" \
  ./ root@<DROPLET_PUBLIC_IP>:/opt/partii

ssh root@<DROPLET_PUBLIC_IP> "cd /opt/partii/deploy/digitalocean && docker compose up -d --build"
```
