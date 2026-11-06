@echo off
title Barcha Manbalarni Sinxronizatsiya Qilish
cd /d "%~dp0"
call .venv\Scripts\activate.bat
set PYTHONPATH=%~dp0
echo ======================================================================
echo  Barcha 3 ta saytdan ma'lumotlar yig'ilmoqda...
echo ======================================================================
python -m scripts.run_all
pause

