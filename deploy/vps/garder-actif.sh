#!/bin/sh
# Empêche la mise en pause du projet Supabase gratuit.
#
#   0 6 * * * /opt/hadjchanges/deploy/vps/garder-actif.sh >> /var/log/hadjchanges-actif.log 2>&1
#
# POURQUOI : un projet Supabase gratuit est suspendu après ~7 jours sans
# activité sur la BASE, et la reprise est MANUELLE. Après une période creuse, le
# bureau de change serait donc à l'arrêt au premier client, jusqu'à ce que
# quelqu'un aille cliquer dans le tableau de bord.
#
# COMMENT : /api/health exécute un vrai `SELECT 1` (api/src/health.controller.ts).
# Un appel quotidien suffit donc à faire compter la base comme active — pas
# besoin d'un script qui parlerait à PostgreSQL lui-même.
#
# ⚠️ On interroge la boucle locale et non le domaine public : le but est de
# toucher la BASE, pas de vérifier nginx ni le certificat. Ainsi le maintien en
# activité continue de fonctionner même si le TLS ou le DNS est cassé.
set -e

REPONSE=$(curl -sS --max-time 30 http://127.0.0.1:3061/api/health 2>&1 || echo "INJOIGNABLE")
HORO=$(date '+%F %T')

case "$REPONSE" in
  *'"database":"ok"'*)
    echo "$HORO  base active"
    ;;
  *'"database":"indisponible"'*)
    # L'API tourne mais la base ne répond pas : projet en pause, mot de passe
    # changé, ou quota dépassé. À voir tout de suite, pas dans trois jours.
    echo "$HORO  ALERTE : l'API ne joint pas la base — projet Supabase en pause ?"
    exit 1
    ;;
  *)
    echo "$HORO  ALERTE : API injoignable — $REPONSE"
    exit 1
    ;;
esac
