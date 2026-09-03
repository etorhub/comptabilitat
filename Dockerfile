# Imatge unica per al servidor web i per al planificador: canvia l'ordre.
FROM oven/bun:1.3-alpine

WORKDIR /app

ENV NODE_ENV=production

# Les dependencies primer, perque la capa es reaprofiti mentre no canviïn.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
COPY public ./public
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# El full d'estil es compila a la imatge: no es guarda al repositori.
RUN bun add -d tailwindcss @tailwindcss/cli \
 && bunx @tailwindcss/cli -i src/styles/app.css -o public/app.css --minify \
 && rm -rf node_modules/.cache

RUN addgroup -g 10001 comptabilitat \
 && adduser -D -u 10001 -G comptabilitat comptabilitat \
 && chown -R comptabilitat:comptabilitat /app
USER comptabilitat

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8000/salut || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["app"]
