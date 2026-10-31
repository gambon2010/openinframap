#!/bin/sh
# Fork: the gate's HTTPS certificate, made here the first time (nginx's image runs
# the scripts in /docker-entrypoint.d before starting). Self-signed: nobody else
# signs it, so each browser warns once; the traffic is encrypted all the same.
# Kept in data/gate/ (mounted at /etc/nginx/certs); delete it to make a new one
# (e.g. after this computer's address changed).
set -eu
dir=/etc/nginx/certs
[ -s "$dir/cert.pem" ] && [ -s "$dir/key.pem" ] && exit 0
mkdir -p "$dir"
# Valid for localhost and this computer's addresses (the gate runs on the host's network).
names="DNS:localhost,IP:127.0.0.1,DNS:$(hostname)"
for ip in $(ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1); do
    [ "$ip" = 127.0.0.1 ] || names="$names,IP:$ip"
done
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -subj "/CN=Open Infrastructure Map (this computer)" \
    -addext "subjectAltName=$names" \
    -keyout "$dir/key.pem" -out "$dir/cert.pem" 2>/dev/null
chmod 600 "$dir/key.pem"
echo "gate: made an HTTPS certificate for $names"
