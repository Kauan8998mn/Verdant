# Evidências e hipóteses sobre falhas antigas

## Evidência obtida na retomada (2026-09-17)

O teste com Caddy real confirmou que Basic e `X-Verdant-Session` coexistem em
histórico, upload e WebSocket, e que outro login não pode usar uma sessão alheia.
O SFU compilado transportou voz e tela/áudio entre dois browsers locais.
Coturn retransmitiu pacotes UDP/TCP/TLS e recusou credencial expirada. systemd
reiniciou aplicação/worker após matar o worker. Os E2Es ampliados também
confirmaram relay WebRTC UDP/TCP, mídia e renovação além do TTL real de 120 s,
além de reconexão conservando a chamada original ao navegar outro servidor.
Essas evidências validam as
correções locais; não identificam uma causa única do incidente histórico nem
substituem os testes em redes distintas.

## Confirmado: conflito de autenticação no modo Caddy antigo

Sintoma esperado: página autenticada abre, mas API autenticada retorna 401. `Caddyfile.online` exige Basic em Authorization; `client/src/api.ts` e upload enviam Bearer no mesmo header. Caddy rejeita antes de chegar à aplicação. LAN sem esse proxy mascara o conflito. A migração usa X-Verdant-Session para sessão da aplicação e conserva Basic para identidade individual no Caddy. Será coberto por teste de proxy real.

## Confirmado: configuração LAN por padrão; causa do incidente não confirmada

`server/src/index.ts` seleciona loopback/interfaces locais; `server/src/media.ts` anuncia esses endereços quando falta override público. LAN/VPN fornece rotas que a internet comum não oferece. O launcher online já possui override; sem conhecer como o usuário o executava, não é possível afirmar que esse foi o bug antigo.

## Confirmado: ausência de TURN; efeito depende da rede

`client/src/voice.ts` não fornece iceServers aos transports. Redes incapazes de alcançar diretamente o SFU não têm rota de relay. Um SFU público pode funcionar sem TURN em várias redes; ausência de TURN não prova falha em todas elas.

## Correção proposta e prova necessária

Servidor em VM pública, endereço anunciado validado, firewall da nuvem/Linux coerente, Caddy/API sem conflito, Coturn com credenciais temporárias. Provar separadamente HTTPS/WS, mídia direta e relay entre redes distintas. Nenhuma captura antiga foi fornecida: não foi identificada uma causa única comprovada para o abandono.
