# Verdant — Status 0.5.0 Phase 8 Segurança

## Fase 8 concluída nesta entrega

- senha opcional por servidor com derivação resistente a força bruta (`scrypt`), salt aleatório e comparação em tempo constante;
- rate limiting HTTP e proteção de rajadas de autenticação, preservando o limite WebSocket;
- permissões por cargo e validações server-side auditadas;
- tela cheia nativa por transmissão com Fullscreen API;
- mute individual explícito do áudio de cada transmissão;
- conexão de voz independente da navegação: abrir outro servidor não encerra a chamada atual;
- enumeração de interfaces de rede com fallback seguro em vez de derrubar o host.

Validação automatizada: **88 testes, 87 passaram, 0 falharam e 1 foi ignorado** por exigir Chromium/mediasoup reais.

## Baseline de áudio

O sistema de áudio/voz ativo é o da **0.3.3**. `client/src/voice.ts` é byte-a-byte idêntico à base 0.3.3 usada nesta reconstrução. As mudanças posteriores de microfone, ganho, volume 200%, supressão de ruído, monitor, sons de interface, fonte alternativa de áudio da tela, hotfix 0.3.7 e Audio Core v2 0.4.0 foram deliberadamente excluídas.

`server/src/media.ts` recebeu apenas suporte de rede para `announcedAddress` necessário ao modo Internet/NAT. A lógica de Producer/Consumer/Opus/mute/tela permanece a 0.3.3.

## Correções/recursos não-áudio reaplicados

- 0.3.1: cache/no-store do cliente;
- 0.3.2: chat longo, composer e scroll;
- 0.3.3: download em iframe, preservação de WebSocket/WebRTC e scroll estável;
- 0.3.4: exclusão owner-only de mensagem/canal/servidor e limpeza física de anexos;
- 0.3.5: busca/indexação de TXT, previews autenticados, links seguros, preview externo opt-in e aparência local;
- 0.3.6: typing sem rerender, upload idempotente, retry único, mensagens de erro melhores, preview inline corrigido, Ctrl+V e botão X do diálogo de servidor.

## Modo Internet

Há launchers separados para Windows e Linux usando Caddy como HTTPS/reverse proxy e mediasoup com endereço público anunciado. Não depende de Hamachi/Radmin. Exige domínio/IP público roteável ou VPS e acesso externo direto à porta de mídia 43111 UDP/TCP.

## Validação concluída neste pacote

- testes Node: 46 total, 45 passaram, 0 falharam, 1 skip (E2E Chromium/mediasoup real);
- TypeScript do cliente: typecheck OK com declaração temporária apenas para o módulo `mediasoup-client`;
- parsing Node/TypeScript dos arquivos críticos: OK;
- API em processo real com `MEDIA_DISABLED=1`: health OK, headers de segurança presentes, host inválido retorna 421;
- auditoria integral do SPEC: 1596 linhas, SHA-256 `d50891340d8d26819b3fd84e82bf22b7712f9c7c9f96dc4fd4a3e8a958d37b35`, OK.

## Ainda não validado

- build real com dependências npm neste ambiente de empacotamento;
- navegador Chromium/Firefox com mídia real;
- Caddy/ACME com domínio real;
- NAT/port-forward real;
- WebRTC entre redes externas reais;
- host Windows real.

---

## Atualização 0.3.9-prephase6.1

Esta atualização parte do pacote Chromium UI 0.3.8 e prepara o cliente para o gate anterior à Fase 6.

- chat: mensagens recebidas/enviadas são reconciliadas incrementalmente em vez de reconstruir toda a lista; o scroll do usuário é preservado e o modo Chromium desativa `overflow-anchor` e `scroll-behavior: smooth` na área de mensagens;
- perfil: foto por usuário e por servidor, persistida no host; PNG/JPEG/WebP são normalizados no cliente para WebP 256×256 e SVG é rejeitado no servidor;
- aparência: presets de cor, blur dos painéis e cor/intensidade do glow de fala configuráveis;
- voz: `client/src/voice.ts` e `server/src/media.ts` não foram modificados nesta rodada.

Validação desta atualização: 62 testes, 61 passaram, 0 falharam e 1 foi pulado (E2E real Chromium + mediasoup). O SPEC foi relido integralmente e a auditoria estrutural passou; a auditoria `--phase=5` ainda avisa que a Fase 5 não está marcada como concluída no SPEC, portanto a Fase 6 continua atrás do teste manual final em múltiplos clientes.


