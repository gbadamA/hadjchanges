#!/bin/sh
# Sauvegarde de la base HadjChanges (PostgreSQL natif, sans Docker).
#   0 2 * * * /opt/hadjchanges/deploy/vps/sauvegarde.sh >> /var/log/hadjchanges-sauvegarde.log 2>&1
set -e
DOSSIER=/var/sauvegardes/hadjchanges
JOURS=14
HORO=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DOSSIER"

sudo -u postgres pg_dump hadjchanges | gzip -9 > "$DOSSIER/hadjchanges-${HORO}.sql.gz"

OCTETS=$(stat -c%s "$DOSSIER/hadjchanges-${HORO}.sql.gz")
echo "$(date '+%F %T')  sauvegarde ${HORO} : ${OCTETS} octets"
# Un dump minuscule signale une base vide ou un échec silencieux. Le voir ici
# vaut mieux que le découvrir au moment de restaurer.
[ "$OCTETS" -lt 1024 ] && { echo "ALERTE : sauvegarde anormalement petite"; exit 1; }

# Rotation : sans elle le disque se remplit, et c'est l'API qui tombe.
find "$DOSSIER" -name 'hadjchanges-*.sql.gz' -mtime +${JOURS} -delete
echo "conservees : $(ls -1 "$DOSSIER"/hadjchanges-*.sql.gz | wc -l)"

# ⚠️ Une sauvegarde qui reste sur le VPS disparaît AVEC le VPS. Copie
# hors-machine à activer une fois rclone configuré vers R2 :
#   rclone copy "$DOSSIER/hadjchanges-${HORO}.sql.gz" r2:hadjchanges-sauvegardes/
