# Verdant LAN — Fase 6.1 Multi-stream

Versão: `0.4.0-phase6.1`

## Objetivo desta entrega

Iniciar a Fase 6 de forma funcional e reversível, preservando o caminho de voz/microfone que já passou pelos hotfixes anteriores. O escopo desta versão é múltiplos broadcasters, consumo simultâneo, grade, foco, controles de áudio por transmissão e primeira política de layers para Chromium.

## Modelo de transmissão

O servidor continua permitindo no máximo um `screen-video` e um `screen-audio` por peer, mas remove o bloqueio global de uma única tela no canal. Portanto participantes diferentes podem transmitir simultaneamente. Cada transmissão é identificada por `shareId`, compartilhado entre seu vídeo e áudio.

O cliente substituiu o único remoto de tela por um `Map<shareId, RemoteScreenMedia>`. Vídeo e áudio podem chegar em qualquer ordem e são associados à mesma transmissão.

## Chromium / simulcast

`screen-video` usa VP8 com três encodings de resolução/bitrate progressivos. A política local é:

- uma única transmissão remota sem foco: camada alta;
- duas ou mais transmissões em grade: camada baixa para cada vídeo remoto;
- transmissão remota focada: camada alta e prioridade elevada;
- vídeos remotos fora de foco: Consumer pausado;
- áudio de tela não acompanha o pause do vídeo e permanece independente.

A chamada `consumer.quality` permite ao servidor aplicar `setPreferredLayers()` quando o Consumer é simulcast/SVC e ajustar prioridade quando suportado.

## UI

A UI de mídia foi separada em `client/src/screen-ui.ts`. Ela fornece:

- grade de transmissões;
- foco por clique;
- botão **Voltar para grade**;
- indicador de qualidade/estado;
- mute individual de áudio por transmissão;
- mute global de áudio das transmissões;
- stop local e stop administrativo já existente.

A política de layers/qualidade está isolada em `client/src/screen-multistream.ts` para evitar espalhar regras de Fase 6 pelo `main.ts`.

## Proteções de regressão de áudio

A Fase 6 precisa tocar `voice.ts`, pois consumo de screen producers vive ali, mas os módulos sensíveis criados nos retoques anteriores não foram alterados. O teste `phase6-multistream.test.ts` fixa SHA-256 de:

- `client/src/microphone-processing.ts`;
- `client/src/voice-audio-preferences.ts`;
- `client/src/remote-playback-boost.ts`;
- `client/public/audio/verdant-noise-worklet.js`.

Assim, uma alteração acidental nesses módulos faz a suíte falhar.

## O que ainda NÃO está sendo declarado concluído

Esta versão não marca a Fase 6 como concluída. Ainda faltam:

- validação real com pelo menos dois PCs Chromium transmitindo simultaneamente;
- adaptação adicional baseada em métricas reais de banda/congestionamento, além da política já ativa de foco/grade;
- somente depois disso, decidir se SVC ou ajustes adicionais de simulcast são necessários.

## Validação no ambiente de empacotamento

- 80 testes: 79 passados, 0 falhas, 1 skip;
- typecheck do cliente: OK com shim temporário apenas para a dependência externa;
- syntax check dos arquivos críticos alterados: OK;
- E2E real Chromium + mediasoup: não executado;
- `npm install`: tentativa excedeu o limite de 180 s, portanto `npm run build` real não é alegado como validado.


## Encerramento da Fase 6

Em 19/08/2026, após os testes reais executados pelo usuário, a Fase 6 foi reportada como plenamente funcional e passou a constar como concluída no manifesto do projeto. As otimizações adicionais de banda/CPU e adaptação por congestionamento foram movidas para a Fase 7 e não reabrem o gate funcional desta fase.
