$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
foreach ($name in @("VERDANT_DOMAIN","VERDANT_PUBLIC_IP","VERDANT_AUTH_USER","VERDANT_AUTH_HASH")) { if (-not (Get-Item "Env:$name" -ErrorAction SilentlyContinue).Value) { throw "Defina $name antes de iniciar." } }
if (-not (Get-Command caddy -ErrorAction SilentlyContinue)) { throw "Caddy não encontrado no PATH." }
$env:HOST="127.0.0.1"
$env:MEDIA_LISTEN_IPS="0.0.0.0"
$env:MEDIA_ANNOUNCED_ADDRESS=$env:VERDANT_PUBLIC_IP
$env:MEDIA_EXPOSE_INTERNAL_IP="0"
$env:PUBLIC_ORIGIN="https://$($env:VERDANT_DOMAIN)"
$env:ALLOWED_HOSTS="$($env:VERDANT_DOMAIN),127.0.0.1,localhost"
Remove-Item Env:TLS_CERT -ErrorAction SilentlyContinue
Remove-Item Env:TLS_KEY -ErrorAction SilentlyContinue
$caddy=Start-Process caddy -ArgumentList @("run","--config",(Join-Path $PWD "Caddyfile.online"),"--adapter","caddyfile") -PassThru -NoNewWindow
try { & (Join-Path $PWD "run-host-windows.ps1") } finally { if (-not $caddy.HasExited) { Stop-Process -Id $caddy.Id -Force } }
