param(
  [ValidateSet("Plan", "Apply", "Verify")]
  [string]$Mode = "Plan",
  [string]$EvidenceSha256 = ""
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$cert = Join-Path $HOME "Downloads\seramet-staging-ca.crt"
$archive = Join-Path $HOME "seramet-staging-backups\staging-20260928-100218Z\staging-database.backup"
if (-not (Test-Path -LiteralPath $cert)) { throw "Missing staging CA certificate. Do not disable SSL checks." }
if ($Mode -ne "Verify" -and -not (Test-Path -LiteralPath $archive)) {
  throw "Missing original private staging backup archive."
}
if ($Mode -eq "Apply") {
  if ($EvidenceSha256 -cnotmatch "^[0-9a-f]{64}$") {
    throw "Supply the exact restoreEvidenceSha256 from the successful --plan output."
  }
  Write-Host "WARNING: This changes only the 3 approved STAGING imports and jobs."
  Write-Host "Only proceed if STAGING Cloudflare Cron and Queue consumers are ACTUALLY PAUSED."
  $frozen = Read-Host "Type FROZEN only after verifying Cloudflare consumers are paused"
  $approval = Read-Host "Type APPROVE_THREE_STAGING_IMPORTS_ONLY to approve this exact operation"
  if ($frozen -cne "FROZEN" -or $approval -cne "APPROVE_THREE_STAGING_IMPORTS_ONLY") {
    throw "Missing deliberate operator approval; no database connections opened."
  }
}
$stageSecret = $null
$localSecret = $null
$stagePtr = [IntPtr]::Zero
$localPtr = [IntPtr]::Zero
try {
  $stageSecret = Read-Host "STAGING database password" -AsSecureString
  $stagePtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($stageSecret)
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($stagePtr)
  $ca = [uri]::EscapeDataString((Resolve-Path -LiteralPath $cert).Path.Replace("\", "/"))
  $env:SERAMET_POSTGRES_URL = "postgresql://postgres.vnymbavsbxorwxpebkot@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=$ca"
  $env:SERAMET_ENVIRONMENT = "staging"
  if ($Mode -ne "Verify") {
    $localSecret = Read-Host "LOCAL PostgreSQL restore database password" -AsSecureString
    $localPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($localSecret)
    $localPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($localPtr)
    $localEncoded = [uri]::EscapeDataString($localPassword)
    $env:SERAMET_APP_RESTORE_LOCAL_URL = "postgresql://postgres:$localEncoded@127.0.0.1:5432/seramet_public_restore_20260928"
    $env:SERAMET_APP_RESTORE_ARCHIVE = (Resolve-Path -LiteralPath $archive).Path
  }
  if ($Mode -eq "Apply") {
    $env:SERAMET_APP_RECOVERY_APPROVAL = $approval
    $env:SERAMET_APP_RECOVERY_QUEUE_FROZEN = "true"
    $env:SERAMET_APP_RECOVERY_PLAN_SHA256 = "a7fb93005c0176decfcb3e94152d39a96ae17da35ba6bcff017ad8a7059c3481"
    $env:SERAMET_APP_RECOVERY_EVIDENCE_SHA256 = $EvidenceSha256
    $operator = Read-Host "Authorized import owner user ID"
    $env:SERAMET_APP_RECOVERY_OPERATOR_ID = $operator
  }
  $flag = "--" + $Mode.ToLowerInvariant()
  & node (Join-Path $PSScriptRoot "reconcile-staging-menu-imports-app-restore.mjs") $flag
  if ($LASTEXITCODE -ne 0) {
    throw "Recovery $Mode failed (exit code $LASTEXITCODE). No success may be assumed."
  }
}
finally {
  foreach ($key in @(
    "PGPASSWORD", "SERAMET_POSTGRES_URL", "SERAMET_ENVIRONMENT",
    "SERAMET_APP_RESTORE_LOCAL_URL", "SERAMET_APP_RESTORE_ARCHIVE",
    "SERAMET_APP_RECOVERY_APPROVAL", "SERAMET_APP_RECOVERY_QUEUE_FROZEN",
    "SERAMET_APP_RECOVERY_PLAN_SHA256", "SERAMET_APP_RECOVERY_EVIDENCE_SHA256",
    "SERAMET_APP_RECOVERY_OPERATOR_ID"
  )) {
    Remove-Item "Env:$key" -ErrorAction SilentlyContinue
  }
  if ($stagePtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($stagePtr)
  }
  if ($localPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($localPtr)
  }
  Remove-Variable stageSecret, localSecret, localPassword, localEncoded -ErrorAction SilentlyContinue
}
