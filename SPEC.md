# MISSÃO

Projete e implemente uma plataforma privada de comunicação em tempo real, inspirada funcionalmente na experiência do Discord, destinada a grupos pequenos conectados por **LAN ou VPN virtual, como Hamachi**.

A aplicação deverá ser acessada principalmente pelo **navegador**, funcionar em **Linux e Windows 11** e operar sem depender de infraestrutura pública externa para suas funções principais.

Não produza apenas um protótipo visual ou mockup.

Construa uma aplicação funcional, modular, executável e progressivamente testável.

Você possui autonomia para tomar decisões técnicas secundárias. Não solicite confirmação para decisões triviais de implementação. Pergunte somente quando existir uma ambiguidade que realmente impeça o desenvolvimento ou quando duas alternativas produzirem consequências arquiteturais substancialmente diferentes.

---

# 1. OBJETIVO PRINCIPAL

Criar uma plataforma privada semelhante conceitualmente ao Discord para um grupo máximo de **6 usuários simultâneos**, oferecendo:

- servidores;
- canais de texto;
- canais de voz;
- chat persistente;
- chamadas de voz;
- múltiplas transmissões de tela simultâneas;
- áudio compartilhado junto da transmissão;
- envio de arquivos;
- sistema simples de cargos e permissões;
- operação pela LAN;
- operação através de Hamachi ou VPN equivalente;
- ausência de dependência obrigatória de nuvem;
- privacidade por padrão.

A máquina que criar o servidor deverá funcionar como **host da infraestrutura daquele servidor**.

---

# 2. MODELO CLIENTE/SERVIDOR

A aplicação deverá utilizar uma arquitetura onde:

```
Cliente Linux ─┐
Cliente Linux ─┤
Cliente Win11 ─┼──── Host local ──── Banco/histórico
Cliente       ─┤         │
Cliente       ─┤         ├── WebSocket
Cliente       ─┘         │
                         └── WebRTC / SFU

```

O host deverá disponibilizar a interface pela rede.

Exemplo conceitual:

```
http://192.168.1.50:PORTA

```

ou:

```
http://25.x.x.x:PORTA

```

quando utilizado através do Hamachi.

Os clientes deverão acessar o servidor pelo navegador.

Não exigir cadastro em serviço externo.

---

# 3. COMPATIBILIDADE

Suportar prioritariamente:

## Sistemas

- Arch Linux;
- CachyOS;
- outras distribuições Linux modernas;
- Windows 11.

## Navegadores

Priorizar:

- Chromium;
- Chrome;
- Edge;
- Firefox quando tecnicamente possível.

Detectar recursos disponíveis no navegador em runtime.

Não assumir que todas as APIs de captura possuem exatamente o mesmo comportamento em todos os navegadores.

Quando uma funcionalidade depender de capacidade específica do sistema operacional ou navegador, implementar:

1. detecção automática;
2. fallback quando possível;
3. mensagem clara ao usuário quando não existir alternativa.

---

# 4. IDENTIDADE

Não haverá contas online.

Não haverá:

- e-mail;
- cadastro externo;
- OAuth;
- número de telefone;
- conta em nuvem.

Ao entrar, o usuário deverá escolher apenas:

```
Nome
Avatar opcional

```

O **nome precisa ser único dentro daquele servidor enquanto estiver reservado/ativo**.

Não permitir dois usuários simultaneamente com o mesmo nome.

A comparação deverá evitar duplicações triviais, como diferenças exclusivamente de maiúsculas/minúsculas.

Exemplo:

```
Uriel
uriel
URIEL

```

devem ser considerados conflitantes.

O servidor é responsável por validar unicidade.

---

# 5. SERVIDORES

A experiência deverá seguir o conceito de servidores do Discord.

Um usuário poderá:

- criar servidor;
- entrar em servidor;
- sair de servidor;
- visualizar servidores disponíveis/configurados;
- utilizar endereço IP;
- utilizar endereço Hamachi;
- utilizar código/link de convite local.

