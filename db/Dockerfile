# syntax=docker/dockerfile:1
FROM postgis/postgis:17-3.4-alpine

# Copy initialization SQL scripts into the location scanned by the default
# Postgres entrypoint. Using COPY rather than bind mounts avoids host
# filesystem permission inconsistencies (e.g. on macOS/Windows) that can
# prevent the container from reading these files during initialization.
COPY schema/dev-init.sql /docker-entrypoint-initdb.d/90-dev-init.sql
COPY schema/functions.sql /docker-entrypoint-initdb.d/91-functions.sql
