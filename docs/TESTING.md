# Validação da migração pública

Registre data, commit, versões, arquitetura, rede de cada cliente e resultado.
Não inclua senhas, tokens, segredo TURN, SDP completo ou chaves nos relatórios.

## Comandos locais

Use Node 24 conforme `package.json`:

```bash
npm run build
npm test
REQUIRE_PROXY_E2E=1 node --test tests/public-proxy.test.ts
CHROMIUM_PATH=/caminho/do/chrome npm run test:media
```

`public-proxy.test.ts` usa Caddy real em portas locais com Basic, identidade,
histórico, upload e upgrade WebSocket. O HTTP local desse teste não prova ACME.
`media-browser.test.ts` usa dois clientes Chromium e mídia sintética através do
SFU local; não mede capacidade nem representa duas redes físicas.

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
