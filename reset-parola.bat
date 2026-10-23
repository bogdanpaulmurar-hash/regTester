@echo off
rem regTester - emergency access: set a new password for an account (or create a new admin).
rem Works on the machine that holds the database, also while regTester is running.
setlocal
cd /d "%~dp0"
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
%PY% regtester.py --list-users
echo.
set "U=admin"
set /p "U=User [admin]: "
%PY% regtester.py --reset-password "%U%"
echo.
pause
