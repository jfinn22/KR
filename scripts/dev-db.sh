#!/usr/bin/env bash
#
# Start the local PostgreSQL cluster and ensure the dev/test databases exist.
#
# Deliberately does NOT use Docker: many sandboxes and CI runners have the
# docker CLI without a running daemon. This drives the system Postgres 16
# install directly, and falls back to pg_ctl if pg_ctlcluster is unavailable.
#
set -euo pipefail

PG_VERSION="${PG_VERSION:-16}"
PG_BIN="/usr/lib/postgresql/${PG_VERSION}/bin"
PG_DATA="/var/lib/postgresql/${PG_VERSION}/main"
PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-postgres}"
PG_PASSWORD="${PG_PASSWORD:-postgres}"
DEV_DB="${DEV_DB:-salon_dev}"
TEST_DB="${TEST_DB:-salon_test}"

say() { printf '  %s\n' "$1"; }

if [ ! -d "$PG_BIN" ]; then
  echo "PostgreSQL ${PG_VERSION} not found at ${PG_BIN}." >&2
  echo "Install it, or point DATABASE_URL at your own Postgres and skip this script." >&2
  exit 1
fi

echo "▸ PostgreSQL ${PG_VERSION}"

# --- 1. Is it already up? --------------------------------------------------
if "$PG_BIN/pg_isready" -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null; then
  say "already running on ${PG_HOST}:${PG_PORT}"
else
  say "starting cluster…"
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    pg_ctlcluster "$PG_VERSION" main start 2>/dev/null || true
  fi

  if ! "$PG_BIN/pg_isready" -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null; then
    # Fallback: drive pg_ctl directly as the postgres user.
    mkdir -p /var/log/postgresql
    chown postgres:postgres /var/log/postgresql 2>/dev/null || true
    su postgres -c "$PG_BIN/pg_ctl -D $PG_DATA -l /var/log/postgresql/dev-db.log -w -t 30 start" \
      >/dev/null 2>&1 || true
  fi

  for _ in $(seq 1 30); do
    "$PG_BIN/pg_isready" -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null && break
    sleep 1
  done

  if ! "$PG_BIN/pg_isready" -h "$PG_HOST" -p "$PG_PORT" -q 2>/dev/null; then
    echo "Could not start PostgreSQL. See /var/log/postgresql/dev-db.log" >&2
    exit 1
  fi
  say "started"
fi

# --- 2. TCP auth ------------------------------------------------------------
# pg_hba is `peer` on the local socket but `scram-sha-256` over TCP, and Prisma
# only speaks TCP — so the postgres role needs a password set.
su postgres -c "psql -qtAX -c \"ALTER USER ${PG_USER} WITH PASSWORD '${PG_PASSWORD}'\"" >/dev/null 2>&1 \
  || say "note: could not set password (non-fatal if already configured)"

export PGPASSWORD="$PG_PASSWORD"
PSQL="$PG_BIN/psql -h $PG_HOST -p $PG_PORT -U $PG_USER -qtAX"

# --- 3. Databases -----------------------------------------------------------
for db in "$DEV_DB" "$TEST_DB"; do
  exists="$($PSQL -d postgres -c "SELECT 1 FROM pg_database WHERE datname='${db}'" 2>/dev/null || true)"
  if [ "$exists" = "1" ]; then
    say "database '${db}' ✓"
  else
    $PSQL -d postgres -c "CREATE DATABASE \"${db}\"" >/dev/null
    say "database '${db}' created"
  fi
  # NOTE: btree_gist is NOT created here. It is declared in the Prisma
  # datasource `extensions` list, so Prisma owns it and creates it in the
  # initial migration. Creating it out-of-band makes `migrate dev` see drift.
done

echo "▸ Ready"
echo "  DATABASE_URL=\"postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${DEV_DB}?schema=public\""
