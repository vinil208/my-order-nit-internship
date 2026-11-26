$ErrorActionPreference = 'Stop'
# Used by start.cmd. The workspace's portable install is outside the source ZIP.
$configFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $configFile)) { exit 0 }
$config = Get-Content -LiteralPath $configFile
if (-not ($config -match '^\s*AI_PROVIDER\s*=\s*ollama\s*$')) { exit 0 }
$localUrl = 'http://127.0.0.1:11434'
$urlLine = $config | Where-Object { $_ -match '^OLLAMA_BASE_URL=' } | Select-Object -Last 1
if ($urlLine) { $localUrl = ($urlLine -split '=', 2)[1].Trim() }
try { Invoke-RestMethod "$localUrl/api/tags" -TimeoutSec 3 | Out-Null; exit 0 } catch { }
if ($localUrl -ne 'http://127.0.0.1:11434') {
  throw "Start Ollama at the configured address: $localUrl"
}
$portableDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../work/ollama'))
$portableExe = Join-Path $portableDir 'ollama.exe'
$installed = Get-Command ollama -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $portableExe) {
  $ollamaExe = $portableExe
  $env:OLLAMA_MODELS = [IO.Path]::GetFullPath((Join-Path $portableDir '../ollama-models'))
} elseif ($installed) {
  $ollamaExe = $installed.Source
} else {
  throw 'Install Ollama from https://ollama.com/download/windows, then run: ollama pull qwen3:0.6b'
}
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_NUM_PARALLEL = '1'
$logDir = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'ollama.stdout.log') -RedirectStandardError (Join-Path $logDir 'ollama.stderr.log') | Out-Null
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 500
  try { Invoke-RestMethod "$localUrl/api/tags" -TimeoutSec 2 | Out-Null; Write-Host 'Local Ollama is ready.'; exit 0 } catch { }
}
throw 'Ollama did not start. Check data/ollama.stderr.log.'
