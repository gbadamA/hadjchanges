# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────── construction ──
FROM node:22-alpine AS build
WORKDIR /app

# Les dépendances d'abord : cette couche ne se reconstruit que si package*.json
# change, ce qui évite de retélécharger tout le registre à chaque commit.
COPY package*.json ./
RUN npm ci

# Le schéma AVANT le reste : `prisma generate` n'a besoin que de lui.
COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────── exécution ──
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
# ⚠️ `prisma` (le CLI) est une dépendance de DÉVELOPPEMENT, donc absente après
# `--omit=dev` — or `prisma migrate deploy` en a besoin au démarrage. On le
# réinstalle explicitement plutôt que d'embarquer tout l'outillage de build.
RUN npm ci --omit=dev && npm install --no-save prisma@^6.5.0

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

# Render fournit le port par la variable PORT ; l'API la lit déjà (config/env.ts).
EXPOSE 3061

# Les migrations tournent AVANT le serveur : un schéma en retard ferait échouer
# la première requête, pas le démarrage — panne bien plus difficile à lire.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
