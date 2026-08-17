#!/usr/bin/env bash
# Déploiement / mise à jour de HadjChanges sur le VPS, SANS Docker.
#
#   sudo ./deployer.sh
#
# Relançable à volonté : c'est aussi la commande de mise à jour après un
# `git pull`. Rien n'est détruit, la base n'est jamais réinitialisée.
set -euo pipefail

RACINE=/opt/hadjchanges
UTILISATEUR=hadjchanges
ENVFILE=/etc/hadjchanges/api.env

echo "── Vérifications ──────────────────────────────────────────────"

# Node : le projet est bâti sur la 22. Une version plus ancienne échoue au
# build avec des erreurs de syntaxe difficiles à rattacher à leur cause.
if ! command -v node >/dev/null; then
  echo "ERREUR : Node.js absent. Installer la 22 :"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
  exit 1
fi
MAJEURE=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$MAJEURE" -lt 20 ]; then
  echo "ERREUR : Node $(node -v) trop ancien. La 22 est attendue."
  exit 1
fi
echo "  Node $(node -v)"

command -v psql >/dev/null || { echo "ERREUR : PostgreSQL absent (sudo apt install postgresql)"; exit 1; }
echo "  PostgreSQL présent"

[ -f "$ENVFILE" ] || { echo "ERREUR : $ENVFILE manquant. Voir api.env.example."; exit 1; }
# Un fichier de secrets lisible par tous est une fuite qui ne se voit jamais.
DROITS=$(stat -c "%a" "$ENVFILE")
[ "$DROITS" = "600" ] || echo "  ⚠️  $ENVFILE est en $DROITS — attendu 600 (chmod 600 $ENVFILE)"

id "$UTILISATEUR" >/dev/null 2>&1 || { echo "  création de l'utilisateur $UTILISATEUR"; useradd -r -s /usr/sbin/nologin "$UTILISATEUR"; }

echo "── API ────────────────────────────────────────────────────────"
cd "$RACINE/api"
npm ci
npx prisma generate
npm run build
# Les migrations AVANT le redémarrage : un schéma en retard ne casse pas le
# démarrage mais la première requête, ce qui est bien plus dur à diagnostiquer.
set -a; . "$ENVFILE"; set +a
npx prisma migrate deploy

echo "── Tableau de bord ────────────────────────────────────────────"
cd "$RACINE/admin"
npm ci
npm run build
# ⚠️ La sortie `standalone` de Next NE COPIE PAS les fichiers statiques ni
# `public/`. Sans ces deux lignes, le tableau de bord s'affiche sans aucun
# style et sans le logo — et rien dans les journaux ne l'explique.
cp -r .next/static .next/standalone/.next/
[ -d public ] && cp -r public .next/standalone/

echo "── Droits et services ─────────────────────────────────────────"
chown -R "$UTILISATEUR:$UTILISATEUR" "$RACINE"
systemctl daemon-reload
systemctl restart hadjchanges-api hadjchanges-admin
sleep 4
systemctl is-active --quiet hadjchanges-api  && echo "  API : active"       || { echo "  API EN ÉCHEC :"; journalctl -u hadjchanges-api -n 20 --no-pager; exit 1; }
systemctl is-active --quiet hadjchanges-admin && echo "  Dashboard : actif" || { echo "  DASHBOARD EN ÉCHEC :"; journalctl -u hadjchanges-admin -n 20 --no-pager; exit 1; }

echo
echo "Terminé. Vérification :"
echo "  curl -s http://127.0.0.1:3061/api/health"
