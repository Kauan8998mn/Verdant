# Fase 7.1 — Relatório de performance

Data: 19/08/2026  
Versão: `0.4.1-phase7.1`

## Objetivo

Reduzir banda, decodificação de vídeo e churn de DOM sem alterar o fluxo funcional da Fase 6 já validado em uso real.

## Alterações

### Vídeo de screen share sob demanda

- uma única transmissão continua visível automaticamente em alta qualidade;
- com duas ou mais telas, vídeos remotos da grade ficam pausados;
- clicar em uma tela a coloca em foco e retoma somente o vídeo necessário;
- outras telas remotas permanecem pausadas enquanto houver foco;
- áudio de cada screen share continua independente do pause de vídeo;
- o estado visual do tile permanece disponível para o usuário escolher qual stream deseja receber.

### Sinalização idempotente

O cliente guarda o último modo aplicado por Consumer. `pause`, `resume` e mudança de quality/layer só são sinalizados quando há transição real. Isso reduz round-trips e trabalho repetido em rerenders ou eventos de estado que não alteram a política.

### Renderização

A UI de voz saiu de `main.ts` para `client/src/voice-ui.ts`. Rail, lista de canais, lista de membros e conteúdo principal usam assinaturas estruturais. Eventos frequentes de fala fazem patch somente nas classes necessárias. Atualizações de estado sem mudança top-level deixam de notificar subscribers.

### Limite de screens

O servidor aceita no máximo quatro producers `screen-video` simultâneos por canal. A regra fica no backend para não depender da UI do cliente.

## Guardrails

- pipeline de microfone e noise suppression não foi refatorado;
- boost remoto de voz 0–200% permanece isolado;
- screen-audio não é pausado apenas porque screen-video está em espera;
- `low` layer continua existente no contrato para uma futura estratégia de preview/adaptação por métricas.

## Validação automatizada

- 85 testes totais;
- 84 passados;
- 0 falhas;
- 1 skip de E2E real Chromium/mediasoup;
- TypeScript do cliente validado com declaração temporária do pacote externo ausente no ambiente;
- syntax check dos módulos críticos alterados: OK.

## Fase 7 ainda pendente

Esta entrega não fecha a Fase 7. Faltam benchmarks reais de CPU/RAM/banda, telemetria WebRTC usada para decisão adaptativa e validação de aceleração por hardware em Intel/NVIDIA.
