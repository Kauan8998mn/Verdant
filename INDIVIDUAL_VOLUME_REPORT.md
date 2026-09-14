# Verdant LAN — Volume individual local

## Estado atual: 0.3.9-prephase6.3

Cada cliente pode controlar localmente cada outro participante entre 0% e 200%.

- 0–100%: reprodução direta pelo `HTMLAudioElement`.
- 101–200%: boost Web Audio isolado sobre uma **cópia da track remota**, com limiter.
- 200% corresponde a aproximadamente +6.02 dB de ganho linear.
- a configuração é salva em `localStorage` por servidor e nome do participante.
- mute local, deafen e saída de áudio continuam respeitados.
- nenhuma configuração é transmitida ao servidor nem altera o que os outros clientes escutam.

## Regra de estabilidade

O caminho direto do Consumer é preservado e continua sendo a fonte de fallback.

O Verdant só zera o volume do elemento direto depois que a saída de boost foi criada e conseguiu iniciar. Se Web Audio ou autoplay falhar, o boost é descartado e o participante permanece em 100%.

O boost não usa `getUserMedia`, não toca na track local do microfone, não chama `replaceTrack()` e não modifica Producer, Opus ou mediasoup.
