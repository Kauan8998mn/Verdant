# Verdant LAN 0.3.8-stress.3 — Sons, configurações e toggle global

Base: `verdant-lan-0.3.8-superstress.2-individual-volume` fornecida pelo usuário.

## Escopo aplicado

Somente alterações necessárias para integrar os MP3 fornecidos, reorganizar as configurações locais e substituir os dois botões globais “Mutar todos para mim” / “Ouvir todos” pelo toggle solicitado.

### Sons integrados

- Mensagem recebida
  - padrão: `clicksoundeffect.mp3`
  - alternativa: `dog-clicker.mp3`
- Começou a transmitir: `steam-deck-enter-game.mp3`
- Saída do canal/servidor: `enter-da-game.mp3`
- Parou de transmitir: `switch-sound.mp3`

Os cinco arquivos foram copiados byte a byte do ZIP fornecido.

## Regras dos eventos

- Mensagem: toca somente para mensagem de usuário enviada por outra pessoa.
- Saída do canal de voz: toca quando outro participante sai do canal em que o cliente continua conectado.
- Saída do servidor: usa a presença WebSocket e aguarda 1,8 s antes de tocar, cancelando o aviso se a pessoa reconectar rapidamente.
- Saída do canal e saída do servidor para a mesma pessoa possuem deduplicação de 2,5 s para evitar dois toques pelo mesmo desligamento.
- Início/fim de transmissão: toca somente para quem já permanece na chamada quando o compartilhamento realmente começa/termina. Entrar numa chamada onde uma transmissão já existia não gera falso “início”.

## Configurações

O menu agora possui navegação lateral em quatro páginas:

- Geral
- Áudio
- Notificações
- Aparência

Preferências de sons são locais (`verdant.ui-sounds.v1`) e incluem:

- liga/desliga geral;
- volume mestre;
- liga/desliga por evento;
- volume por evento;
- seleção entre os dois sons de mensagem;
- botão de teste por evento.

A aparência já existente continua local. O volume individual por participante continua no card de cada participante e não foi alterado.

## Toggle do globo

Os botões “Mutar todos para mim” e “Ouvir todos” foram removidos da interface.

No lugar há um único botão com ícone de globo:

- cor do tema: todos podem ouvir o usuário;
- vermelho: ninguém pode ouvir o usuário;
- novo clique: retorna ao estado anterior.

Ele usa o mesmo `voice.toggleMute()` já existente; não cria um segundo mecanismo de mute.

## Preservação do pipeline de voz

`client/src/voice.ts` não foi modificado.

SHA-256 antes/depois:
`6163d789d3dd3557137e21c298dcb8ede3b31dba408483ce1e5c3372c3a5a540`

`server/src/media.ts` não foi modificado.

SHA-256 antes/depois:
`e2fb8258bba588b8d75a104be8a4bc7e7db496fdda9fe52bc45f54e358996c69`

Os sons de interface usam `HTMLAudioElement` separado. Não foram introduzidos `AudioContext`, `GainNode`, `getUserMedia`, `replaceTrack`, Producer ou Consumer no sistema de efeitos.

## Arquivos de produto alterados

- `client/src/main.ts`
- `client/src/ws.ts`
- `client/src/ui-sounds.ts` (novo)
- `client/src/ui-event-tracker.ts` (novo)
- `client/public/styles.css`
- `client/public/sounds/**` (novos MP3)
- `scripts/build.mjs`
- `server/src/static-files.ts`
- `server/src/routes.ts` (somente versão reportada)
- `package.json` (somente versão)
- `README.md` (identificação/relatório)

Também foram adicionados/ajustados testes relativos ao novo comportamento.

## Validação executada

- suíte: 54 testes;
- passaram: 53;
- falharam: 0;
- pulado: 1 (`mediasoup` + Chromium real, que exige dependências/build/browser local);
- TypeScript do cliente: sem erros com declaração temporária apenas para suprir o módulo `mediasoup-client` ausente no ambiente de empacotamento;
- sintaxe dos arquivos de servidor/build alterados: OK;
- auditoria do SPEC: 1596 linhas relidas, SHA-256 preservado, auditoria estrutural OK;
- hashes de `voice.ts` e `media.ts`: idênticos à base.

O ambiente de empacotamento não possuía `node_modules`, portanto não foi declarado um `npm run build` real nem E2E de mídia como validado. No host, `run-host-linux.sh`/`run-host-windows.ps1` continuam responsáveis pela instalação/build normal.
