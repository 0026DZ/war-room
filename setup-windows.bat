@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
taskkill /im "War Room.exe" /f >nul 2>nul
echo Installing dependencies...
call npm install || goto :fail
echo Building the app...
call npm run dist || goto :fail
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\War Room.lnk');$s.TargetPath='%~dp0dist\win-unpacked\War Room.exe';$s.WorkingDirectory='%~dp0dist\win-unpacked';$s.Save()"
echo.
echo Done. A "War Room" shortcut is on your desktop. Keep this folder where it is.
start "" "%~dp0dist\win-unpacked\War Room.exe"
pause
exit /b 0
:fail
echo.
echo Build failed. Close War Room if it is running and try again, or run it directly with:  npm start
pause
exit /b 1
