# Estado da migração — retomada em 2026-09-17

Branch: `migration/public-server`. Auditoria original: `a8ae4fd`.
Implementação recuperada e consolidada: `0bc132b`. Nenhuma alteração anterior
foi descartada. A auditoria histórica integral está preservada abaixo.
Ajustes de renovação ICE, recuperação e testes ampliados: `0e3546e`.

## Implementado

- Sessão HTTP em `X-Verdant-Session`, mantendo Bearer para clientes existentes;
  Caddy mantém Basic individual e sobrescreve identidade/IP do cliente.
- Histórico/canais exigem sessão do servidor; identidade persistente impede
  recuperar cargos públicos por apelido. Nomes legados exigem vínculo offline.
- Produção exige HTTP loopback, origem HTTPS e IPv4 anunciado público validado;
  health mínimo, bootstrap sem interfaces internas, rate limit pelo IP do proxy.
  Fora de produção, o bind LAN original e os aliases antigos são mantidos.
- Credenciais TURN HMAC temporárias, policy/transport de diagnóstico e renovação
  no cliente; reconexão de voz conserva o contexto original da chamada.
- Worker unhealthy encerra a aplicação com erro para systemd reiniciar;
  build JS de produção, Caddy/TLS, Coturn, certificados, releases e backup.

## Evidência local já concluída

Ambiente Linux x64, Node 24.21.0 isolado em
`~/.local/share/verdant-tools/node-v24.21.0-linux-x64`; Python venv existente em
`~/.local/share/verdant-tools/python` (Python 3.14.7). O worker mediasoup 3.26.0
compilado está presente e foi executado nos testes; a falha de binário ausente
não se reproduziu na retomada.

- Build cliente/servidor/configurador e auditoria estrutural passaram.
- Verificação final `npm run check` com proxy, Coturn e browser obrigatórios:
  **97 testes aprovados, zero falhas e zero testes pulados**; build e auditoria OK.
- Suíte inicial recuperada: 95 testes, 93 aprovados, dois pulados (browser sem
  caminho no comando geral e TURN opt-in). O teste adicional de expiração de
  sessão também passou.
- Caddy real local: Basic + sessão, histórico/upload e isolamento de identidade
  no upgrade WebSocket aprovados pela suíte.
- E2E obrigatório com dois Chromiums: áudio bidirecional e tela/áudio via SFU.
- Coturn real: ChannelData UDP/TCP/TLS e credencial vencida recusada.
- systemd isolado: sandbox, reinício após matar worker, parada limpa,
  backup SQLite íntegro e restauração de mensagens/anexos/bytes originais.
- Coturn no sandbox systemd e sincronização de certificados: hostname inválido
  recusado, permissões verificadas, certificado inalterado sem restart,
  certificado renovado com restart e timer ativo. Recursos de QA removidos.
- UI operada com agent-browser: criar servidor, enviar, editar/cancelar e
  preservar rascunho anterior.

- E2E ampliado: send/recv com candidato relay nos dois browsers por TURN UDP e
  TCP, bytes RTP crescentes, tela/áudio e frames de vídeo decodificados.
- Chamada TCP além do TTL real de 120 s: credenciais renovadas, ambos os
  transports reiniciaram ICE e RTP continuou. Reconexão da voz também passou
  mantendo servidor/canal original enquanto o cliente navegava outro servidor.

Detalhes e comandos reproduzíveis em `docs/TESTING.md`.

## Pendente para liberação pública

VM/SSH/domínios não fornecidos na retomada. VM Oracle, DNS/ACME, firewall,
clientes em redes distintas, relay externo, UDP bloqueado, reboot real, ARM64 e
carga sustentada de 2–6 usuários continuam **não validados**. Os scripts e o
roteiro de `docs/DEPLOY_ORACLE.md` não substituem esses gates.

---

# Fase 0 — auditoria antes da migração (registro original)

## Fonte e método

Base: `verdant-lan-0.5.0-phase8-security`, preservada no commit inicial desta branch. Leitura integral dos componentes de servidor, configuração, autenticação, uploads, WebSocket, mídia, cliente de voz e API; mapeamento das referências de rede e dos pontos de entrada da UI. Documentação histórica contém estados contraditórios: o código prevalece. Dados pessoais, certificados, logs e dependências instaladas não foram copiados para Git.

