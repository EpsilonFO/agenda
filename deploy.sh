#!/bin/bash
# Déploiement / mise à jour de l'Agenda en prod (VPS, via PM2).
# Usage sur le VPS :  bash ~/agenda/deploy.sh
set -e

APP_NAME="agenda"
PORT="${PORT:-3001}"          # doit correspondre au proxy_pass nginx
cd ~/agenda

echo "==> Récupération du code..."
git pull

echo "==> Dépendances..."
npm ci

echo "==> Build..."
npm run build

# (Re)démarrage via ecosystem.config.js (PORT et env toujours correctement injectés).
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "==> Redémarrage de $APP_NAME..."
  pm2 reload ecosystem.config.js --update-env
else
  echo "==> Premier démarrage de $APP_NAME sur le port $PORT..."
  pm2 start ecosystem.config.js
fi

pm2 save

echo "==> Vérification..."
sleep 2
curl -fsS -o /dev/null -w "app locale : HTTP %{http_code}\n" "http://localhost:$PORT" || {
  echo "⚠️  L'app ne répond pas sur le port $PORT. Logs : pm2 logs $APP_NAME"
  exit 1
}

echo "Déployé ✅"
