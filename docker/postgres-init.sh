#!/bin/sh
# Runs once, when the database volume is created. The server connects as "app", which owns the
# game database but is not a PostgreSQL superuser: a superuser can run commands in the container.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v pw="$APP_DB_PASSWORD" -v db="$POSTGRES_DB" <<'SQL'
create role app login password :'pw';
alter database :"db" owner to app;
SQL
