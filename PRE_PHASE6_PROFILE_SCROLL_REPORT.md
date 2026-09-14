# Verdant LAN 0.3.9-prephase6.1 — relatório pré-Fase 6

## Base

Alterações aplicadas sobre o pacote `verdant-lan-0.3.8-superstress.5-chromium-ui(1).zip` fornecido pelo usuário.

## 1. Correção do salto do chat

O fluxo anterior de atualização ainda podia substituir todos os nós de mensagem em uma atualização e a UI Chromium usava rolagem suave/scroll anchoring. Essa combinação fazia o navegador perder ou reinterpretar a âncora durante envio, anexos e carregamento assíncrono de imagens.

Nesta versão:

- a lista de mensagens usa reconciliação incremental por chave de renderização;
- nós já existentes permanecem no DOM quando a mensagem não mudou;
- somente nós novos, editados ou removidos são inseridos/substituídos/removidos;
- quando o usuário está lendo mensagens antigas, `scrollTop` é preservado;
- quando estava no fim, a lista permanece no fim após o patch e após o próximo frame;
- imagens inline só forçam o fim se o usuário ainda estiver no estado `scrollPinned`;
- `.messages` usa `scroll-behavior: auto` e `overflow-anchor: none` para evitar conflito do Chromium com o controle explícito do scroll.

## 2. Fotos de perfil

- tabela SQLite `member_profiles`, indexada por servidor + nome normalizado;
- foto associada ao usuário da sessão e não a um alvo arbitrário enviado pelo cliente;
- endpoint autenticado para listar perfis e endpoint autenticado para editar apenas o próprio avatar;
- PNG/JPEG/WebP aceitos; SVG rejeitado;
- validação de MIME, base64, tamanho e magic bytes no servidor;
- preparação Chromium-first por `createImageBitmap`, recorte quadrado central e WebP 256×256 no cliente;
- avatar renderizado em mensagens, lista de membros, call, mini-lista de voz, barra do usuário e configurações;
- remoção da foto preserva o perfil e volta às iniciais.

As fotos são host-local e específicas daquele servidor Verdant. Não há conta online ou serviço externo.

## 3. Aparência e glow de fala

A aba Aparência agora possui:

- cor personalizada e presets rápidos;
- overlay/transparência;
- blur de painel configurável;
- escala da interface;
- cor própria para glow de fala;
- presets rápidos de glow;
- intensidade configurável;
- preview ao vivo.

As preferências visuais permanecem locais ao cliente.

## 4. Isolamento do áudio

Nenhuma alteração foi feita no pipeline de voz desta rodada. Os hashes esperados ao empacotar são:

- `client/src/voice.ts`: `6163d789d3dd3557137e21c298dcb8ede3b31dba408483ce1e5c3372c3a5a540`
- `server/src/media.ts`: `e2fb8258bba588b8d75a104be8a4bc7e7db496fdda9fe52bc45f54e358996c69`

## 5. Validação automatizada

- suíte Node completa: 62 testes; 61 passaram; 0 falharam; 1 pulado;
- o skip é o E2E de mídia real que requer dependências npm instaladas, build do cliente e Chromium local;
- `node --experimental-strip-types --check` passou nos arquivos TypeScript críticos alterados;
- `tsc --noEmit` passou usando somente uma declaração temporária do módulo ausente `mediasoup-client`; essa declaração não faz parte do pacote;
- o `npm install` do ambiente de empacotamento não concluiu dentro do limite disponível, então não foi alegado build esbuild real;
- SPEC relido integralmente: 1596 linhas, SHA-256 `d50891340d8d26819b3fd84e82bf22b7712f9c7c9f96dc4fd4a3e8a958d37b35`;
- auditoria estrutural: OK;
- `audit --phase=5`: estruturalmente OK, porém o SPEC ainda não marca a Fase 5 como concluída.

## 6. Gate antes da Fase 6

Antes de iniciar multistream, validar em pelo menos dois clientes reais:

1. enviar texto repetidamente sem o chat saltar para o topo;
2. enviar imagens/anexos e aguardar previews sem perder a posição;
3. editar/responder mensagens;
4. definir/trocar/remover fotos de perfil e confirmar propagação no outro cliente;
5. mudar presets/blur/glow e confirmar que são locais;
6. entrar em voz e compartilhar tela para confirmar que o áudio da baseline continua intacto.

Somente após esse teste manual o projeto deve avançar para a Fase 6.
