#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Execute com sudo na VM pública Ubuntu/Debian.' >&2; exit 1; }
command -v apt-get >/dev/null || { echo 'Instalador suporta Ubuntu/Debian. Veja README para outras distribuições.' >&2; exit 1; }
case "$(uname -m)" in aarch64|arm64) arch=arm64;; x86_64) arch=x64;; *) echo 'Arquitetura não suportada.' >&2; exit 1;; esac
src="$(cd -- "$(dirname -- "$0")/.." && pwd)"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https python3 python3-pip python3-venv build-essential pkg-config libssl-dev xz-utils rsync sqlite3 openssl coturn
# Caddy official repository, needed for basic_auth/request_body on maintained versions.
if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
node_version=24.21.0
archive="node-v${node_version}-linux-${arch}.tar.xz"
case "$arch" in
 arm64) checksum=6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2;;
 x64) checksum=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6;;
esac
if [[ ! -x /opt/verdant-node/bin/node ]]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf -- "$tmp"' EXIT
  curl -fsSL "https://nodejs.org/dist/v${node_version}/${archive}" -o "$tmp/$archive"
  printf '%s  %s\n' "$checksum" "$tmp/$archive" | sha256sum -c -
  mkdir -p /opt/verdant-node
  tar -xJf "$tmp/$archive" -C /opt/verdant-node --strip-components=1
fi
[[ "$(/opt/verdant-node/bin/node -p 'process.versions.node.split(".")[0]')" == 24 ]] || { echo 'Runtime /opt/verdant-node precisa ser Node 24 LTS.' >&2; exit 1; }
id verdant >/dev/null 2>&1 || useradd --system --home-dir /var/lib/verdant --shell /usr/sbin/nologin verdant
id verdant-build >/dev/null 2>&1 || useradd --system --home-dir /var/cache/verdant-build --shell /usr/sbin/nologin verdant-build
install -d -o verdant -g verdant -m 0750 /var/lib/verdant /var/lib/verdant/uploads
install -d -o verdant-build -g verdant-build -m 0750 /var/cache/verdant-build
install -d -o root -g root -m 0755 /opt/verdant /opt/verdant/releases /etc/verdant
if [[ ! -f /etc/verdant/verdant.env ]]; then
  install -o root -g verdant -m 0640 "$src/deploy/verdant.env.example" /etc/verdant/verdant.env
  /opt/verdant-node/bin/node -e 'const fs=require("fs"),crypto=require("crypto"); const p="/etc/verdant/verdant.env"; fs.writeFileSync(p,fs.readFileSync(p,"utf8").replace(/^TURN_SECRET=$/m,"TURN_SECRET="+crypto.randomBytes(32).toString("hex")));'
fi
if [[ ! -f /etc/verdant/caddy-users ]]; then
  install -o root -g caddy -m 0640 /dev/null /etc/verdant/caddy-users
fi
install -d -m 0755 /etc/systemd/system/coturn.service.d
# Preserve unrelated Caddy config; configure.sh refuses overwrites of unmanaged files.
for unit in verdant.service turn-cert-sync.service turn-cert-sync.timer; do
  target="/etc/systemd/system/$unit"
  if [[ -f "$target" ]] && ! cmp -s "$src/deploy/$unit" "$target"; then cp -a "$target" "$target.before-verdant-$(date +%s)"; fi
  install -m 0644 "$src/deploy/$unit" "$target"
done
if [[ ! -f /etc/systemd/system/coturn.service.d/verdant.conf ]]; then
  install -m 0644 "$src/deploy/coturn.override.conf" /etc/systemd/system/coturn.service.d/verdant.conf
fi
systemctl daemon-reload
"$src/deploy/update.sh" --install "$src"
echo 'Código instalado. Configure /etc/verdant/verdant.env; crie usuários com deploy/add-user.py; execute deploy/configure.sh.'
echo 'Nenhuma regra de firewall ou configuração de roteador residencial foi alterada.'
