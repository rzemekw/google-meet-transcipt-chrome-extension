# Registers the native messaging host for every Chromium-based browser (per-user registry keys,
# no administrator rights needed). Run once after cloning; run again if the repository is moved:
#   powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$HostName = "com.rzemekw.meet_transcript"
$HostBat = Join-Path $Root "host\meet_transcript_host.bat"
$HostManifest = Join-Path $Root "host\$HostName.json"
$Manifest = Get-Content (Join-Path $Root "extension\manifest.json") -Raw | ConvertFrom-Json

# Chrome derives the extension id from the pinned public key: first 32 hex digits of its
# SHA-256, each mapped 0-9a-f -> a-p.
$KeyBytes = [Convert]::FromBase64String($Manifest.key)
$Digest = [System.Security.Cryptography.SHA256]::Create().ComputeHash($KeyBytes)
$Hex = -join ($Digest | ForEach-Object { $_.ToString("x2") })
$ExtId = -join ($Hex.Substring(0, 32).ToCharArray() | ForEach-Object { [char]([int][char]'a' + [Convert]::ToInt32([string]$_, 16)) })

# Windows ships a Store stub named python.exe on PATH even when Python is not installed, so the
# interpreters are probed by exit code, the same way meet_transcript_host.bat picks one.
function Test-Python($Command, $Arguments) {
  try { & $Command @Arguments --version 2>&1 | Out-Null; return $LASTEXITCODE -eq 0 } catch { return $false }
}
if (-not (Test-Python "py" @("-3")) -and -not (Test-Python "python" @())) {
  Write-Error "Python 3 not found. Install it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH') and run this script again."
}

@{
  name = $HostName
  description = "Appends Google Meet caption lines to ~/meet-transcripts"
  path = $HostBat
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtId/")
} | ConvertTo-Json | Set-Content -Path $HostManifest -Encoding UTF8

$RegistryRoots = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts",
  "HKCU:\Software\Chromium\NativeMessagingHosts",
  "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts",
  "HKCU:\Software\Vivaldi\NativeMessagingHosts"
)
foreach ($RegRoot in $RegistryRoots) {
  $Key = Join-Path $RegRoot $HostName
  New-Item -Path $Key -Force | Out-Null
  Set-ItemProperty -Path $Key -Name "(Default)" -Value $HostManifest
  Write-Host "registered host at $Key"
}

Write-Host ""
Write-Host "Native host registered. Now load the extension (one time):"
Write-Host "  1. open chrome://extensions"
Write-Host "  2. enable 'Developer mode' (top right)"
Write-Host "  3. 'Load unpacked' -> $(Join-Path $Root 'extension')"
Write-Host "The extension id must be: $ExtId"
Write-Host "Transcripts land in $HOME\meet-transcripts\"
