# Atualização para a Fase 5 (0.3.x)

## Pré-Fase 6 / 0.3.5 — conforto local e arquivos

Adiciona volume individual local por participante, teste/ganho/retorno do microfone, busca/indexação de TXT, previews de arquivos e imagens, links clicáveis, previews externos opt-in e personalização local de cor/overlay/escala. Não inicia a Fase 6.

Para atualizar uma instalação já funcional sem substituir `data/`, TLS ou `node_modules`, prefira extrair em uma pasta temporária e copiar o conteúdo sobre a instalação existente.

## Hotfix 0.3.4 — pré-Fase 6

Adiciona fallback de áudio por entrada Monitor/Loopback, controle de supressão de ruído do microfone e ações destrutivas exclusivas do Dono (mensagem/canal/servidor), com limpeza de blobs no host.


## Hotfix 0.3.3

Corrige duas regressões observadas em uso real: download de arquivo não navega mais o documento principal (preservando chamada/transmissão) e o painel de voz/transmissão não volta ao topo durante atualizações frequentes.


Esta versão foi construída sobre o hotfix 0.2.2 para não reintroduzir o bug de foco/rascunho do chat durante chamadas.

## Atualização recomendada no host que já funciona

Pare o Verdant com `Ctrl+C` e extraia o ZIP **por cima** de `~/Downloads/verdant-lan`:

```bash
cd ~/Downloads
unzip -o verdant-lan-phase5-implemented-0.3.0.zip
cd ~/Downloads/verdant-lan
./run-host-linux.sh
```

Não remova `node_modules/` e não apague `data/`. As dependências de mídia são as mesmas da Fase 4.

## Teste manual mínimo

Com dois usuários no mesmo canal de voz:

1. confirme voz nos dois sentidos;
2. host/cliente abre **Compartilhamento de tela**;
3. use primeiro 720p / 30 FPS;
4. escolha uma janela/tela no seletor do navegador;
5. valide vídeo no outro PC;
6. com áudio habilitado, valide o áudio da fonte quando ela for oferecida pelo navegador;
7. pare a transmissão pelo botão do Verdant e pelo botão nativo do navegador;
8. teste 1080p / 60 FPS;
9. teste Dono/Moderador encerrando a transmissão remota;
10. enquanto a chamada/tela está ativa, escreva uma mensagem longa para confirmar que o hotfix 0.2.2 continua preservando foco e rascunho.

## Teste automatizado

```bash
npm run test:media
npm run audit:phase5
```

A Fase 5 só deve ser marcada concluída depois do teste real com o seletor de tela do sistema/navegador.
