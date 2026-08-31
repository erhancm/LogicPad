# Build LogicPad and publish a Gitea Release with installable assets.
# Usage:
#   $env:GITEA_TOKEN = "<personal access token with write:repository>"
#   .\scripts\Publish-Gitea-Release.ps1 -Tag v0.1.0
#
# Or skip the build if the installer already exists:
#   .\scripts\Publish-Gitea-Release.ps1 -Tag v0.1.0 -SkipBuild

param(
  [Parameter(Mandatory = $true)]
  [string]$Tag,
  [string]$Server = "https://git.erhancm.com",
  [string]$Owner = "erhan",
  [string]$Repo = "LogicPad",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$appDir = Join-Path $root "04 Software\logicpad-app"
$tauriConf = Get-Content (Join-Path $appDir "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = $tauriConf.version
$targetDir = Join-Path $appDir "src-tauri\target"
$setupGlob = Join-Path $targetDir "release\bundle\nsis\LogicPad_${version}_x64-setup.exe"
$portableExe = Join-Path $targetDir "release\LogicPad.exe"
$productivityYaml = Join-Path $appDir "productivity\LogicPad-Productivity.yaml"
$changelog = Join-Path $root "CHANGELOG.md"

if (-not $env:GITEA_TOKEN) {
  Write-Error "Set GITEA_TOKEN to a personal access token with repo write access."
}

if (-not $SkipBuild) {
  Write-Host "Building LogicPad $version..."
  taskkill /IM LogicPad.exe /F 2>$null | Out-Null
  $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
  $env:CARGO_TARGET_DIR = $targetDir
  Push-Location $appDir
  npm run build:app
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Pop-Location
}

$setup = Get-Item $setupGlob -ErrorAction Stop
if (-not (Test-Path $portableExe)) { Write-Error "Missing $portableExe" }
if (-not (Test-Path $productivityYaml)) { Write-Error "Missing $productivityYaml" }

$headers = @{
  Authorization = "token $($env:GITEA_TOKEN)"
  Accept = "application/json"
}
$api = "$Server/api/v1/repos/$Owner/$Repo"

Write-Host "Creating release $Tag..."
$body = @{
  tag_name = $Tag
  target_commitish = "main"
  name = "LogicPad $Tag"
  body = if (Test-Path $changelog) { Get-Content $changelog -Raw } else { "LogicPad $Tag" }
  draft = $false
  prerelease = $false
} | ConvertTo-Json

try {
  $release = Invoke-RestMethod -Method Post -Uri "$api/releases" -Headers $headers -Body $body -ContentType "application/json; charset=utf-8"
} catch {
  if ($_.Exception.Response.StatusCode.value__ -eq 409) {
    Write-Host "Release already exists; fetching..."
    $releases = Invoke-RestMethod -Method Get -Uri "$api/releases?limit=50" -Headers $headers
    $release = $releases | Where-Object { $_.tag_name -eq $Tag } | Select-Object -First 1
    if (-not $release) { throw }
  } else {
    throw
  }
}

function Upload-Asset($path) {
  $name = Split-Path $path -Leaf
  Write-Host "Uploading $name..."
  $uri = "$api/releases/$($release.id)/assets?name=$name"
  Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -InFile $path -ContentType "application/octet-stream" | Out-Null
}

Upload-Asset $setup.FullName
Upload-Asset $portableExe
Upload-Asset $productivityYaml

Write-Host ""
Write-Host "Release published: $Server/$Owner/$Repo/releases/tag/$Tag"
