#!/bin/sh
# Sauvegarde de la base HadjChanges.
#
#   ./sauvegarde.sh
#
# À placer dans le crontab du VPS, par exemple tous les jours à 2 h :
#   0 2 * * * cd /opt/hadjchanges/deploy && ./sauvegarde.sh >> sauvegarde.log 2>&1
#
# ⚠️ CE QUE CE SCRIPT NE FAIT PAS : sortir la sauvegarde de la machine. Un dump
# stocké sur le VPS disparaît avec le VPS — panne disque, suppression par
# erreur, compte suspendu. Pour des pièces de conformité KYC, une copie
# hors-machine n'est pas un luxe. Voir la fin du script.
set -e

JOURS_CONSERVES=14
HORO=$(date +%Y-%m-%d_%H%M)
FICHIER="/sauvegardes/hadjchanges-${HORO}.sql.gz"

# `pg_dump` depuis le conteneur : inutile d'installer PostgreSQL sur l'hôte, et
# la version de l'outil correspond forcément à celle du serveur.
docker compose exec -T db sh -c \
  "pg_dump -U \"\${POSTGRES_USER}\" -d \"\${POSTGRES_DB}\" | gzip -9 > ${FICHIER}"

TAILLE=$(du -h "./sauvegardes/hadjchanges-${HORO}.sql.gz" | cut -f1)
echo "$(date '+%F %T')  sauvegarde : hadjchanges-${HORO}.sql.gz (${TAILLE})"

# Un dump de quelques centaines d'octets signale une base vide ou un échec
# silencieux : mieux vaut le voir tout de suite que le découvrir en restaurant.
OCTETS=$(stat -c%s "./sauvegardes/hadjchanges-${HORO}.sql.gz")
if [ "$OCTETS" -lt 1024 ]; then
  echo "ALERTE : sauvegarde anormalement petite (${OCTETS} octets) — base vide ?"
  exit 1
fi

# Rotation. Sans elle, le disque du VPS se remplit et c'est l'API qui tombe.
find ./sauvegardes -name 'hadjchanges-*.sql.gz' -mtime +${JOURS_CONSERVES} -delete
echo "conservees : $(ls -1 ./sauvegardes/hadjchanges-*.sql.gz | wc -l) sauvegarde(s)"

# ── Copie hors-machine (recommandée) ────────────────────────────────────────
# Décommenter après avoir installé rclone et configuré un accès R2 :
#   rclone copy "./sauvegardes/hadjchanges-${HORO}.sql.gz" r2:hadjchanges-sauvegardes/
