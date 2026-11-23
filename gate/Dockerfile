# Fork: the gate (nginx.conf), with the frontend built into it (Vite's static
# build: no Node.js on the computer running it) and openssl, to make its own HTTPS
# certificate on first start (10-certificate.sh). Saved with the other images for
# offline use (scripts/export-db.sh). Development uses Vite's dev server instead.

# The frontend built, from web/ (Compose's `web` context). web/.env left out: the
# built page finds every service from its own address (web/src/fork/config.ts), so
# one build fits every computer.
FROM node:26 AS frontend
WORKDIR /web
COPY --from=web package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --from=web . .
RUN rm -f .env .env.* && npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
COPY 10-certificate.sh /docker-entrypoint.d/10-certificate.sh
RUN chmod +x /docker-entrypoint.d/10-certificate.sh
COPY nginx.conf /etc/nginx/nginx.conf
COPY service-worker/ /etc/nginx/service-worker/
COPY --from=frontend /web/dist /usr/share/nginx/html
