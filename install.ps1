# Installs CURI on Windows 10/11 from the latest GitHub release, for your user only (no admin rights).
#
#   irm https://raw.githubusercontent.com/kaizensx/curi/main/install.ps1 | iex
#
# The installer is checked against the release's SHA256SUMS before it runs.
# Options (environment variables):
#   $env:CURI_VERSION = '3.7.0'   install that version instead of the latest
#   $env:CURI_FROM = '<dir|url>'  install from a folder or URL that holds the release files and SHA256SUMS

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is far faster without the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'kaizensx/curi'
function Say($text) { Write-Host $text -ForegroundColor Cyan }
function Fail($text) { Write-Host "CURI installer: $text" -ForegroundColor Red; throw $text }

if (-not [Environment]::Is64BitOperatingSystem) { Fail 'CURI needs 64-bit Windows.' }

# ---------- where the files come from ----------
if ($env:CURI_FROM) {
  $base = $env:CURI_FROM.TrimEnd('/', '\')
} elseif ($env:CURI_VERSION) {
  $base = "https://github.com/$repo/releases/download/v$($env:CURI_VERSION.TrimStart('v'))"
} else {
  $latest = Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/$repo/releases/latest"
  if (-not $latest.tag_name) { Fail "couldn't find the latest release on GitHub." }
  $base = "https://github.com/$repo/releases/download/$($latest.tag_name)"
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("curi-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

function Fetch($name) {
  $dest = Join-Path $tmp $name
  if ($base -match '^https?://') { Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $dest }
  else { Copy-Item (Join-Path $base $name) $dest }
  return $dest
}

try {
  $sums = Get-Content (Fetch 'SHA256SUMS')
  $line = $sums | Where-Object { $_ -match '_x64-setup\.exe$' } | Select-Object -First 1
  if (-not $line) { Fail 'this release has no Windows installer.' }
  $want, $file = ($line -split '\s+', 2)
  $file = $file.TrimStart('*')

  Say "Downloading $file"
  $exe = Fetch $file
  $got = (Get-FileHash -Algorithm SHA256 $exe).Hash.ToLower()
  if ($got -ne $want.ToLower()) { Fail "checksum mismatch for $file; nothing was installed." }

  # Downloaded by PowerShell, so Windows hasn't flagged it; clear the flag anyway in case a browser did.
  Unblock-File $exe

  # Close a running copy so the new one replaces it cleanly.
  Get-Process curi-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
  Say 'Installing CURI'
  $p = Start-Process -FilePath $exe -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "the installer stopped with code $($p.ExitCode)." }

  $app = Join-Path $env:LOCALAPPDATA 'CURI\curi-desktop.exe'
  if (-not (Test-Path $app)) { Fail "CURI wasn't found after installing ($app)." }
  Say 'CURI is installed (Start menu > CURI). Opening it...'
  Start-Process $app
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
