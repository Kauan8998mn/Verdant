# Superprojeto de estresse — Verdant 0.3.8-stress.1

## Princípio de reconstrução

A referência funcional escolhida foi `verdant-lan-phase5-hotfix-stability-0.3.3`. O pedido foi comparar as revisões seguintes, reaplicar o que não pertence ao sistema de áudio e não assumir correções sem evidência.

### Prova de baseline

- `client/src/voice.ts` da 0.3.8 possui o mesmo SHA-256 da 0.3.3: `f20952aeb44db9f34c03e1935a843ebcb71d513962104c4300c09428db514082`.
- módulos posteriores `audio-config.ts`, `microphone-pipeline.ts` e `ui-sounds.ts` foram removidos.
- teste de regressão impede reentrada de APIs como `setInputGain`, `toggleMicTest`, `setRemoteVolume`, `setNoiseSuppression` e `setScreenAudioDevice`.
- `server/src/media.ts` difere somente nos campos de configuração de rede `announcedAddress`/`exposeInternalIp` e log do endereço anunciado.

## Comparação das revisões

| Revisão | Alteração observada | Decisão nesta reconstrução | Evidência local |
|---|---|---|---|
| 0.3.1 | cache/no-store e versão correta do cliente | mantida via base 0.3.3 | já estava incorporada na 0.3.3 |
| 0.3.2 | chat longo/composer/scroll | mantida via base 0.3.3 | testes `chat-scroll` |
| 0.3.3 | download em iframe, não derrubar chamada, scroll de voz | baseline | testes `download-frame`, `panel-scroll`, `render-policy` |
| 0.3.4 | apagar mensagem/canal/servidor | reaplicada | testes de integração owner-only e limpeza física |
| 0.3.4 | áudio alternativo de tela e supressão de ruído | excluída | módulos/calls não presentes |
| 0.3.5 | TXT index/search, previews, links, aparência local | reaplicada | testes de integração + `client-comfort` |
| 0.3.5 | ganho/monitor/teste de mic/volume individual | excluída | `voice.ts` idêntico à 0.3.3 |
| 0.3.6 | typing sem rerender, upload idempotente, retry, preview inline, Ctrl+V, fechar diálogo | reaplicada | testes `prephase6-036` e `upload-idempotency` |
| 0.3.6 | volume 200%, brilho de fala e sons locais | excluída | prefs restritas a aparência/privacidade |
| 0.3.7 | hotfix emergencial de áudio | excluída | não há pipeline 0.3.7 |
| 0.4.0 | Audio Core v2 | excluída | não há runtime/microphone-engine v2 |

## Bugs reportados e estado

- **cliente antigo em cache**: correção herdada da 0.3.3;
- **chat/composer saindo da viewport**: correção herdada e testes passam;
- **download derrubando/reconstruindo chamada**: mecanismo de iframe da 0.3.3 preservado;
- **scroll indo ao topo ao digitar**: alteração 0.3.6 reaplicada, teste passa;
- **upload duplicado/eterno**: `uploadId` idempotente + retry único reaplicados, teste real de banco/disco passa;
- **preview inline não aparecendo**: correção 0.3.6 reaplicada, teste estrutural passa;
- **criar servidor sem botão fechar**: botão `×` reaplicado;
- **bugs de áudio posteriores**: não declarados resolvidos; o código de áudio voltou ao baseline 0.3.3 por decisão explícita.

## Internet segura sem Radmin/Hamachi

O projeto agora suporta um **modo de implantação direta**, não uma VPN embutida:

1. Verdant HTTP/WebSocket fica preso em `127.0.0.1:43110`;
2. Caddy publica HTTPS em 443, autentica antes do app e renova certificado público;
3. mediasoup liga em `0.0.0.0:43111` UDP/TCP e anuncia o IP público configurado;
4. o app valida `Host` e `Origin` no modo público e envia CSP/headers de segurança.

Isso elimina a necessidade de Hamachi/Radmin **quando o host possui IP público roteável/port-forward ou está em uma VPS**. Não elimina CGNAT.

## Validação executada

- 46 testes Node: 45 pass, 0 fail, 1 skip;
- TypeScript do cliente: OK;
- sintaxe dos arquivos críticos: OK;
- health real do servidor sem mídia: OK;
- host não permitido: HTTP 421;
- headers CSP/X-Frame/no-sniff/referrer/permissions: presentes;
- SPEC integral: 1596 linhas, auditoria OK.

## Não assumido / ainda pendente

Não foi possível confirmar neste ambiente: emissão ACME real, roteador/NAT real, comunicação mídia entre duas redes externas, host Windows físico, seletor real de tela/áudio e E2E Chromium+mediasoup. Esses pontos permanecem explicitamente **não validados**.