---

## Atualização 0.3.9-prephase6.3 — Volume remoto 200% isolado

O controle individual de participantes agora vai de 0% a 200%.

A implementação antiga da 0.3.6 foi revisada e não foi reutilizada. Nesta versão, 0–100% continua no caminho direto `Consumer -> HTMLAudioElement`; somente valores acima de 100% ativam um pipeline Web Audio remoto, preguiçoso e descartável sobre `consumer.track.clone()`.

Se o pipeline de boost não puder ser iniciado ou reproduzido, o cliente retorna automaticamente para 100% em vez de silenciar a pessoa.

O caminho de captura e processamento do microfone não foi alterado. `microphone-processing.ts`, `voice-audio-preferences.ts`, o AudioWorklet Verdant e os módulos de mídia do servidor permanecem byte por byte iguais à 0.3.9-prephase6.2.

Validação: 70 testes, 69 passados, 0 falhas, 1 skip E2E Chromium/mediasoup real; TypeScript passou com shim temporário do módulo externo; SPEC relido integralmente e auditoria estrutural OK.

---

## Fase 6 iniciada — 0.4.0-phase6.1 Multi-stream

A Fase 5 foi encerrada como base funcional após validação prática do usuário em Chromium. A Fase 6 começa nesta versão sem marcar a própria Fase 6 como concluída.

Implementado nesta primeira entrega concreta:

- mais de um participante pode compartilhar tela simultaneamente no mesmo canal de voz;
- cliente mantém múltiplos pares independentes de `screen-video` / `screen-audio` por `shareId`;
- grade automática para transmissões locais e remotas;
- foco por clique e retorno à grade;
- áudio de cada transmissão pode ser mutado individualmente;
- mute global afeta somente áudio de transmissões, sem interferir nos microfones da chamada;
- Chromium/VP8 envia três encodings simulcast por transmissão;
- uma transmissão focada pede camada alta; em grade com múltiplas transmissões são pedidas camadas baixas;
- no modo foco, vídeos remotos fora de foco são pausados no Consumer para poupar banda, mantendo o áudio independente;
- prioridade de Consumer favorece a transmissão em foco;
- UI de compartilhamento foi extraída de `main.ts` para `screen-ui.ts` e a política de qualidade para `screen-multistream.ts`.

As **layers adaptativas** desta versão são orientadas por quantidade de streams e foco/grade. Uma segunda camada de adaptação automática por métricas reais de congestionamento/banda continua planejada; a Fase 6 ainda não é declarada concluída antes do teste multi-PC real.

Validação automatizada desta versão: 80 testes, 79 passaram, 0 falharam e 1 foi pulado (E2E real Chromium + mediasoup). O teste de duas ou mais transmissões reais simultâneas em PCs distintos ainda é obrigatório.


## Fase 6 concluída por validação prática — 19/08/2026

O usuário concluiu os testes reais da Fase 6 e reportou o fluxo multi-stream como funcionando corretamente. O gate `phase6-real-multiclient-validation` foi removido do manifesto e a Fase 6 foi marcada como concluída.

## Fase 7 iniciada — 0.4.1-phase7.1

Primeira rodada de performance, mantendo o comportamento funcional da Fase 6:

- `main.ts`: UI de voz extraída para `client/src/voice-ui.ts`;
- renderização: rail/canais/membros/main usam assinaturas estruturais; `speaking` altera somente classes dinâmicas em vez de reconstruir painéis;
- estado: patches sem mudança real deixam de notificar listeners;
- multi-stream: em grade com duas ou mais telas, Consumer de vídeo remoto fica pausado até foco; o áudio permanece independente;
- foco: stream escolhida recebe vídeo e preferência de camada alta;
- sinalização: `consumer.pause`, `consumer.resume` e `consumer.quality` evitam chamadas redundantes;
- servidor: limite de quatro screen-video producers simultâneos por canal;
- regressão: microfone/DSP e boost remoto 0–200% não foram refatorados nesta rodada.

Validação automatizada: 85 testes, 84 passaram, 0 falharam e 1 foi pulado (E2E real Chromium/mediasoup). TypeScript do cliente passou com declaração temporária local apenas para `mediasoup-client`; a declaração foi removida.

A Fase 7 permanece aberta para benchmark real de CPU/RAM/banda, validação de aceleração por hardware Intel/NVIDIA e adaptação por métricas de congestionamento.
