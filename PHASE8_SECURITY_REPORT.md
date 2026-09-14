# Fase 8 — Segurança e experiência de mídia

Versão: `0.5.0-phase8-security`

## Segurança

- Senha opcional por servidor, derivada com `scrypt` e salt aleatório de 128 bits.
- Comparação em tempo constante; texto da senha nunca é persistido.
- Sessões válidas podem retomar sem solicitar novamente a senha.
- Rate limiting separado para criação/entrada e tráfego HTTP geral.
- Limites de payload, validação server-side, CSP, Permissions Policy, proteção de host/origin e permissões por cargo preservados.
- WebSocket continua limitado por conexão e agora diferencia conexões de aplicação e voz.

## Transmissões

- Botão nativo de tela cheia por transmissão usando Fullscreen API.
- Tela cheia ocupa o viewport sem exigir os controles nativos do elemento `<video>`.
- Mute individual explícito por transmissão, isolado da voz e do mute global.

## Voz persistente entre servidores

- Navegação e mídia usam conexões WebSocket independentes.
- Trocar o servidor visível não executa mais `voice.leave()`.
- O servidor aceita uma conexão `app` e uma conexão `voice` para a mesma sessão.
- A mídia só é desmontada quando a última conexão daquela sessão fecha.
- Entrar em voz em outro servidor encerra conscientemente a chamada anterior.

## Observação criptográfica

O planejamento antigo citava Argon2id. Esta base suporta Node.js 22 sem dependência nativa adicional; por compatibilidade e instalação confiável em CachyOS/Zorin/Windows, esta entrega utiliza `crypto.scrypt` com parâmetros de custo fixos, salt aleatório e comparação constante. Não há armazenamento reversível de senha.
