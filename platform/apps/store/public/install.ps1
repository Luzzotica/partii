# Install the partii CLI (Windows):
#   irm https://partii.games/install.ps1 | iex
# Puts partii.exe in %LOCALAPPDATA%\partii\bin and adds it to your PATH. Re-run to update.
$ErrorActionPreference = "Stop"
$repo = "Luzzotica/partii"
$dest = if ($env:PARTII_INSTALL) { $env:PARTII_INSTALL } else { Join-Path $env:LOCALAPPDATA "partii\bin" }
$target = "x86_64-pc-windows-msvc"
if ($env:PARTII_VERSION) { $tag = "cli-v" + $env:PARTII_VERSION.TrimStart("v") }
else {
  $tag = (Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=30" | Where-Object { $_.tag_name -like "cli-v*" } | Select-Object -First 1).tag_name
  if (-not $tag) { throw "partii: couldn't find a release" }
}
$base = "https://github.com/$repo/releases/download/$tag"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("partii-" + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
try {
  $zip = Join-Path $tmp "partii.zip"
  Invoke-WebRequest "$base/partii-$target.zip" -OutFile $zip -UseBasicParsing
  $want = ((Invoke-WebRequest "$base/partii-$target.zip.sha256" -UseBasicParsing).Content -split "\s+")[0]
  $got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($want -ne $got) { throw "partii: checksum mismatch; not installing" }
  Expand-Archive $zip -DestinationPath $tmp -Force
  New-Item -ItemType Directory $dest -Force | Out-Null
  Move-Item (Join-Path $tmp "partii.exe") (Join-Path $dest "partii.exe") -Force
} finally { Remove-Item $tmp -Recurse -Force }
$path = [Environment]::GetEnvironmentVariable("Path", "User")
if (($path -split ";") -notcontains $dest) { [Environment]::SetEnvironmentVariable("Path", "$path;$dest", "User"); $env:Path += ";$dest" }
Write-Host "Installed partii to $dest\partii.exe"
Write-Host "Next: partii login --email you@example.com   (then: partii login --email you@example.com --code 123456)"
Write-Host "Every command: partii help --json. The guide for AI agents: https://partii.games/llms.txt"
