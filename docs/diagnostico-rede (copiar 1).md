# Diagnóstico inicial: acesso sem VPN

## Conclusão

É viável reconstruir o Verdant para funcionar pela internet sem Radmin/Hamachi. A leitura do código indica que uma reescrita completa não é necessária apenas para remover essa exigência. Ainda não foi reproduzido o problema que motivou o abandono do projeto.

## Evidências no projeto original

- `ARCHITECTURE.md`: arquitetura LAN-first, Node.js/TypeScript, SQLite, navegador como cliente e mediasoup como servidor de mídia (SFU).
- `ONLINE.md`: já descreve acesso público sem VPN; reconhece a necessidade de conectividade direta de mídia e deixa TURN como evolução futura.
- `run-host-online-linux.sh`: configura HTTP em loopback, Caddy, origem pública e endereço anunciado de mídia.
- `Caddyfile.online`: HTTPS, autenticação básica e proxy para HTTP/WebSocket. Não encaminha a mídia WebRTC.
- `server/src/index.ts`: por padrão seleciona loopback e interfaces locais para a mídia.
- `server/src/media.ts`: cria um WebRtcServer com UDP/TCP e suporte a endereço anunciado.
- `server/src/config.ts`: configura portas e endereço público, mas não expõe configuração TURN.
- `client/src/voice.ts`: cria transportes de envio e recepção; a busca no código-fonte do cliente/servidor não encontrou configuração `iceServers`.

A VPN pode fornecer a rota entre clientes e host que falta pela internet. Isso é uma explicação arquitetural plausível, não uma confirmação da causa do incidente antigo.

## Arquitetura proposta

1. Hospedar API, mensagens, arquivos e mediasoup em um servidor publicamente acessível, com domínio e HTTPS.
2. Clientes entram pelo navegador ou aplicativo e se autenticam; sem instalar VPN e sem configurar roteador de cada participante.
3. Chat e sinalização usam HTTPS/WebSocket seguro.
4. Voz e tela usam WebRTC até o mediasoup. Um serviço TURN autenticado retransmite mídia quando a rota direta não funciona.
5. Oferecer TURN sobre TLS/TCP para redes restritivas. Planejar portas/IPs para evitar conflito com HTTPS; simplesmente colocar tudo atrás do proxy HTTP não resolve.
6. Configurar endereço público anunciado e portas de mídia no servidor. TURN não torna automaticamente um SFU privado acessível.

TURN é um intermediário de tráfego de mídia usado pelo próprio aplicativo; não requer um cliente VPN instalado. Não elimina todos os possíveis bloqueios de rede.

## O que aproveitar e o que reavaliar

Aproveitar, após validação: modelo de canais, chat, permissões, persistência, captura de tela, transportes mediasoup e reconexão. Reavaliar configuração de rede, implantação, autenticação pública, credenciais temporárias TURN, limites de uploads, manutenção e diagnóstico de falhas.

O projeto declara foco em até seis pessoas. Uma experiência maior, semelhante ao Discord em escala, exige dimensionamento próprio; não se deve presumir que a versão atual já suporta isso.

## Etapas sugeridas

1. Executar a versão antiga isoladamente e registrar o que funciona e o que falha.
2. Definir tamanho do grupo, hospedagem e objetivo de interface; decidir entre migração gradual e reescrita por motivos além da rede.
3. Criar uma base reproduzível de desenvolvimento e implantação, sem copiar banco, anexos ou credenciais reais por padrão.
4. Implementar configuração pública e TURN com credenciais temporárias; validar autenticação e reconexão.
5. Testar dois clientes em redes diferentes, voz bidirecional, tela, anexos e entrada por convite; testar também UDP bloqueado e conexão forçada por relay.
6. Só considerar a remoção da dependência de VPN comprovada após esses testes externos.

## Infraestrutura

Para acesso previsível entre redes, precisa existir infraestrutura alcançável na internet. Um servidor público evita depender da conectividade residencial do host. Hospedagem e tráfego, principalmente tela/vídeo e relay, podem ter custo recorrente. Não foram escolhidos fornecedor, plano ou orçamento, nem foi publicado qualquer serviço.

## Fontes técnicas

- [WebRTC: servidores TURN](https://webrtc.org/getting-started/turn-server)
- [mediasoup-client: API e opções dos transportes](https://mediasoup.org/documentation/v3/mediasoup-client/api/)

## Validação desta análise

Leitura dos arquivos e busca de configuração de rede no código-fonte. Nenhum teste funcional, auditoria completa de segurança ou teste entre redes externas foi executado nesta etapa.
