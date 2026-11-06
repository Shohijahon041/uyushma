@echo off
title Avtomatik Davriy Scheduler
cd /d "%~dp0"
call .venv\Scripts\activate.bat
set PYTHONPATH=%~dp0
echo ======================================================================
echo  Davriy rejalashtiruvchi ishga tushmoqda (Har 30 daqiqada)...
echo ======================================================================
python -m scheduler.cron_jobs
pause