## CONFIRMADO PELO CÓDIGO

- npm, lockfile v3; Node declarado >=22.13.0; TypeScript 5.8.3; esbuild 0.28.2; mediasoup 3.26.0; mediasoup-client 3.22.0; puppeteer-core 25.8.0. Versões instaladas de mídia coincidem com o manifesto.
- Build atual compila apenas cliente; produção antiga executa TypeScript diretamente.
- HTTP/API/WS 43110 TCP; WebRtcServer único 43111 UDP/TCP; um worker, um Router por servidor lógico; SQLite WAL e anexos locais.
- `index.ts` enumera interfaces locais quando MEDIA_LISTEN_IPS não foi especificado. `media.ts` aceita announcedAddress e pode anunciar somente esse endereço. TCP e UDP já existem.
- Fluxo: voice.join -> Router capabilities -> Device.load -> transport.create(send/recv) -> createSendTransport/createRecvTransport -> evento connect -> transport.connect(DTLS) -> producer.create -> anúncio -> consumer.create pausado -> consume -> consumer.resume.
- TransportOptions 3.22.0 aceita iceServers/iceTransportPolicy; Transport oferece updateIceServers. Nenhum iceServers é fornecido pela aplicação original.
- Caddy online faz basic_auth e proxy HTTP, não mídia. Cliente usa Authorization Bearer: conflita com basic_auth do proxy, que espera Basic nessa mesma requisição.
- Auth de servidor: senha opcional scrypt; tokens aleatórios em memória e localStorage; WebSocket transporta token na URL. Cargos persistidos por apelido: qualquer participante pode recuperar cargo de apelido livre após expiração/reinício. Não existe identidade individual comprovada.
- GET de histórico e canais não exige sessão. Bootstrap/health divulgam interfaces locais. Rate limit usa socket.remoteAddress, portanto agrega todos os usuários atrás de Caddy. Logger só filtra chaves do primeiro nível.
- Upload: streaming, UUID.blob, modo 0600, verificação de caminhos, sniff de MIME, grants de 60s; limite fixo 500 MiB no cliente e servidor. Persistência e permissões são aproveitáveis.
- WebSocket da voz independente da navegação existe. Porém recuperar chamada usa servidor visual atual; trocar canal chama leave depois de conectar WS, podendo desligar a sinalização recém-aberta.
- Tela: presets de 360p a 1080p, 30/60 FPS; padrão atual 720p30; tracks screen-video e screen-audio separadas; feature detection e aviso quando áudio não é capturado; fullscreen e mute individual existem. Limite atual de quatro telas simultâneas é mantido.
- Falha do worker só gera log; health continua declarando sucesso. Reconexão WS não tem limite e não detecta ausência prolongada de pong.

## Reaproveitar

UI, canais, cargos, mensagens, esquema SQLite, upload/grants, SFU, codecs, captura, DSP, mute, volume local, fullscreen, políticas de assinatura de tela e separação app/voice. Mudanças focadas em configuração pública, identidade mínima segura, TURN, diagnóstico, recuperação e operação.

## HIPÓTESES

Anunciar interfaces privadas e não ter relay explica falhas entre redes, mas não há captura do incidente antigo. Não afirmar causa única. Ver ROOT_CAUSE.md.

## AINDA NÃO TESTADO nesta fase

VM pública, DNS, ACME, ARM64, firewall Oracle, redes fisicamente distintas, TURN, UDP bloqueado, reboot e capacidade 2–6. O ambiente local tem Node 26 e não tem npm no PATH; será usado Node 24 LTS isolado para validação. Estes testes não podem ser substituídos por localhost.

## Decisões para a implementação

- Produção exige loopback HTTP, HTTPS público e endereço anunciado IPv4 público (ou DNS resolvido e validado), sem descoberta LAN.
- Manter Caddy e usar uma credencial individual por pessoa, com identidade do proxy sobrescrita e vinculada no banco ao apelido; sessão da aplicação passa em X-Verdant-Session para não colidir com Basic. Nomes legados exigem vínculo administrativo explícito, nunca apropriação automática.
- Implantação em VM pública única; Node 24 LTS fixado, build JS, systemd, Coturn opcional até validação direta, depois TURN temporário HMAC.
- Etapas de código podem ser preparadas localmente; gates de validação externa permanecem pendentes até existir VM/domínio e clientes externos disponíveis.