Ao criar um servidor, o usuário torna-se:

```
Dono

```

O servidor poderá ter:

- nome;
- ícone;
- descrição;
- senha opcional;
- canais;
- cargos;
- configurações.

---

# 6. CANAIS

Implementar múltiplos canais.

## Texto

Exemplos:

```
# geral
# jogos
# memes
# arquivos

```

## Voz

Exemplos:

```
🔊 Geral
🔊 Jogos
🔊 AFK

```

Usuários com permissão deverão conseguir:

- criar;
- renomear;
- reorganizar;
- excluir canais.

---

# 7. CARGOS E PERMISSÕES

Implementar inicialmente:

```
Dono
Moderador
Membro

```

## Dono

Controle total.

Pode:

- alterar servidor;
- criar/excluir canais;
- atribuir cargos;
- alterar permissões;
- expulsar participantes;
- mutar participantes;
- administrar transmissões;
- definir senha;
- excluir servidor.

## Moderador

Permissões configuráveis, incluindo:

- criar canais;
- editar canais;
- expulsar usuários;
- moderar chamada;
- mutar participantes;
- interromper transmissões quando autorizado.

## Membro

Permissões padrão configuráveis.

O sistema de permissões deve ser projetado de forma extensível.

Evite hardcoding que impeça adicionar novos cargos posteriormente.

---

# 8. CHAT

Implementar chat de texto em tempo real.

Suportar:

- mensagens;
- nome;
- avatar;
- timestamp;
- indicador "digitando";
- mensagens de sistema;
- entrada de usuário;
- saída de usuário;
- entrada em chamada;
- saída de chamada;
- histórico persistente;
- rolagem incremental;
- paginação do histórico;
- reconexão automática.

Preparar a arquitetura para futuramente permitir:

- edição;
- exclusão;
- resposta;
- reação;
- menção.

---

# 9. PERSISTÊNCIA

O histórico deverá permanecer **no computador host**.

Quando o host fechar e reabrir o servidor, as mensagens deverão continuar disponíveis.

Persistir:

- servidores;
- canais;
- mensagens;
- usuários conhecidos quando necessário;
- permissões;
- cargos;
- configurações;
- metadados dos arquivos;
- eventos relevantes.

Utilizar banco local robusto.

SQLite é aceitável e recomendado para a primeira implementação.

Não armazenar mensagens em serviço externo.

---

# 10. ARQUIVOS

Permitir envio pelo chat de:

- imagens;
- GIFs;
- vídeos;
- áudio;
- PDF;
- TXT;
- ZIP;
- arquivos genéricos.

Limite máximo:

```
500 MB por arquivo

```

O limite deverá ser validado pelo servidor, não apenas pelo frontend.

Os arquivos deverão ser armazenados no host.

Implementar:

- upload com progresso;
- download;
- nome original;
- tamanho;
- MIME type;
- identificação do remetente;
- data;
- tratamento seguro de nomes de arquivo;
- prevenção de path traversal.

Nunca confiar no MIME informado pelo cliente.

---

# 11. CHAMADAS DE VOZ

Utilizar WebRTC ou tecnologia equivalente.

Codec preferencial:

```
Opus

```

Recursos obrigatórios:

- entrar;
- sair;
- mute próprio;
- deafen;
- selecionar microfone;
- selecionar saída quando suportado;
- indicador de voz;
- indicador de conexão;
- latência aproximada;
- estado do microfone;
- reconexão.

---

# 12. CONTROLE DE ÁUDIO DOS PARTICIPANTES

Cada usuário deverá conseguir controlar localmente os demais participantes.

Permitir:

```
Mutar participante individualmente
Desmutar participante individualmente
Mutar todos
Desmutar todos

```

Esse mute local não deverá necessariamente alterar o estado do microfone remoto.

Separar semanticamente:

```
mute local

```

de:

```
mute administrativo

```

---

