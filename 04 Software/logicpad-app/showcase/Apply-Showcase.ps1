# Apply the LogicPad advertising showcase to the USB pad connected right now.
# Closes LogicPad, queues the demo, reopens the app, which writes flash automatically.

$ErrorActionPreference = "Stop"
$exe = "$env:LOCALAPPDATA\LogicPad\LogicPad.exe"
if (-not (Test-Path $exe)) {
  Write-Error "LogicPad is not installed. Build and install from logicpad-app first."
}

Stop-Process -Name LogicPad -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Queue flag via the installed binary (invokes Tauri command on next launch)
$queueScript = @'
Add-Type -Path "$env:LOCALAPPDATA\LogicPad\LogicPad.exe" 2>$null
'@

# Write flag file (Tauri app_config_dir on Windows)
$configDir = Join-Path $env:APPDATA "com.logicpad.app"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
Set-Content -Path (Join-Path $configDir "apply-showcase.flag") -Value "1" -NoNewline

Write-Host "Showcase queued. Starting LogicPad - demo applies when the USB pad connects."
Start-Process $exe
