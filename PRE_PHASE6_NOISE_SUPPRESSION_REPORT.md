# Verdant LAN 0.3.9-prephase6.2 — Supressão de ruído e detecção de voz

## Escopo

Esta alteração mexe somente no caminho do **microfone local** e na interface de configurações de áudio. Não altera `server/src/media.ts`, consumidores remotos, volume individual dos participantes, áudio de transmissão de tela ou sons da interface.

## Dois modelos

### Padrão

- usa `noiseSuppression`, `echoCancellation` e `autoGainControl` do Chromium/WebRTC quando suportados;
- passa por um expander/gate local leve para permitir níveis de intensidade e detecção de voz;
- é o padrão da aplicação.

### Verdant Voice DSP

Implementação própria em `AudioWorklet`, sem código copiado de RNNoise, SpeexDSP ou WebRTC. O desenho foi inspirado em técnicas públicas desses projetos:

- estimação adaptativa do piso de ruído;
- high-pass para ruído de baixa frequência;
- downward expansion / noise gate;
- VAD com histerese e hold para evitar cortar sílabas;
- detecção de conteúdo ruidoso por energia diferencial;
- supressão de transientes curtos com foco em teclado;
- redução adicional para respiração/ruído amplo de baixa energia;
- limiter de segurança.

O modo Verdant desliga a supressão nativa do Chromium para evitar dupla supressão, mas mantém cancelamento de eco. O AGC nativo também é desligado nesse modo para tornar a estimação do piso de ruído mais previsível.

## Níveis

- Baixo
- Médio
- Alto
- Máximo

Quanto maior o nível, maior a atenuação fora de fala, mais agressivo o detector de transientes e maior a chance de sons muito baixos serem aparados.

## Detecção de voz

- desligável;
- Automática: estima o piso de ruído e deriva um limiar adaptativo;
- Manual: limiar configurável de -60 a -20 dBFS;
- hold e attack/release suaves para reduzir cortes de início/fim de palavras.

## Segurança do pipeline

O microfone físico e a track enviada ao mediasoup agora são tratados separadamente quando existe processamento. Mudanças de nível/threshold atualizam o `AudioWorklet` sem recriar a captura. Troca entre processamento ativo/inativo usa `replaceTrack()` de forma atômica e só então descarta o pipeline anterior.

## Validação executada

- suíte total: 68 testes, 67 passados, 0 falhas, 1 skip;
- skip: E2E real Chromium + mediasoup, que exige navegador e dependências instaladas;
- TypeScript: verificação sem emissão passou usando stub temporário apenas para o tipo externo `mediasoup-client`;
- sintaxe do AudioWorklet: OK;
- teste DSP offline determinístico: ruído contínuo fortemente atenuado, fala tonal preservada e transiente isolado reduzido;
- detecção manual: limiar estrito fecha e limiar sensível abre;
- auditoria estrutural do SPEC: OK;
- `server/src/media.ts`: não modificado.

## Limitação de hardware

A Web API de captura oferece flags como `noiseSuppression`, mas não expõe um seletor para obrigar o navegador a usar um DSP físico específico. O modelo Padrão prioriza o processamento nativo do Chromium/WebRTC; o modelo Verdant roda no thread de áudio via `AudioWorklet` e foi desenhado para ser leve, sem rede neural ou dependência externa.