# 13. COMPARTILHAMENTO DE TELA

Permitir compartilhar:

- monitor;
- tela inteira;
- janela;
- aplicação, quando suportado.

Utilizar:

```
getDisplayMedia()

```

ou mecanismo apropriado.

O usuário poderá ativar:

```
Compartilhar áudio

```

separadamente.

A transmissão deverá permanecer independente do microfone.

---

# 14. ÁUDIO DA TRANSMISSÃO

Quando suportado pelo sistema/navegador, permitir transmitir áudio de:

- jogo;
- navegador;
- aplicação;
- desktop.

Não assumir que captura de áudio funciona de forma idêntica entre Linux e Windows.

No Linux, considerar integração e comportamento de:

```
PipeWire
xdg-desktop-portal

```

Quando necessário.

No Windows, considerar capacidades nativas disponíveis para captura de áudio.

Implementar detecção de suporte.

---

# 15. QUALIDADES DE TRANSMISSÃO

Oferecer exatamente estas opções:

| NomeResoluçãoFPS |             |         |
| ---------------- | ----------- | ------- |
| 360p             | 640 × 360   | 30 / 60 |
| 480p             | 854 × 480   | 30 / 60 |
| 540p             | 960 × 540   | 30 / 60 |
| 576p             | 1024 × 576  | 30 / 60 |
| 720p             | 1280 × 720  | 30 / 60 |
| 900p             | 1600 × 900  | 30 / 60 |
| 1080p            | 1920 × 1080 | 30 / 60 |

Configuração padrão:

```
1280 × 720
30 FPS

```

Máximo selecionável:

```
1920 × 1080
60 FPS

```

Permitir mudar:

```
Resolução
FPS
Bitrate

```

quando apropriado.

---

# 16. MÚLTIPLAS TRANSMISSÕES

Todos os **6 usuários** devem poder, arquiteturalmente, transmitir simultaneamente.

Não utilizar full mesh como arquitetura principal de distribuição de mídia.

Utilizar um:

```
SFU

```

local.

Solução recomendada:

```
mediasoup

```

ou alternativa tecnicamente superior caso exista justificativa concreta.

Cada participante deverá enviar sua transmissão primária apenas ao SFU, que distribuirá os fluxos aos demais.

---

# 17. EXIBIÇÃO DAS TRANSMISSÕES

Quando houver múltiplos compartilhamentos:

```
┌─────────────┬─────────────┐
│ Stream A    │ Stream B    │
├─────────────┼─────────────┤
│ Stream C    │ Stream D    │
└─────────────┴─────────────┘

```

Permitir:

- grade automática;
- foco em stream;
- tela cheia;
- voltar para grade;
- ocultar stream;
- mutar áudio do stream;
- mutar todos os streams.

---

# 18. CONTROLE DE ÁUDIO DAS TRANSMISSÕES

Cada transmissão possuirá controle independente.

Permitir:

```
Mutar transmissão A
Mutar transmissão B
Mutar transmissão C
Mutar todas as transmissões
Desmutar todas

```

Não confundir áudio da transmissão com áudio do microfone do usuário.

---

# 19. SFU E ADAPTAÇÃO DE QUALIDADE

Implementar bitrate adaptativo.

Quando existirem vários streams simultâneos:

- streams fora de foco devem consumir menos recursos;
- streams em foco recebem prioridade;
- previews podem utilizar resolução reduzida;
- previews podem utilizar bitrate reduzido;
- streams invisíveis podem reduzir drasticamente qualidade;
- considerar pausar consumidores que não estejam sendo exibidos.

Utilizar técnicas como:

- simulcast;
- SVC quando disponível;
- congestion control;
- active speaker optimization;
- adaptive bitrate;
- consumer layer switching.

Nunca enviar 6 streams em qualidade máxima para todos indiscriminadamente quando isso puder ser evitado.

---

# 20. HARDWARE

A aplicação deve funcionar razoavelmente em máquinas modestas.

