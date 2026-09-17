#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 ]] || { echo 'Uso: deploy/remote.sh /caminho/privado/remote.env' >&2; exit 1; }
# This is a locally authored shell configuration, never a downloaded file.
source "$1"
for name in VM_HOST SSH_USER SSH_KEY VERDANT_DOMAIN TURN_DOMAIN; do
  [[ -n ${!name:-} && ${!name} != *REPLACE* ]] || { echo "Preencha $name antes de conectar." >&2; exit 1; }
done
[[ $VM_HOST =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && $SSH_USER =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || { echo 'Host/usuário inválidos.' >&2; exit 1; }
for domain in "$VERDANT_DOMAIN" "$TURN_DOMAIN"; do
  [[ $domain =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$ ]] || { echo 'Domínio inválido.' >&2; exit 1; }
done
[[ $VERDANT_DOMAIN != "$TURN_DOMAIN" && $SSH_KEY == /* && -f $SSH_KEY ]] || { echo 'Use domínios distintos e chave SSH em caminho absoluto existente.' >&2; exit 1; }
src="$(cd -- "$(dirname -- "$0")/.." && pwd)"
ssh_opts=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=ask)
printf -v remote_shell '%q ' ssh "${ssh_opts[@]}"
stage="verdant-upload-$(date -u +%Y%m%dT%H%M%S)-$$"
rsync -a -e "$remote_shell" --exclude=.git --exclude=node_modules --exclude=data --exclude=uploads --exclude=logs --exclude=dist --exclude=backups --exclude=test-results --exclude='.env*' --exclude='*.env' --exclude='*.key' --exclude='*.pem' --exclude='*.sqlite*' "$src/" "$SSH_USER@$VM_HOST:$stage/"
ssh -t "${ssh_opts[@]}" "$SSH_USER@$VM_HOST" "sudo bash $stage/deploy/install.sh"
ssh -t "${ssh_opts[@]}" "$SSH_USER@$VM_HOST" "sudo /opt/verdant-node/bin/node /opt/verdant/current/deploy/prepare-env.mjs $VM_HOST $VERDANT_DOMAIN $TURN_DOMAIN"
echo "Crie a senha individual do primeiro login Caddy ($SSH_USER); não será gravada neste computador."
ssh -t "${ssh_opts[@]}" "$SSH_USER@$VM_HOST" "sudo /opt/verdant/current/deploy/add-user.py $SSH_USER"
echo 'Agora revise DNS/firewalls e rode sudo /opt/verdant/current/deploy/configure.sh na VM.'
echo 'Se houver Caddyfile não gerenciado, revise-o antes de optar por --replace-caddy.'
echo 'VM/DNS/ACME/relay externo/reboot/ARM64/capacidade: AINDA NÃO TESTADO até executar docs/TESTING.md.'
