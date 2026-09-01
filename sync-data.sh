#!/bin/bash
# Copie les fichiers de data locaux vers le VPS (scp).
# Usage depuis ton Mac :  bash sync-data.sh
# Pré-requis : SSH configuré pour "vps-agenda" OU renseigner USER/HOST ci-dessous.
set -e

VPS_USER="ubuntu"
VPS_HOST="agenda.monumia.fr"            # ← Mets ton IP / domaine ici (ex: agenda.mondomaine.fr)
VPS_PATH="~/agenda/data"

# Fichiers JSON à transférer (tous les indispensables au fonctionnement).
FILES=(
  events.json
  places.json
  travel-times.json
  activities.json
  profile.json
  plans.json
  memory.json
  notified.json
  chat-history.json
  sessions.json
  credentials.json
  life-config.json
  google-accounts.json
  google-tombstones.json
)

if [ -z "$VPS_HOST" ]; then
  echo "❌  Renseigne VPS_HOST dans le script (ligne 8)."
  exit 1
fi

echo "==> Sync data/*.json vers ${VPS_USER}@${VPS_HOST}:${VPS_PATH} ..."

for f in "${FILES[@]}"; do
  if [ -f "data/$f" ]; then
    echo "   $f"
  else
    echo "   ⚠️  $f absent localement → ignoré"
  fi
done

echo ""

# Transfert : scp tous les fichiers d'un coup.
# -- ATTENTION --
# push-subscriptions.json n'est PAS transféré : il n'existe que sur le VPS
# (chaque appareil s'y abonne, un transfert local écraserait les abonnés).
# -------------------------------------------------------------------------
scp "${FILES[@]/#/data/}" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"

echo ""
echo "==> Transfert terminé."
echo ""
echo "⚠️  N'oublie pas de transférer aussi data/traces/ si besoin :"
echo "    scp -r data/traces ${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"
echo ""
echo "Puis redémarre l'app sur le VPS :"
echo "    ssh ${VPS_USER}@${VPS_HOST} 'pm2 reload agenda'"