Dar atenção especial a:

## Intel

- Intel HD Graphics;
- Intel UHD Graphics;
- Quick Sync quando acessível;
- iGPUs de notebooks.

## NVIDIA

Considerar GPUs:

- Pascal;
- GPUs com CUDA;
- GPUs com NVENC;
- GPUs RTX;
- gerações posteriores.

Entretanto:

**não confundir CUDA ou RT Cores com mecanismos de codificação de vídeo.**

Sempre preferir APIs corretas de encode/decode disponíveis pelo navegador/sistema, como hardware video acceleration exposta pelo stack de mídia.

A aplicação não deverá exigir CUDA para funcionar.

---

# 21. DEGRADAÇÃO GRADUAL

Quando hardware ou rede não forem suficientes:

não congelar simplesmente a chamada.

Aplicar progressivamente:

```
redução de bitrate
↓
redução de resolução de previews
↓
redução de FPS
↓
redução da camada recebida
↓
pausa de streams invisíveis

```

Preservar prioritariamente:

1. áudio da chamada;
2. stream em foco;
3. estabilidade;
4. baixa latência.

---

# 22. REDE

O aplicativo deverá funcionar em:

```
LAN Ethernet
LAN Wi-Fi
Hamachi
VPN equivalente

```

Não depender obrigatoriamente de:

- TURN público;
- servidor cloud;
- API externa;
- serviço de autenticação;
- banco remoto.

Em redes onde comunicação direta já é possível, utilizar o caminho direto.

---

# 23. DESCOBERTA DO HOST

Ao criar servidor, mostrar algo como:

```
Servidor iniciado

LAN:
192.168.1.23:PORTA

Hamachi:
25.53.XX.XX:PORTA

Código:
XXXXXX

```

Detectar interfaces de rede disponíveis.

Não selecionar indiscriminadamente interfaces como:

- loopback;
- Docker;
- bridges irrelevantes;
- interfaces virtuais não utilizadas.

Permitir seleção manual quando houver ambiguidade.

---

# 24. PRIVACIDADE

Princípios obrigatórios:

- zero telemetria;
- zero analytics externo;
- zero anúncios;
- zero trackers;
- zero envio de conteúdo para terceiros;
- processamento local;
- armazenamento local;
- funcionamento offline em LAN.

Não transmitir para terceiros:

- mensagens;
- áudio;
- vídeo;
- arquivos;
- IPs;
- nomes;
- métricas de uso.

---

# 25. SEGURANÇA

Utilizar criptografia fornecida pelo stack WebRTC:

```
DTLS
SRTP

```

Para sinalização/web:

preferir HTTPS/WSS quando tecnicamente configurado.

Implementar proteção contra:

- path traversal;
- XSS;
- HTML injection;
- command injection;
- mensagens malformadas;
- uploads abusivos;
- overflow lógico;
- nomes duplicados;
- impersonação trivial;
- spam;
- WebSocket flooding.

Não executar arquivos enviados.

---

# 26. SENHA DO SERVIDOR

O dono poderá definir senha opcional.

Nunca armazenar senha em texto puro.

Utilizar algoritmo adequado como:

```
Argon2id

```

ou alternativa segura equivalente.

---

# 27. INTERFACE

A organização deverá lembrar conceitualmente o Discord sem ser uma cópia visual.

Estrutura:

```
┌────────┬────────────────┬─────────────────────────────┬───────────────┐
│Servers │ Canais         │ Conteúdo principal          │ Participantes │
│        │                │                             │               │
│        │ # geral        │ Chat / chamada / streams    │ Uriel         │
│        │ # jogos        │                             │ Amigo 1       │
│        │ 🔊 Geral       │                             │ Amigo 2       │
└────────┴────────────────┴─────────────────────────────┴───────────────┘

```

Na região inferior:

```
Avatar Nome
🎤 Microfone
🎧 Deafen
🖥 Compartilhar tela
⚙ Configurações

```

---

