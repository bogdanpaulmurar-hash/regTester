@echo off
rem Start regTester without a console window; it appears as an icon next to the clock.
cd /d "%~dp0"
where pyw >nul 2>nul && (start "" pyw -3 regtester.py %*) || (start "" pythonw regtester.py %*)
