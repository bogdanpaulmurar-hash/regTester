@echo off
rem regTester - one-time setup on Windows: checks Python and installs the optional tray icon packages.
setlocal
cd /d "%~dp0"
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
%PY% --version >nul 2>nul || (
  echo Python 3.10 or newer is required: https://www.python.org/downloads/  ^(tick "Add python.exe to PATH"^)
  pause & exit /b 1
)
echo Installing optional tray icon support (pystray, Pillow) for the current user...
%PY% -m pip install --user -r requirements.txt
if errorlevel 1 echo Tray packages could not be installed. regTester still works, just without the tray icon.
echo.
echo Done. Start regTester with start.bat. Login: admin / admin (you will be asked to change it).
pause