# 28. IDENTIDADE VISUAL

Utilize a imagem de referência fornecida como principal inspiração cromática e atmosférica.

Não utilizar preto puro como fundo principal.

Tema:

```
cinza esverdeado extremamente escuro

```

Características:

- fundo quase preto com subtom verde;
- superfícies secundárias discretamente mais claras;
- verde/ciano dessaturado como destaque;
- bordas suaves;
- transparência moderada;
- sombras discretas;
- cantos arredondados;
- aparência elegante;
- alta legibilidade;
- baixo ruído visual.

Evitar aparência excessivamente gamer.

Evitar:

- neon excessivo;
- RGB;
- gradientes chamativos;
- saturação exagerada.

---

# 29. ACESSIBILIDADE VISUAL

Não depender exclusivamente de cor para transmitir estados.

Estados como:

```
mutado
falando
offline
transmitindo
erro
conectando

```

devem possuir:

- ícone;
- texto ou tooltip;
- mudança visual adicional.

---

# 30. EXPERIÊNCIA DA CHAMADA

Mostrar para cada participante:

- nome;
- avatar;
- estado do microfone;
- estado do deafen;
- indicador de fala;
- estado da transmissão;
- ping/latência;
- qualidade aproximada da conexão.

---

# 31. INDICADORES DE REDE

Exibir indicadores simples:

```
Excelente
Boa
Instável
Ruim

```

Opcionalmente, nas informações avançadas:

```
RTT
packet loss
jitter
bitrate
codec
FPS
resolução atual

```

---

# 32. RECONEXÃO

Se ocorrer interrupção temporária:

```
Connected
↓
Reconnecting
↓
Connected

```

Não exigir recarregar manualmente a página quando possível.

Implementar:

- WebSocket reconnect;
- ICE restart quando apropriado;
- restabelecimento de consumers/producers;
- recuperação do estado da sala.

---

# 33. BACKEND

Stack recomendado:

```
Node.js
TypeScript
Fastify ou equivalente
WebSocket
mediasoup
SQLite

```

Não usar dependências gigantescas sem necessidade.

Organizar componentes de forma desacoplada.

Exemplo:

```
server/
 ├── api/
 ├── auth/
 ├── chat/
 ├── channels/
 ├── database/
 ├── files/
 ├── media/
 ├── permissions/
 ├── realtime/
 ├── servers/
 └── users/

```

---

# 34. FRONTEND

Stack sugerido:

```
TypeScript
React
Vite

```

ou equivalente caso exista justificativa técnica.

Organização:

```
client/
 ├── components/
 ├── pages/
 ├── hooks/
 ├── services/
 ├── stores/
 ├── media/
 ├── websocket/
 ├── styles/
 └── utils/

```

---

# 35. ESTADO

Evitar estado global caótico.

Separar:

- sessão;
- servidores;
- canais;
- participantes;
- chat;
- chamada;
- streams;
- dispositivos;
- configurações.

---

# 36. LOGS

Implementar logging útil no host.

Exemplo:

```
[INFO]
[WARN]
[ERROR]
[MEDIA]
[NETWORK]

```

Nunca registrar:

- senha;
- conteúdo de áudio;
- conteúdo de vídeo;
- dados secretos.

Logs devem ajudar a diagnosticar:

- conexão;
- WebRTC;
- SFU;
- banco;
- uploads;
- permissões.

---

# 37. PAINEL DE DIAGNÓSTICO

Criar futuramente uma página:

```
Configurações
→ Diagnóstico

```

Mostrar:

- navegador;
- sistema;
- codecs;
- resolução atual;
- FPS;
- bitrate;
- RTT;
- packet loss;
- ICE state;
- DTLS state;
- WebRTC state.

Isso será importante para diagnosticar problemas entre Linux e Windows.

---

# 38. NÃO FAZER

Não:

