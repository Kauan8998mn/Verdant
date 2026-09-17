# Implantação pública — roteiro preparado, execução externa pendente

O estado auditado está em `CURRENT_STATE.md` e `ROOT_CAUSE.md`. Este roteiro não
é evidência de implantação. Não há VM, DNS ou mídia entre redes validados ainda.

## Dados necessários

- VM Ubuntu/Debian, usuário SSH e chave; arquitetura e recursos disponíveis.
- IPv4 público estável, IPv4 real da interface da VM e dois domínios DNS próprios:
  aplicação e TURN. Nesta implantação, ambos apontam para a mesma VM.
- Credencial Caddy individual para cada pessoa, criada interativamente.
- Dois clientes em redes diferentes para os testes de `TESTING.md`.

A OCI exige IP público e rota pelo Internet Gateway para acesso externo;
as regras de segurança da nuvem e o firewall do sistema operacional são camadas
separadas. Consulte [criação de instâncias](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm)
e [Security Lists](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm).

## Portas previstas

| Porta padrão | Protocolo | Uso / origem |
| --- | --- | --- |
| 22 | TCP | SSH, limitado ao IP administrativo |
| 80, 443 | TCP | Caddy, HTTPS e ACME |
| 43111 | UDP e TCP | Mídia direta dos clientes ao SFU |
| 3478 | UDP e TCP | Clientes TURN, quando habilitado |
| 5349 | TCP | TURN sobre TLS, quando habilitado |
| 40000–40100 | UDP | Alocações relay; tráfego do SFU para os relays |
| 43110 | TCP, somente loopback | HTTP interno, não abrir na nuvem |

Revise regras existentes antes de acrescentar permissões. Não substitua o
firewall inteiro e mantenha uma sessão SSH aberta. Com SFU e Coturn na mesma VM,
valide especificamente a rota entre o IPv4 público anunciado e o relay local;
o mapeamento de IP público da OCI não equivale a um IP atribuído à interface.
O ACL do Coturn permite como peer apenas o IPv4 público do SFU.

## Instalar e configurar

Transfira um checkout do commit revisado para a VM, sem dados ou segredos locais.
Execute na VM:

```bash
sudo ./deploy/install.sh
sudoedit /etc/verdant/verdant.env
sudo /opt/verdant/current/deploy/add-user.py alice
sudo /opt/verdant/current/deploy/add-user.py bob
sudo /opt/verdant/current/deploy/configure.sh
```

O instalador fixa Node 24.21.0 com checksum, instala dependências, cria usuários
de serviço/build separados e uma release em `/opt/verdant/releases`. Compila o
cliente e o servidor e executa `createWorker()` antes de trocar o link `current`.
O teste real ARM64 deve ocorrer na VM ARM64; build x64 local não o substitui.
Se o prebuilt do worker for incompatível com a CPU, recompile nativamente com
`MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD=1` no ambiente de instalação npm.

Configure `PUBLIC_ORIGIN`, `MEDIASOUP_ANNOUNCED_ADDRESS`, `TURN_HOST`,
`TURN_REALM` e `TURN_LISTEN_IP`. Mantenha os caminhos fornecidos para banco e
uploads. Inicialmente use `TURN_ENABLED=false`; prove mídia direta antes de
habilitar o relay. O arquivo de ambiente deve permanecer `root:verdant 0640`.

`configure.sh` recusa substituir um Caddyfile não gerenciado. Na VM dedicada,
revise o conteúdo e use `--replace-caddy` quando a substituição for intencional;
o script guarda backup. Não use essa opção às cegas em servidor compartilhado.

Basic ocupa `Authorization`; a sessão usa `X-Verdant-Session`. O Caddy sobrescreve
`X-Verdant-User` e `X-Verdant-Client-IP`. O backend aceita a identidade somente
por loopback. Cada usuário deve ter login próprio; não compartilhe credenciais.

## Dados legados

Faça backup verificável antes de migrar. Pare o serviço, copie SQLite consistente
e uploads para `/var/lib/verdant`, ajuste o dono para `verdant:verdant` e vincule
explicitamente os apelidos legados:

```bash
sudo systemctl stop verdant
sudo /opt/verdant-node/bin/node /opt/verdant/current/deploy/bind-identity.mjs SERVER_UUID 'Apelido' login_caddy
sudo systemctl start verdant
```

Não atribua identidades por tentativa de login. Mensagens e cargos antigos
permanecem no banco; nomes sem vínculo são recusados no modo público.

## Habilitar TURN e TLS

Após validar a rota direta, ajuste `TURN_ENABLED=true` e execute `configure.sh`.
O segredo aleatório já é criado pelo instalador. O backend entrega credenciais
HMAC temporárias, não o segredo compartilhado. Caddy obtém o certificado do
domínio TURN e `turn-cert-sync.timer` copia certificados renovados para Coturn.
Se o certificado ainda não existir, corrija DNS/ACME e repita `configure.sh`.

Não declare relay funcional apenas porque o serviço iniciou. Verifique candidato
selecionado `relay`, tráfego de mídia e expiração/renovação. Consulte a configuração
oficial do [Coturn](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf)
para a precedência de `allowed-peer-ip` sobre `denied-peer-ip`.

## Operação, atualização e recuperação

```bash
sudo /opt/verdant/current/deploy/health.sh
sudo journalctl -u verdant -u caddy -u coturn -n 100
sudo /opt/verdant/current/deploy/backup.sh
sudo ./deploy/update.sh /caminho/do/checkout-revisado
```

O backup interrompe o Verdant durante a cópia e o inicia novamente se estava
ativo. Contém SQLite verificado, uploads completos e configuração sem segredos;
guarde credenciais separadamente. Atualizações preservam a release anterior e
fazem backup antes de ativar a nova. Falha no healthcheck não reverte banco
automaticamente. Para recuperar, pare Verdant, restaure banco e uploads do
mesmo backup, ajuste permissões e selecione a release compatível. Teste a
restauração numa instância isolada antes de depender desse procedimento.

## Gate de liberação

Preencha `TESTING.md` com evidências reais. VM, DNS/ACME, relay externo, UDP
bloqueado, reboot, ARM64 e capacidade 2–6 continuam pendentes até execução.
