$ErrorActionPreference = 'Stop'

$port = 8080
$url = "http://127.0.0.1:$port/index.html"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root 'serve_chengmo.py'

function Test-ChengmoServer {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  } catch {
    return $false
  }
}

if (-not (Test-ChengmoServer)) {
  $portInUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($portInUse) {
    Write-Host "Port $port is already in use by another program."
    Write-Host "Close that program or change the port before starting Chengmo."
    exit 1
  }

  $python = Get-Command py -ErrorAction SilentlyContinue
  $arguments = @('-3', $server)
  if (-not $python) {
    $python = Get-Command python -ErrorAction SilentlyContinue
    $arguments = @($server)
  }
  if (-not $python) {
    Write-Host 'Python was not found. Install Python 3, then start this file again.'
    exit 1
  }

  Start-Process -FilePath $python.Source -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden
  $ready = $false
  foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 250
    if (Test-ChengmoServer) { $ready = $true; break }
  }
  if (-not $ready) {
    Write-Host 'Chengmo could not start its local server. See serve_chengmo.py for details.'
    exit 1
  }
}

Start-Process $url