- transformar o projeto em SaaS;
- criar dependência obrigatória de nuvem;
- adicionar login Google;
- adicionar login Discord;
- exigir conta;
- exigir Docker para o usuário final;
- exigir configuração manual complexa para uso comum;
- armazenar chat fora do host;
- utilizar arquitetura full mesh como solução principal;
- produzir somente mockups;
- mascarar erros;
- ignorar exceções silenciosamente.

---

# 39. DESENVOLVIMENTO INCREMENTAL

Implementar em fases executáveis.

## Fase 0 — Fundação

- estrutura do monorepo;
- frontend;
- backend;
- TypeScript;
- lint;
- build;
- configuração;
- logging.

## Fase 1 — Interface e servidor

Implementar:

- interface completa base;
- criação de servidor;
- entrada por IP;
- usuários;
- nomes únicos;
- canais;
- cargos básicos.

Ao final, aplicação deve ser executável.

## Fase 2 — Chat

Implementar:

- WebSocket;
- chat;
- typing;
- presença;
- SQLite;
- persistência.

## Fase 3 — Arquivos

Implementar:

- upload;
- limite 500 MB;
- progresso;
- download;
- persistência.

## Fase 4 — Voz

Implementar:

- SFU;
- WebRTC;
- Opus;
- canais de voz;
- mute;
- deafen;
- seleção de dispositivos.

## Fase 5 — Compartilhamento

Implementar uma transmissão de tela completa.

Adicionar:

- resolução;
- FPS;
- áudio;
- escolha da fonte.

## Fase 6 — Multi-stream

Permitir múltiplos broadcasters simultaneamente.

Adicionar:

- grid;
- stream focus;
- mute individual;
- mute global;
- layers adaptativas.

## Fase 7 — Performance

Otimizar:

- iGPU Intel;
- notebooks modestos;
- hardware acceleration;
- NVIDIA;
- bandwidth;
- CPU;
- memória.

## Fase 8 — Segurança

Adicionar:

- senha;
- permissions;
- validações;
- hardening;
- rate limiting.

## Fase 9 — Acabamento

Adicionar:

- animações;
- UX;
- diagnóstico;
- recovery;
- tratamento avançado de erros.

---

# 40. CRITÉRIOS DE ACEITE

Não considere o projeto completo enquanto estes cenários não funcionarem.

## Cenário A

```
Host Linux
+
Cliente Linux

```

Trocam mensagens em LAN.

## Cenário B

```
Host Linux
+
Cliente Windows 11

```

Trocam mensagens e entram na mesma chamada.

## Cenário C

Três usuários conversam por voz simultaneamente.

## Cenário D

Dois usuários transmitem telas simultaneamente.

## Cenário E

Usuário seleciona:

```
720p
30 FPS

```

e transmite corretamente.

## Cenário F

Usuário muda para:

```
1080p
60 FPS

```

quando hardware/rede permitem.

## Cenário G

Diversos streams são exibidos em grid.

Ao ampliar um:

```
stream selecionado → alta qualidade
outros → qualidade reduzida

```

## Cenário H

Host encerra aplicação.

Depois reinicia.

Histórico continua disponível.

## Cenário I

Usuário envia arquivo próximo de:

```
500 MB

```

e o servidor processa corretamente.

Arquivo acima do limite é recusado.

## Cenário J

Dois usuários tentam utilizar o mesmo nome.

O segundo é recusado.

## Cenário K

Internet é desconectada.

LAN permanece ativa.

Chat e chamada continuam funcionando.

---

# 41. TESTES

Implementar testes automatizados onde fizer sentido.

Cobrir principalmente:

- permissões;
- unicidade de nomes;
- histórico;
- mensagens;
- limite de upload;
- canais;
- validação de payload;
- persistência.

Para WebRTC, criar testes de integração e ferramentas de diagnóstico.

---

# 42. PERFORMANCE

Não otimizar prematuramente aspectos irrelevantes.

Entretanto, trate mídia em tempo real como requisito crítico desde o começo.

Instrumentar:

