# Verdant 0.3.8-stress.1 — modo online sem Hamachi/Radmin

> Guia histórico. Na branch `migration/public-server`, use
> [implantação pública](docs/DEPLOY_ORACLE.md), [estado atual](CURRENT_STATE.md)
> e [validação](docs/TESTING.md). O launcher antigo não ativa identidade
> individual, requisitos de produção ou TURN desta migração.

## O que este modo faz

O HTTP/WebSocket fica em `127.0.0.1:43110` e é publicado por Caddy em HTTPS público. O SFU mediasoup continua em `43111` UDP/TCP e anuncia o IP público informado em `MEDIA_ANNOUNCED_ADDRESS`. Nenhuma VPN de malha é necessária.

## Requisitos que não podem ser eliminados pelo aplicativo

Você precisa de **uma** destas condições:

1. um PC com IP público e roteador permitindo encaminhar portas; ou
2. uma VPS/servidor público executando o Verdant.

Se sua operadora usa CGNAT e você não possui IPv4/IPv6 público roteável, hospedar diretamente de casa sem túnel/VPS não é possível.

### DNS/portas

- domínio apontando para o IP público do host;
- TCP 80 e 443 encaminhados/liberados para Caddy;
- UDP 43111 e TCP 43111 encaminhados/liberados para o host Verdant;
- **não** exponha 43110 diretamente à Internet: o launcher online o prende em 127.0.0.1.

## Caddy

Instale o Caddy oficial no Windows ou Linux e crie um hash de senha:

```text
caddy hash-password
```

Defina as variáveis (exemplo; não reutilize estas credenciais):

Linux/fish:
```fish
set -x VERDANT_DOMAIN verdant.seudominio.com
set -x VERDANT_PUBLIC_IP 203.0.113.10
set -x VERDANT_AUTH_USER grupo
set -x VERDANT_AUTH_HASH 'HASH_GERADO_PELO_CADDY'
./run-host-online-linux.sh
```

Windows PowerShell:
```powershell
$env:VERDANT_DOMAIN='verdant.seudominio.com'
$env:VERDANT_PUBLIC_IP='203.0.113.10'
$env:VERDANT_AUTH_USER='grupo'
$env:VERDANT_AUTH_HASH='HASH_GERADO_PELO_CADDY'
.\run-host-online-windows.ps1
```

Os amigos acessam `https://verdant.seudominio.com`. Não há CA privada para instalar no modo online, pois o Caddy obtém certificado público quando DNS e 80/443 estão corretos.

## Segurança adicionada

- autenticação HTTP antes de qualquer HTML/API/WebSocket;
- HTTPS público no proxy;
- backend preso em loopback no modo online;
- allow-list de `Host`;
- validação de `Origin` para upgrade WebSocket no modo público;
- CSP, frame deny, no-sniff, referrer policy e permissions policy;
- install scripts do npm aprovados apenas para versões fixadas de mediasoup/esbuild.

## Limites confirmados

Caddy protege HTTP/WebSocket, mas **não transporta o UDP do mediasoup**. A porta 43111 precisa ser alcançável diretamente pelos clientes. Se isso não for possível, use uma VPS pública para hospedar o Verdant ou adicione uma arquitetura TURN/TCP dedicada em uma versão futura.
