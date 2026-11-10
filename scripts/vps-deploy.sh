#!/usr/bin/env bash
set -euo pipefail

echo "===> [1/6] Tekshiruv va tayyorgarlik..."
cd /opt/uyushma/app

# Ensure MIGRATE_DATABASE_URL is set in /opt/uyushma/.env
if ! grep -q "^MIGRATE_DATABASE_URL=" /opt/uyushma/.env; then
  DB_URL=$(grep "^DATABASE_URL=" /opt/uyushma/.env | head -1 | cut -d= -f2-)
  echo "MIGRATE_DATABASE_URL=${DB_URL}" >> /opt/uyushma/.env
  echo "MIGRATE_DATABASE_URL qo'shildi."
fi

# Quote EMAIL_FROM if unquoted
sed -i 's/^EMAIL_FROM=Uyushmachilar <no-reply@uyushmachilar.uz>/EMAIL_FROM="Uyushmachilar <no-reply@uyushmachilar.uz>"/' /opt/uyushma/.env

echo "===> [2/6] Prisma migration tekshiruvi va generate..."
cd /opt/uyushma/app/apps/api
set -a
eval "$(grep -E '^(DATABASE_URL|MIGRATE_DATABASE_URL)=' /opt/uyushma/.env)"
set +a
npx prisma migrate deploy
npx prisma generate

echo "===> [3/6] Loyihani yig'ish (npm run build)..."
cd /opt/uyushma/app
npm run build -w @uyushma/api
npm run build -w @uyushma/bot
npm run build -w @uyushma/worker
npm run build -w @uyushma/web

echo "===> [4/6] Next.js standalone statik fayllarni ko'chirish..."
cd /opt/uyushma/app/apps/web
mkdir -p .next/standalone/apps/web/.next
cp -r .next/static .next/standalone/apps/web/.next/
cp -r public .next/standalone/apps/web/

echo "===> [5/6] Next.js middleware patchini qo'llash..."
node /opt/uyushma/bin/patch-next-middleware-host.js || true

echo "===> [6/6] Huquqlarni to'g'rilash va servislarni qayta ishga tushirish..."
chown -R uyushma:uyushma /opt/uyushma/app

systemctl daemon-reload
systemctl restart uyushma-api
systemctl restart uyushma-worker
systemctl restart uyushma-bot
systemctl restart uyushma-web

sleep 3

echo "===> Servislar holati:"
systemctl is-active uyushma-api uyushma-worker uyushma-bot uyushma-web uyushma-collector uyushma-redis uyushma-garage
echo "===> Muvaffaqiyatli yakunlandi!"

