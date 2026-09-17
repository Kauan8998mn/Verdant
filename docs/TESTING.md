# Validação da migração pública

Registre data, commit, versões, arquitetura, rede de cada cliente e resultado.
Não inclua senhas, tokens, segredo TURN, SDP completo ou chaves nos relatórios.

## Comandos locais

Use Node 24 conforme `package.json`:

```bash
npm run build
npm test
REQUIRE_PROXY_E2E=1 REQUIRE_TURN_E2E=1 REQUIRE_MEDIA_E2E=1 CHROMIUM_PATH=/caminho/do/chrome npm run check
REQUIRE_PROXY_E2E=1 node --test tests/public-proxy.test.ts
CHROMIUM_PATH=/caminho/do/chrome npm run test:media
# Mesmo E2E, exigindo relay nos transports dos dois navegadores:
TEST_TURN_TRANSPORT=udp CHROMIUM_PATH=/caminho/do/chrome npm run test:media
TEST_TURN_TRANSPORT=tcp CHROMIUM_PATH=/caminho/do/chrome npm run test:media
# Passa pelo TTL real de 120 s, com renovação e restart de ICE:
REQUIRE_ICE_RENEWAL=1 TEST_TURN_TRANSPORT=tcp CHROMIUM_PATH=/caminho/do/chrome npm run test:media
REQUIRE_TURN_E2E=1 node --test tests/turn-local.test.ts
# Serviço isolado em /opt e /var/lib; limpa recursos de QA ao terminar:
sudo env VERDANT_QA_NODE=/caminho/absoluto/node24 bash scripts/test-deploy-local.sh
```

`public-proxy.test.ts` usa Caddy real em portas locais com Basic, identidade,
histórico, upload e upgrade WebSocket. O HTTP local desse teste não prova ACME.
`media-browser.test.ts` usa dois clientes Chromium e mídia sintética através do
SFU local; não mede capacidade nem representa duas redes físicas.
Os modos `TEST_TURN_TRANSPORT` iniciam Coturn isolado com peers loopback
permitidos somente para o teste. Exigem candidato `relay` nos transports de
envio/recepção e contadores RTP de áudio crescentes. Não alteram firewall nem
provam fallback com UDP bloqueado. Execute esses modos sequencialmente porque
compartilham a faixa local 45000–45100 de relay.

## Gates externos — todos pendentes

| Gate | Evidência necessária |
| --- | --- |
| VM Oracle | instalação, worker inicializado, health, permissões e portas verificadas |
| DNS / ACME | A correto, HTTPS confiável de fora, certificado TURN e renovação |
| Mídia direta | dois clientes em redes distintas; áudio bidirecional, tela e áudio da tela |
| TURN UDP | `relay` selecionado nos transports ativos, áudio/vídeo trafegando |
| TURN TCP | `relayProtocol=tcp`, áudio/vídeo trafegando |
| TURN TLS | `relayProtocol=tls`, certificado confiável, mídia trafegando |
| UDP bloqueado | bloquear UDP no cliente de teste e confirmar fallback TCP/TLS real |
| Credenciais | chamada além do TTL; renovação; credencial vencida recusada em nova alocação |
| Reconexão | queda breve de rede, reconectar mantendo servidor/canal da chamada original |
| Reboot | reiniciar VM, serviços voltam; dados/identidade íntegros e nova chamada funciona |
| ARM64 | instalar e criar worker numa CPU ARM64 real; mídia E2E |
| 2–6 usuários | áudio simultâneo, telas, CPU/RAM/egress/perdas/RTT durante sessão sustentada |
| Recuperação | restaurar backup isolado e conferir mensagens, anexos e identidades |

## Forçar rota para diagnóstico

Somente durante teste, use `VERDANT_DEBUG_WEBRTC=true`, `VERDANT_ICE_POLICY=relay`
e `VERDANT_TURN_TRANSPORT=udp`, `tcp` ou `tls`. Exige `TURN_ENABLED=true`.
Reinicie o serviço e entre novamente na chamada após mudar a configuração.
Inspecione `[Verdant ICE selected]` no navegador e `client.ice.selected` no
journal. Confirme pacotes/bytes crescentes; emitir credenciais ou criar candidato
não prova transporte de mídia. Ao terminar, restaure policy/transport `all` e
debug `false`.

O bloqueio de UDP deve ocorrer apenas no cliente de teste, sem derrubar SSH nem
reconfigurar o roteador doméstico. Não simule o bloqueio apenas selecionando
TURN TCP: são provas distintas.

## Registro local da retomada — 2026-09-17

Ambiente: CachyOS Linux x64; Node 24.21.0; mediasoup 3.26.0 (worker nativo
compilado); Chrome for Testing 153.0.8010.36; Caddy 2.11.4; Coturn 4.17.2.
Implementação recuperada em `0bc132b`; ajustes e E2Es ampliados em `0e3546e`.

| Teste executado | Resultado |
| --- | --- |
| Build cliente, servidor e configurador / auditoria estrutural | aprovado |
| `npm run check` final, com proxy/TURN/browser obrigatórios | 97 aprovados, zero falhas, zero pulados; build e auditoria OK |
| Caddy Basic + sessão + histórico/upload/WS e isolamento de identidade | aprovado |
| Sessão retomada sem WS continua com expiração finita | aprovado |
| Voz bidirecional, tela/áudio pelo SFU local | aprovado |
| Reconectar WS de voz enquanto navega outro servidor | aprovado, chamada original e RTP preservados |
| TURN WebRTC UDP forçado | aprovado, relay em send/recv nos dois clientes, RTP crescente e vídeo decodificado |
| TURN WebRTC TCP forçado | aprovado, relay em send/recv nos dois clientes e mídia real via SFU |
| Chamada além do TTL TURN real de 120 s | aprovado em TCP (E2E de 174 s), credenciais renovadas, ICE send/recv reiniciado e RTP continua |
| Coturn ChannelData UDP/TCP/TLS e credencial vencida | aprovado |
| systemd com sandbox / morte do worker / parada limpa | aprovado, aplicação e worker reiniciaram |
| Backup/restauração isolada | aprovado, SQLite íntegro, mensagens e bytes de anexos conferidos |
| Certificados Coturn no sandbox | aprovado, hostname/permissões/renovação/timer conferidos |
| UI com agent-browser | aprovado, criação/envio/edição/cancelamento e rascunho preservado |

A suíte inicial recuperada passou 93 de 95 testes (browser sem caminho e TURN
opt-in foram pulados). Browser e TURN foram executados separadamente como
obrigatórios. Um timeout de inicialização do Chrome foi observado; o harness
agora permite 60 s para inicializá-lo. A verificação de reconexão passou a usar
transports conectados e RTP, porque o texto do painel de voz não aparece quando
o cliente está navegando num canal de texto.

Estes resultados são locais. Não validam o instalador Ubuntu/Debian numa VM,
ACME confiável, hairpin da nuvem, redes distintas, bloqueio real de UDP, reboot,
ARM64 ou capacidade 2–6.
