# Validação executada — 0.3.8-stress.1

Data do pacote: 2026-08-19.

## Executado neste ambiente

- `node --experimental-strip-types --test tests/*.test.ts`
  - 46 testes
  - 45 passaram
  - 0 falharam
  - 1 skip: E2E Chromium + mediasoup real
- TypeScript do cliente: `tsc -p client/tsconfig.json --noEmit` com declaração temporária local apenas para o módulo `mediasoup-client`; a declaração foi removida após o teste.
- `node --experimental-strip-types --check` nos arquivos críticos alterados.
- `bash -n` nos launchers Linux.
- servidor real com `MEDIA_DISABLED=1`: `/api/health` respondeu versão `0.3.8-stress.1`.
- modo público local: Host inválido retorna 421 e headers CSP/X-Frame/no-sniff/referrer/permissions foram confirmados.
- `node scripts/spec-audit.mjs`: 1596 linhas, SHA-256 `d50891340d8d26819b3fd84e82bf22b7712f9c7c9f96dc4fd4a3e8a958d37b35`, Fases 0–4 marcadas concluídas, auditoria estrutural OK.
- paridade de `client/src/voice.ts`: SHA-256 `f20952aeb44db9f34c03e1935a843ebcb71d513962104c4300c09428db514082`, idêntico ao arquivo da base 0.3.3.

## Não validado / não assumido

- `npm install` completo e `npm run build` neste ambiente: tentativa de instalação excedeu o limite de tempo; portanto não é declarado como validado aqui.
- Chromium/Firefox com mídia real.
- host Windows real; `pwsh` não estava disponível para parse/execução dos scripts PowerShell.
- Caddy real e emissão ACME com domínio público.
- roteador/NAT/CGNAT real.
- WebRTC entre duas redes externas reais.

Esses itens precisam de validação no host do usuário e não foram marcados como concluídos por inferência.


---

## Validação adicional — 0.3.9-prephase6.3

- suíte completa: 70 testes;
- 69 passaram;
- 0 falharam;
- 1 skip: E2E real Chromium + mediasoup;
- typecheck do cliente: OK usando shim temporário somente para `mediasoup-client`;
- módulo de boost importado/testado pelo Node: OK;
- 0–100% sem Web Audio adicional: verificado por teste/regressão;
- 101–200% limitado a ganho remoto isolado: verificado por teste/regressão;
- fallback para 100% antes/depois de falhas de reprodução: presente e testado estruturalmente;
- arquivos críticos de microfone/servidor: hash idêntico à entrada;
- SPEC: 1596 linhas, auditoria estrutural OK.

O teste real audível em múltiplos clientes Chromium continua obrigatório antes de marcar este gate como validado em hardware real.

---

## Validação adicional — 0.4.0-phase6.1

Executado no worktree final da primeira entrega da Fase 6:

- suíte Node completa: 80 testes, 79 passados, 0 falhas, 1 skip;
- o skip continua sendo o E2E que depende de Chromium + mediasoup + mídia real;
- parsing/syntax check dos módulos alterados de cliente e servidor: OK;
- typecheck do cliente: OK com declaração temporária somente para o módulo externo `mediasoup-client`; a declaração não faz parte do pacote;
- política de grade/foco, seleção de camadas e estrutura dos três encodings simulcast: cobertas por testes;
- regressão dos módulos separados de microfone, noise suppression e boost remoto 200%: hashes preservados em teste;
- `npm install` foi tentado neste ambiente, mas excedeu 180 s e não produziu `node_modules`; portanto um build real com esbuild/mediasoup não é declarado como validado aqui.

Ainda obrigatório em hardware real antes de concluir a Fase 6:

1. dois clientes Chromium transmitindo ao mesmo tempo;
2. grade mostrando ambas as telas;
3. troca repetida de foco e retorno à grade;
4. confirmação de que vídeo fora de foco pausa/retoma sem matar o áudio;
5. mute de áudio por transmissão e mute global;
6. encerramento de uma transmissão sem afetar as demais;
7. microfone, supressor de ruído e volume remoto 0–200% permanecendo funcionais durante o teste.


## Validação adicional — 0.4.1-phase7.1

Executado no worktree da primeira rodada da Fase 7:

- suíte Node completa: 85 testes, 84 passados, 0 falhas, 1 skip;
- skip: E2E que depende de Chromium + mediasoup + mídia real;
- TypeScript do cliente: OK com shim temporário somente para o módulo externo `mediasoup-client`; o shim foi removido após o check;
- parsing/syntax check de `main.ts`, `voice.ts`, `voice-ui.ts`, `render-policy.ts` e `server/src/media.ts`: OK;
- política de vídeo sob demanda em grid/foco: coberta por testes;
- deduplicação de `pause/resume/quality`, limite de quatro screens e isolamento de render por speaking: cobertos estruturalmente;
- Fase 6: marcada concluída após validação prática reportada pelo usuário em 19/08/2026.

Ainda não declarado como concluído na Fase 7:

1. benchmark comparativo real de CPU e RAM antes/depois;
2. medição real de bitrate/packet loss/RTT/jitter durante multi-stream;
3. validação de hardware acceleration em Intel iGPU e NVIDIA dGPU;
4. adaptação automática guiada por métricas de congestionamento;
5. build com dependências npm instaladas neste ambiente de empacotamento.
