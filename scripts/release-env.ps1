# GENERACIÓN DEL ENTORNO DE LIBERACIÓN EN TU PC (Windows PowerShell 5.1 o 7).
#
# Construye la MISMA imagen que usan el pipeline y Render, la levanta con las mismas
# variables que render.yaml y le corre las pruebas de humo.
#
# Uso (desde la raíz del repo, con Docker Desktop abierto):
#   .\scripts\release-env.ps1              # construir, levantar y probar
#   .\scripts\release-env.ps1 -Port 3100   # otro puerto local
#   .\scripts\release-env.ps1 -NoTest      # solo construir y levantar
#   .\scripts\release-env.ps1 -Stop        # detener y borrar el contenedor
#
# Si PowerShell bloquea el script: powershell -ExecutionPolicy Bypass -File .\scripts\release-env.ps1

param(
  [int]$Port = 3000,
  [switch]$NoTest,
  [switch]$Stop
)

$name = 'ai-support-engine'
$root = Split-Path -Parent $PSScriptRoot

function Remove-AppContainer {
  $existing = docker ps -aq --filter "name=^$name$"
  if ($existing) { docker rm -f $name | Out-Null }
}

docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error 'Docker no responde. Abre Docker Desktop y vuelve a intentar.'; exit 1 }

if ($Stop) { Remove-AppContainer; Write-Host "Contenedor $name detenido."; exit 0 }

$version = (git -C $root rev-parse HEAD).Trim()
if (-not $version) { $version = 'local' }

Write-Host "1/3 Construyendo $name`:local (version $($version.Substring(0, [Math]::Min(7, $version.Length))))..."
docker build --build-arg "APP_VERSION=$version" -t "${name}:local" $root
if ($LASTEXITCODE -ne 0) { Write-Error 'docker build fallo.'; exit 1 }

Write-Host "2/3 Levantando el contenedor en http://127.0.0.1:$Port ..."
Remove-AppContainer
docker run -d --name $name -p "${Port}:10000" `
  -e APP_ENV=local-docker -e LLM_PROVIDER=gemini -e LLM_TIMEOUT_MS=30000 `
  "${name}:local" | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Error 'docker run fallo (puerto ocupado? usa -Port).'; exit 1 }

if ($NoTest) {
  Write-Host "Listo. Detener con: .\scripts\release-env.ps1 -Stop"
  exit 0
}

Write-Host '3/3 Pruebas de humo contra el contenedor...'
node (Join-Path $root 'scripts\smoke-test.mjs') "http://127.0.0.1:$Port" --expect-version $version
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host "`nLogs del contenedor:"
  docker logs $name
}
Write-Host "`nEl contenedor sigue corriendo. Detener con: .\scripts\release-env.ps1 -Stop"
exit $code
