# Fork: the gate (nginx.conf) with openssl, to make its own HTTPS certificate on
# first start (10-certificate.sh). Built once; saved with the other images for
# offline use (scripts/export-db.sh).
FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
COPY 10-certificate.sh /docker-entrypoint.d/10-certificate.sh
RUN chmod +x /docker-entrypoint.d/10-certificate.sh
COPY nginx.conf /etc/nginx/nginx.conf
