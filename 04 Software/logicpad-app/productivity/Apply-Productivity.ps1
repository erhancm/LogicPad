# Apply productivity profiles to the USB LogicPad connected right now.
# Closes LogicPad, queues the setup, reopens the app, which writes flash automatically.

$ErrorActionPreference = "Stop"
$exe = "$env:LOCALAPPDATA\LogicPad\LogicPad.exe"
if (-not (Test-Path $exe)) {
  Write-Error "LogicPad is not installed. Build and install from logicpad-app first."
}

Stop-Process -Name LogicPad -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$configDir = Join-Path $env:APPDATA "com.logicpad.app"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
Set-Content -Path (Join-Path $configDir "apply-productivity.flag") -Value "1" -NoNewline

Write-Host "Productivity setup queued. Starting LogicPad - profiles apply when the USB pad connects."
Start-Process $exe
