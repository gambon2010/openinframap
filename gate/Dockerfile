# Fork: the gate (nginx.conf) with openssl, to make its own HTTPS certificate on
# first start (10-certificate.sh), in two kinds (docker-compose.override.yml):
#   gate   the page from Vite's dev server (npm start), on the host's network:
#          development, start.sh
#   built  the page built into the image, on Compose's network: a computer
#          without Node.js, Windows included (run.sh)
# Saved with the other images for offline use (scripts/export-db.sh).

FROM nginx:1.27-alpine AS gate
RUN apk add --no-cache openssl
COPY 10-certificate.sh /docker-entrypoint.d/10-certificate.sh
RUN chmod +x /docker-entrypoint.d/10-certificate.sh
COPY nginx.conf /etc/nginx/nginx.conf
# Its mode (modes/<GATE_MODE>/: how the page is served, where the services are):
# nginx's image writes the templates' includes into conf.d at start (its documented
# templates).
COPY modes/ /etc/nginx/modes/
COPY service-worker/ /etc/nginx/service-worker/
COPY templates/ /etc/nginx/templates/
ENV GATE_MODE=dev

# The frontend built (Vite's static build), from web/ (Compose's `web` context).
# web/.env left out: the built page finds every service from its own address
# (web/src/fork/config.ts), so one build fits every computer.
FROM node:26 AS frontend
WORKDIR /web
COPY --from=web package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --from=web . .
RUN rm -f .env .env.* && npm run build

FROM gate AS built
COPY --from=frontend /web/dist /usr/share/nginx/html
ENV GATE_MODE=built