```
CPU
RAM
bitrate
FPS
packet loss
RTT
jitter

```

O sistema deverá continuar utilizável mesmo quando não puder manter a qualidade solicitada.

---

# 43. PRIORIDADES

Quando requisitos entrarem em conflito, utilizar esta ordem:

```
1. Estabilidade da chamada
2. Privacidade
3. Áudio
4. Baixa latência
5. Stream principal
6. Performance
7. Qualidade dos previews
8. Fidelidade visual

```

---

# 44. EXPERIÊNCIA DO HOST

Criar servidor deve ser simples.

Ideal:

```
Criar servidor
↓
Escolher nome
↓
Servidor iniciado
↓
Mostrar endereço LAN/Hamachi
↓
Copiar convite

```

Nenhuma configuração técnica adicional deve ser necessária em condições normais.

---

# 45. EXPERIÊNCIA DO CLIENTE

Entrar deve ser igualmente simples:

```
Abrir navegador
↓
Acessar endereço
↓
Escolher nome
↓
Entrar

```

Se houver senha:

```
Nome
Senha do servidor
Entrar

```

---

# 46. ARQUITETURA PARA EVOLUÇÃO

Não implemente o projeto como código descartável.

Planeje para posteriormente receber:

- mensagens privadas;
- reações;
- respostas;
- edição de mensagens;
- bots locais;
- canais privados;
- permissões avançadas;
- E2EE adicional;
- gravação local opcional;
- emojis personalizados;
- temas;
- descoberta automática em LAN;
- aplicações desktop opcionais.

Esses recursos NÃO precisam ser implementados agora.

Apenas evite decisões arquiteturais que os tornem inviáveis.

---

# 47. REGRA DE AUTONOMIA

Você é responsável pela engenharia do projeto.

Não pare a implementação para perguntar sobre:

- nomes internos de componentes;
- organização de arquivos trivial;
- escolha entre bibliotecas equivalentes;
- pequenos detalhes de CSS;
- convenções internas;
- refactors evidentes.

Escolha a solução tecnicamente superior, documente brevemente a decisão e continue.

Quando encontrar um bug:

```
investigue
↓
identifique causa raiz
↓
corrija
↓
teste
↓
continue

```

Não contorne bugs estruturais com hacks permanentes.

---

# 48. REGRA CONTRA FALSA CONCLUSÃO

Não declare uma funcionalidade como concluída apenas porque:

- compilou;
- apareceu visualmente;
- não mostrou erro;
- um componente foi criado.

Uma funcionalidade só está concluída quando seu fluxo relevante tiver sido realmente exercitado e validado.

Se algo não puder ser testado no ambiente atual, declare explicitamente:

```
IMPLEMENTADO, MAS NÃO VALIDADO NESTE AMBIENTE

```

Nunca invente resultados de testes.

---

# 49. ENTREGA DURANTE O DESENVOLVIMENTO

A cada fase relevante, informe de forma concisa:

```
O que foi implementado
Arquivos principais alterados
Como executar
Como testar
O que ainda falta
Problemas conhecidos

```

Não produza relatórios excessivamente longos durante cada pequena alteração.

Priorize escrever e testar código.

---

# 50. RESULTADO ESPERADO

O resultado final deve ser uma aplicação privada de comunicação para pequenos grupos que ofereça uma experiência semelhante àquilo que os usuários procuram no Discord, porém:

```
mais simples
mais privada
self-hosted
LAN-first
Hamachi-friendly
sem contas online
sem telemetria
sem dependência de cloud

```

O sistema deverá proporcionar chat persistente, canais de texto e voz, compartilhamentos simultâneos e administração básica para até 6 pessoas, executando de forma consistente entre Linux e Windows 11.

Comece pela **Fase 0** e avance sequencialmente.

Antes de escrever grandes quantidades de código, defina brevemente a arquitetura final, estrutura de diretórios e fluxo de comunicação.

Depois disso, **comece imediatamente a implementação**.