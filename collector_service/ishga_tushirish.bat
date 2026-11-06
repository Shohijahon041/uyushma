@echo off
title Yagona Dashboard - FastAPI Server
cd /d "%~dp0"
call .venv\Scripts\activate.bat
set PYTHONPATH=%~dp0
echo ======================================================================
echo  Yagona Transport Portali - Dashboard Serveri Ishga Tushmoqda...
echo  Manzil: http://localhost:8000
echo  Login:  admin
echo  Parol:  admin123
echo ======================================================================
python -m api.main
pause

