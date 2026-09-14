# Verdant LAN 0.3.9-prephase6.3 — Volume individual até 200%

## Objetivo

Adicionar ganho local de até 200% por participante sem reintroduzir o problema histórico em que o caminho de áudio remoto ficou dependente de Web Audio e a chamada passou a apresentar falhas graves.

## Diagnóstico histórico

Foi comparado o código desta versão com o backup 0.3.6 que continha a antiga tentativa de volume acima de 100%.

Na 0.3.6, todo áudio remoto era roteado permanentemente por um `AudioContext`, inclusive quando o volume estava em 100% ou abaixo:

`Consumer track -> MediaStreamAudioSourceNode -> GainNode -> MediaStreamAudioDestinationNode -> HTMLAudioElement`

Além disso, o `HTMLAudioElement.srcObject` deixava de apontar diretamente para a track recebida e passava a depender do stream gerado pelo Web Audio.

Isso criava um ponto de falha desnecessário: suspensão/bloqueio do `AudioContext`, autoplay ou falha no grafo podia retirar completamente a reprodução remota. Não é possível provar retrospectivamente que esse desenho foi a causa única do bug de microfones daquela versão, então isso não é declarado como causa confirmada; é tratado como o principal acoplamento perigoso encontrado e foi deliberadamente evitado.

## Arquitetura desta versão

### 0%–100%

Permanece exatamente no caminho simples do Chromium:

`Consumer track -> HTMLAudioElement`

O volume usa apenas `HTMLAudioElement.volume`.

Nenhum `AudioContext`, `GainNode`, clone de track ou DSP adicional é criado.

### 101%–200%

Somente quando o usuário pede boost:

`Consumer track`
`  -> clone()`
`  -> MediaStreamAudioSourceNode`
`  -> GainNode`
`  -> DynamicsCompressorNode/limiter`
`  -> MediaStreamAudioDestinationNode`
`  -> HTMLAudioElement auxiliar`

A track original recebida do mediasoup permanece intacta.

O ganho máximo é 2.0, equivalente a aproximadamente +6.02 dB.

Foi adicionado limiter leve antes da saída para reduzir clipping em picos.

## Fail-safe

O áudio direto nunca é silenciado antes de o caminho de boost estar criado e reproduzindo.

Se ocorrer qualquer uma destas situações:

- `AudioContext` não puder iniciar;
- autoplay bloquear a saída auxiliar;
- contexto ficar suspenso;
- criação do grafo falhar;

o Verdant remove o boost e mantém o participante audível em 100%.

Portanto, falhar em conseguir 200% não deve transformar o participante em silêncio.

## Isolamento do microfone

Os seguintes arquivos críticos permaneceram byte por byte idênticos à entrada 0.3.9-prephase6.2:

- `client/src/microphone-processing.ts`: `ed22ccf3c9792491c896b54b82406164a73404f5e8b8c42750cb73686f6db234`
- `client/src/voice-audio-preferences.ts`: `dab0a2a8db948b46351202c5797ceee5ed672b9a36a6d8b7e48fdfa002c1205e`
- `client/public/audio/verdant-noise-worklet.js`: `aac371dd4bb4eb3dd588fcbe929dd1d4973097b6b8fedc15efdd9d5998e3f411`
- `server/src/media.ts`: `e2fb8258bba588b8d75a104be8a4bc7e7db496fdda9fe52bc45f54e358996c69`
- `server/src/media-contract.ts`: `debaa93541ec8a633ae63ea9feba307fb94abef3cddc218d39dba390d22ed137`
- `server/src/voice-registry.ts`: `076b5db93dde6f64d8d95b6a6bd4bf62c51e3116127ab8587dc7622085c98e56`

Também foram comparados blocos críticos dentro de `client/src/voice.ts`. Permaneceram byte por byte iguais:

- `applyAudioPreferences`: `43c0f971e923bb7bea4ecdc668c84f95dfdcecddbe42c34fbf604c1a31dda03c`
- fluxo `join` / mute / deafen / troca de entrada: `ef211dba4cf7237dfc918b3cf5f7b563ea219094baf36a6c27af14661b6915f0`
- `#openMicrophone`: `0f6c6a1676b51878bb313cac01b280a1786050fd55c2fdfa9a64a8a6baa699b5`
- `#createMicPipeline`: `b58f33d15244210458832b1524d8c4da886bda6e897c1dc53b57bb70984cfa98`
- `#applyMicTrackState`: `a9ac79d14e32fe7b7020570ef3f4919c73e208f824ccf3e6f7314c615c7dd135`

O módulo novo `client/src/remote-playback-boost.ts` não contém `getUserMedia`, `replaceTrack`, Producer ou lógica de microfone.

## Comportamento de interface

O slider individual passa a aceitar 0–200%.

Acima de 100% a interface mostra também o ganho aproximado em dB, por exemplo:

- 125% ≈ +1.9 dB
- 150% ≈ +3.5 dB
- 175% ≈ +4.9 dB
- 200% ≈ +6.0 dB

O valor continua local e persistente por servidor + participante.

A configuração de Rafael não muda o volume que qualquer outro cliente usa para Rafael.

## Mudanças de código

A implementação funcional altera somente:

- `client/src/remote-playback-boost.ts` — módulo novo e isolado;
- `client/src/voice.ts` — ligação do módulo apenas à reprodução de Consumers remotos;
- `client/src/main.ts` — slider 0–200% e rótulo em dB;
- `client/public/styles.css` — espaço visual para o novo valor;
- `tests/individual-volume.test.ts` — regressões específicas;
- documentação/manifesto/versão.

Não há mudança no servidor de mídia, codecs, captura, supressor, transmissão de tela ou sinalização.

## Validação executada

- `npm test`: 70 testes; 69 passaram; 0 falharam; 1 skip.
- Skip: E2E real Chromium + mediasoup requer dependências npm instaladas/build completo.
- `tsc --noEmit -p client/tsconfig.json`: passou usando declaração temporária apenas para o módulo externo `mediasoup-client`; o shim foi removido depois.
- testes específicos de volume: 3/3 passaram.
- auditoria integral do SPEC: 1596 linhas, SHA-256 `d50891340d8d26819b3fd84e82bf22b7712f9c7c9f96dc4fd4a3e8a958d37b35`, auditoria estrutural OK.
- comparação byte a byte dos arquivos e blocos críticos de microfone: OK.

Foi tentado um harness headless de Web Audio em Chromium, mas o processo não concluiu no ambiente de empacotamento. Portanto não é declarado como validação real de áudio audível.

## Teste manual recomendado antes da Fase 6

Com dois ou três clientes Chromium reais:

1. confirmar conversa normal em 100%;
2. mover um participante para 125%, 150%, 175% e 200%;
3. enquanto o boost está ativo, mutar/desmutar o participante localmente;
4. deafen/undeafen;
5. trocar dispositivo de saída;
6. baixar de 200% para 100% e depois 50%;
7. falar simultaneamente e confirmar que o microfone local continua chegando aos outros;
8. habilitar/desabilitar supressão de ruído e confirmar que o boost remoto não interfere;
9. reconectar à chamada com um volume acima de 100% salvo;
10. verificar que eventual bloqueio de Web Audio cai para 100% em vez de ficar mudo.

Depois desse teste real, esta alteração pode ser considerada o último gate de áudio antes da Fase 6.
