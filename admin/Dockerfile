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

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

EXPOSE 3060
CMD ["node", "server.js"]
