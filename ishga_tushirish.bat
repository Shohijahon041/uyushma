@echo off
chcp 65001 > nul
title Uyushma Dastur - Birlashgan Platforma (Web + API + Bot + Collector + Worker)

echo ======================================================================
echo    UYUSHMA TRANSPORT PLATFORMASI, BOT VA COLLECTOR TIZIMI
echo ======================================================================
echo.
echo [1/4] PostgreSQL (5433), Redis (6380) va MinIO (9000) tekshirilmoqda...
echo [2/4] NestJS API (port 4000) va Next.js Web (port 3000) ishga tushmoqda...
echo [3/4] Telegram Bot (@uyushma_saas_bot) va Worker boshlanmoqda...
echo [4/4] Python Collector FastAPI (port 8000) ulanmoqda...
echo.
echo ----------------------------------------------------------------------
echo  Kirish manzillari:
echo    - Asosiy Dashboard:      http://localhost:3000/uz/registry
echo    - Kollektor & Manbalar:   http://localhost:3000/uz/collector
echo    - To'lov arizalari (AI):  http://localhost:3000/uz/submissions
echo    - Telegram Bot:           https://t.me/uyushma_saas_bot (@uyushma_saas_bot)
echo    - FastAPI Kollektor API:  http://localhost:8000/?key=admin123
echo    - NestJS API Swagger:     http://localhost:4000/api/docs
echo ----------------------------------------------------------------------
echo.

npm run dev:all
pause

