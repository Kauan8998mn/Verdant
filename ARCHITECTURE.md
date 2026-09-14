# Arquitetura

## Princípios

O Verdant LAN é LAN-first, self-hosted e sem dependência de cloud para operar. O host mantém SQLite, anexos, API, WebSocket e SFU. O navegador é o cliente em Linux e Windows 11.

## Core

- Node.js 22+;
- `node:sqlite` para persistência;
- HTTP/HTTPS nativo;
- WebSocket RFC 6455 local para chat, presença e sinalização;
- TypeScript no cliente e servidor;
- esbuild apenas para empacotar o frontend.

## Fases 4 e 5 — mídia

A camada de mídia usa:

- `mediasoup` no host;
- `mediasoup-client` no navegador;
- WebRTC;
- Opus para microfone e áudio da transmissão;
- VP8 preferencial e H.264 disponível no Router para vídeo;
- um `WebRtcServer` do mediasoup usando porta fixa UDP/TCP;
- um Router por servidor lógico;
- um transporte WebRTC de envio e um de recepção por cliente.

Cada peer pode possuir Producers independentes por fonte:

```text
microphone
screen-video
screen-audio
```

Fluxo de voz:

```text
Microfone
   ↓
Browser A ── WebRTC send ──> mediasoup SFU ── WebRTC recv ──> Browser B
    │                              │
    └──── WebSocket signaling ─────┘
```

Fluxo de tela da Fase 5:

```text
monitor / janela / aba
        ↓
 getDisplayMedia()
    ├─ vídeo ── Producer screen-video ─┐
    └─ áudio ── Producer screen-audio ─┼─> mediasoup SFU ─> Consumer(s)
                                      └────────────────────> outro browser
```

A sinalização compartilha o WebSocket já existente; o conteúdo de mídia não passa pelo WebSocket.

### Escopo da Fase 5

A Fase 5 implementa uma transmissão completa por canal e preserva deliberadamente o limite de **um `screen-video` ativo por canal de voz**. O servidor faz essa validação antes de aceitar um segundo Producer de tela. A Fase 6 removerá essa restrição e adicionará múltiplos streams, grid, foco e adaptação de layers.

O áudio da transmissão é independente do microfone. Se a fonte escolhida não entregar faixa de áudio, o vídeo continua sendo transmitido e o cliente informa isso ao usuário.

Os presets de resolução/FPS são preferências de captura e limites do encode. A UI também mostra os valores reais reportados pela faixa capturada, evitando afirmar que uma fonte entregou exatamente a resolução solicitada quando o navegador/sistema escolheu outra.

### Estado de voz

O servidor mantém um `VoiceRegistry` com:

- canal atual;
- nome/cargo;
- self mute;
- deafen;
- admin mute.

Mute local de outro participante não altera o remoto. O cliente pausa seu Consumer e o Consumer correspondente no host. Admin mute é separado e atua apenas no Producer do microfone.

### Active speaker

Um `AudioLevelObserver` do mediasoup observa somente Producers de microfone e transmite eventos de fala aos clientes. Áudio de compartilhamento não aciona o indicador de fala.

### Reconexão

- WebSocket possui reconnect exponencial;
- perda do WebSocket dispara recuperação da sessão de mídia;
- falha ICE tenta restart no servidor e no cliente;
- ao restabelecer sinalização, transportes/Producers/Consumers são reconstruídos;
- uma captura de tela local é encerrada durante a reconstrução e deve ser iniciada novamente, evitando manter estado fantasma.

### HTTPS

O projeto inclui geração de CA/certificado local para LAN/Hamachi e suporte a `TLS_CERT` + `TLS_KEY`. Microfone e captura remota dependem do contexto seguro fornecido por esse HTTPS.

## Rede

Portas padrão:

```text
43110/TCP      HTTPS + REST + WebSocket
43111/UDP      WebRTC preferencial
43111/TCP      WebRTC fallback
```

O SFU tenta bind em `127.0.0.1` e nos IPs detectados da LAN/Hamachi/VPN. `MEDIA_LISTEN_IPS` permite override explícito.

## Persistência

SQLite e anexos residem somente no host. Voz e vídeo são efêmeros e não são gravados.

Eventos de entrada/saída da chamada e início/fim de transmissão são registrados como mensagens de sistema no primeiro canal de texto.

## Segurança desta fase

- DTLS/SRTP via WebRTC;
- TLS para clientes remotos;
- nenhuma telemetria;
- nenhum TURN/cloud obrigatório;
- arquivos enviados nunca são executados;
- permissão `screen.share` validada no servidor, não apenas na interface;
- `streams.manage` permite encerramento administrativo de transmissão, com proteção do Dono contra Moderador;
- metadados da transmissão são normalizados/limitados antes de entrar em `appData` do SFU;
- `speaker-selection`, microfone e display capture permanecem limitados a `self` pela Permissions Policy da aplicação.

Hardening avançado, senha Argon2id e rate limits específicos adicionais permanecem para a Fase 8 conforme `SPEC.md`.

## Evolução

A Fase 6 aproveitará o modelo multi-Producer já criado para permitir até seis `screen-video` simultâneos, com grid, stream em foco e layers adaptativas, sem reescrever chat, identidade ou voz.
