param(
  [switch]$InstallStartup,
  [string[]]$AllowedOrigins = @("http://127.0.0.1:5173", "http://localhost:5173")
)

$ErrorActionPreference = "Stop"
$BridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $BridgeDir "config.local.json"
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) {
  throw "Node.js was not found in PATH. Install Node.js 20+ before installing the Seramet Print Bridge."
}

$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
$dataDir = Join-Path $HOME ".seramet-print-bridge"

$config = [ordered]@{
  host = "127.0.0.1"
  port = 48777
  token = $token
  dryRun = $false
  dataDir = $dataDir
  allowedOrigins = $AllowedOrigins
}
$config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

if ($InstallStartup) {
  $startup = [Environment]::GetFolderPath("Startup")
  $cmdPath = Join-Path $startup "Seramet Print Bridge.cmd"
  @"
@echo off
cd /d "$BridgeDir\.."
start "Seramet Print Bridge" /min "$($Node.Source)" "local-print-bridge\server.mjs"
"@ | Set-Content -LiteralPath $cmdPath -Encoding ASCII
  Write-Host "Startup launcher created: $cmdPath" -ForegroundColor Green
}

Write-Host ""
Write-Host "Seramet Print Bridge configured." -ForegroundColor Green
Write-Host "Endpoint: http://127.0.0.1:48777"
Write-Host "Token:    $token" -ForegroundColor Yellow
Write-Host "Config:   $ConfigPath"
Write-Host ""
Write-Host "In Seramet: Hardware Setup > Printers > enable Installed bridge, paste the endpoint and token, then Save setup."
Write-Host "Start now with: node local-print-bridge/server.mjs"
