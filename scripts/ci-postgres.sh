#!/usr/bin/env bash
# PostgreSQL for CI jobs. Shared GitHub runners sometimes hit pull limits — Docker Hub in v1,
# the AWS mirror here — so try both registries, a few times, before giving up.
set -euo pipefail

for attempt in 1 2 3; do
  for image in public.ecr.aws/docker/library/postgres:17-alpine docker.io/library/postgres:17-alpine; do
    if docker pull -q "$image"; then
      docker run -d --name postgres -p 5432:5432 \
        -e POSTGRES_USER=bulls -e POSTGRES_PASSWORD=ci-only-password -e POSTGRES_DB=bulls "$image"
      for _ in $(seq 30); do
        docker exec postgres pg_isready -U bulls >/dev/null 2>&1 && exit 0
        sleep 1
      done
      echo "PostgreSQL did not become ready" >&2
      exit 1
    fi
  done
  sleep $((attempt * 15))
done
echo "Could not pull PostgreSQL from any registry" >&2
exit 1
