# Verdant LAN 0.3.8-stress.4 — Chat hardening

Base: `0.3.8-stress.3` enviada pelo usuário.

## Escopo aplicado

- Corrige o Ctrl+V duplicado preferindo `DataTransfer.files` quando o navegador também expõe o mesmo payload em `DataTransfer.items`.
- Arquivos/imagens colados ou escolhidos ficam preparados acima do composer e não são enviados imediatamente.
- O envio de um lote de anexos exige uma única confirmação.
- O texto digitado com anexos funciona como legenda do primeiro arquivo do lote; os demais arquivos permanecem mensagens de anexo do mesmo lote.
- Até 12 anexos podem ser preparados por lote; o limite de 500 MB por arquivo permanece.
- Mensagens próprias podem ser editadas. Mensagens de terceiros não podem ser editadas nem mesmo pelo Dono.
- Legendas de mensagens com anexo podem ser editadas ou removidas.
- Edições explícitas exibem `(editada)` discretamente e persistem `edited_at` no SQLite.
- A legenda aplicada no envio inicial do anexo não é marcada artificialmente como edição.
- Qualquer mensagem visível pode ser usada como alvo de resposta; a referência é persistida em `reply_to_id` e exibida acima da mensagem.
- Ao clicar na referência de resposta, o cliente tenta localizar a mensagem original no trecho carregado.
- O histórico de mensagens passou a ser atualizado dentro de `#messages`, sem recriar o composer a cada mensagem/arquivo recebido. Isso protege foco, textarea e barra de digitação durante uploads e mensagens simultâneas.

## Banco e compatibilidade

A migração é incremental. Bancos existentes recebem, se ausentes:

- `messages.edited_at`
- `messages.reply_to_id`

Nenhuma tabela existente é apagada.

## Áudio

Nenhum arquivo do pipeline de voz/mídia foi alterado nesta atualização. Os hashes de `client/src/voice.ts`, `server/src/media.ts` e `client/src/ui-sounds.ts` foram comparados antes/depois da mudança.

## Validação executada

- suíte `node --experimental-strip-types --test tests/*.test.ts`: 58 testes, 57 passaram, 1 E2E de mídia foi pulado por depender de Chromium/mediasoup instalados;
- testes reais de servidor para reply, edição por autor, bloqueio de edição alheia e legenda editável;
- testes unitários específicos para deduplicação do clipboard;
- verificação de sintaxe Node/TypeScript dos arquivos alterados;
- verificação TypeScript com stub temporário apenas para a dependência ausente `mediasoup-client` no ambiente de empacotamento;
- migração real de um banco criado pela versão anterior para o novo schema, preservando mensagem existente e aceitando reply após a migração;
- auditoria do SPEC: 1596 linhas processadas, auditoria estrutural OK.

O E2E de mídia com Chromium/mediasoup continua fora do escopo desta mudança e permanece skip quando as dependências locais do navegador não estão disponíveis.
