$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js 22.13+ é necessário."
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm é necessário para instalar as dependências de mídia (Fases 4/5)."
    exit 1
}

$parts = (node -p "process.versions.node").Split('.')
$major = [int]$parts[0]
$minor = [int]$parts[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) {
    Write-Error "Node.js 22.13+ é necessário. Encontrado: $(node -v)"
    exit 1
}

if (-not (Test-Path "node_modules/mediasoup/package.json") -or -not (Test-Path "node_modules/mediasoup-client/package.json") -or -not (Test-Path "node_modules/.bin/esbuild.cmd") -or -not (Test-Path "node_modules/mediasoup/worker/out/Release/mediasoup-worker.exe")) {
    Write-Host "Dependências de mídia ausentes. Instalando com npm..."
    npm install
}

if (-not (Test-Path "node_modules/mediasoup/worker/out/Release/mediasoup-worker.exe")) {
    Write-Error "O worker do mediasoup não foi criado. Execute: npm install-scripts ls"
    exit 1
}

npm run build

$tlsDir = Join-Path $PWD "data/tls"
$cert = Join-Path $tlsDir "verdant-lan-server.crt"
$key = Join-Path $tlsDir "verdant-lan-server.key"
if (-not $env:TLS_CERT -and -not $env:TLS_KEY -and (Test-Path $cert) -and (Test-Path $key)) {
    $env:TLS_CERT = $cert
    $env:TLS_KEY = $key
}

if (-not $env:TLS_CERT -or -not $env:TLS_KEY) {
    Write-Host ""
    Write-Host "AVISO: HTTPS ainda não está configurado."
    Write-Host "Voz funciona em http://localhost, mas PCs remotos exigem HTTPS confiável."
    Write-Host "Execute uma vez: npm run tls:generate"
    Write-Host ""
}

node --experimental-strip-types server/src/index.ts
