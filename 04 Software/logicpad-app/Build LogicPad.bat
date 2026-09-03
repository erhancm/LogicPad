@echo off
setlocal
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
cd /d "%~dp0"

echo Building LogicPad...
call npm run build:app
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

set "SETUP=%~dp0src-tauri\target\release\bundle\nsis\LogicPad_0.1.0_x64-setup.exe"
if not exist "%SETUP%" (
  echo Installer not found at:
  echo   %SETUP%
  pause
  exit /b 1
)

echo Installing...
"%SETUP%" /S
echo.
echo LogicPad is installed. Start it from the Start menu or the desktop shortcut.
pause
