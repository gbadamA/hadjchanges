# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────── construction ──
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# ⚠️ Les variables NEXT_PUBLIC_* sont figées DANS le bundle à la construction,
# pas lues au démarrage. Elle doit donc être fournie ici, en argument de build.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# ─────────────────────────────────────────────────────────────── exécution ──
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production

# ⚠️ Le serveur autonome de Next écoute sur 3000 PAR DÉFAUT, quoi qu'en dise
# `EXPOSE`. Sans ces deux lignes, le conteneur n'écoute pas là où le reverse
# proxy le cherche : nginx renvoie 502 et rien n'explique pourquoi.
# (Render, lui, injecte son propre PORT, qui prend le pas sur celui-ci.)
ENV PORT=3060
# Sans HOSTNAME, Next se lie à l'IP du conteneur ; 0.0.0.0 garantit qu'il
# répond aussi sur la boucle locale et sur toute redirection de port.
ENV HOSTNAME=0.0.0.0

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

EXPOSE 3060
CMD ["node", "server.js"]
