# Verdant LAN 0.5.0-phase8-security

Esta branch (`migration/public-server`) continua a migração da base LAN para um servidor público. Use **Node 24 LTS** conforme `package.json`. O estado atual e os testes estão em [CURRENT_STATE.md](CURRENT_STATE.md); VM, DNS/ACME e os gates externos ainda exigem validação.

Consulte `PHASE8_SECURITY_REPORT.md` para o escopo e as decisões de compatibilidade.

Comunicação privada para até seis pessoas, com chat, arquivos, voz e compartilhamento de tela. Esta reconstrução usa a **0.3.3 como baseline de áudio** e reaplica apenas melhorias não-áudio confirmadas das versões posteriores.

## Instalação local/LAN

Linux:
```bash
./run-host-linux.sh
```

Windows PowerShell:
```powershell
.\run-host-windows.ps1
```

O `package.json` inclui `allowScripts` fixado para `mediasoup@3.26.0` e `esbuild@0.28.2`, evitando o problema observado em npm recente onde os postinstall necessários eram bloqueados.

Para HTTPS local/LAN:
```bash
npm run tls:generate
```

Compartilhe apenas `data/tls/verdant-lan-ca.crt`; nunca compartilhe chaves `.key`.

## Internet sem Hamachi/Radmin

Para implantação pública, siga **[docs/DEPLOY_ORACLE.md](docs/DEPLOY_ORACLE.md)** e [docs/TESTING.md](docs/TESTING.md): Caddy com login individual, identidade vinculada, TLS, SFU público e TURN temporário. `ONLINE.md` e os launchers online antigos são registros do modo anterior e não configuram as proteções de produção desta branch.

## O que foi preservado

UI, mensagens, canais, SQLite, anexos e SFU foram reaproveitados. A voz recebeu configuração/renovação de ICE e recuperação; os módulos sensíveis de processamento do microfone, boost remoto e preferências de áudio mantêm os hashes verificados pelos testes da base. Os relatórios antigos abaixo descrevem suas respectivas fases históricas.

## Pré-Fase 6 — 0.3.9-prephase6.1

- correção do salto do chat para o topo com reconciliação incremental das mensagens e política de scroll específica para Chromium;
- fotos de perfil por usuário, persistidas no host por servidor, com recorte 256×256 WebP no cliente;
- presets de cor, blur de painéis e cor/intensidade do brilho de fala configuráveis localmente;
- pipeline de voz preservado sem alterações nesta rodada.

Consulte `PRE_PHASE6_PROFILE_SCROLL_REPORT.md` para limites e validação desta versão.

## Relatórios

- `SOUND_SETTINGS_REPORT.md` — sons de interface, novo menu e toggle global de microfone;
- `SUPERSTRESS_REPORT.md` — comparação das versões e decisões;
- `STATUS.md` — estado/validação;
- `SPEC.md` — especificação original.

## Comandos de validação

```bash
npm test
npm run audit
```

O E2E real de mídia exige dependências instaladas e Chromium/Chrome local. Não considere o modo Internet validado até testá-lo em duas redes externas reais.

## Fase 6.1 — múltiplas transmissões

A linha 0.4.0-phase6.1 inicia o multi-stream. Participantes diferentes do mesmo canal de voz podem transmitir simultaneamente. O palco de compartilhamento vira uma grade; clicar em uma transmissão a coloca em foco e **Voltar para grade** restaura a visão coletiva.

Em Chromium/VP8, cada transmissão tenta negociar três encodings simulcast. Com várias telas em grade o cliente solicita a camada baixa; a tela focada solicita a alta e vídeos remotos fora de foco são pausados no Consumer. O áudio de cada transmissão continua independente e pode ser silenciado por stream ou globalmente.

A Fase 6 foi posteriormente validada em uso real pelo usuário em 19/08/2026 e está marcada como concluída. A adaptação adicional por métricas reais de congestionamento/banda segue para a Fase 7, sem reabrir o gate funcional do multi-stream.


## Fase 7.1 — performance

A linha `0.4.1-phase7.1` inicia a otimização sem alterar o contrato funcional validado da Fase 6. A UI de voz foi extraída de `main.ts` para `voice-ui.ts`, reduzindo o arquivo principal e isolando rerenders de mídia. Rail, canais, membros e painel principal agora usam assinaturas estruturais e patches pontuais para evitar reconstrução do DOM em eventos frequentes como speaking.

O multi-stream passa a usar uma política **bandwidth-first**: com duas ou mais telas, vídeos remotos na grade ficam pausados até o usuário focar uma transmissão. A transmissão focada volta a receber vídeo e pede a camada alta; áudio de screen share continua independente. Transições `pause/resume/quality` são idempotentes para evitar sinalização repetida. O servidor impõe no máximo quatro screen-video producers ativos por canal.

A Fase 7 ainda não está marcada como concluída. Permanecem pendentes benchmark real de CPU/RAM/banda, validação de aceleração por hardware/iGPU/dGPU e adaptação orientada por métricas de congestionamento.
