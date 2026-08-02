#!/usr/bin/env bash
#
# SessionStart hook — makes a fresh Claude Code session immediately runnable.
#
# Starts the local Postgres cluster, ensures .env exists, installs dependencies
# if node_modules is missing, and applies migrations. Everything here is
# idempotent and safe to run repeatedly.
#
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 0

log() { printf '[session-start] %s\n' "$1"; }

# 1. Environment file — mock adapters, no credentials required.
if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  log ".env created from .env.example (mock adapters, no keys needed)"
fi

# 2. Dependencies.
if [ ! -d node_modules ]; then
  log "installing dependencies…"
  pnpm install --no-frozen-lockfile >/dev/null 2>&1 && log "dependencies installed" \
    || log "WARNING: pnpm install failed — run it manually"
fi

# 3. Database.
if [ -f scripts/dev-db.sh ]; then
  bash scripts/dev-db.sh >/dev/null 2>&1 && log "postgres ready (salon_dev, salon_test)" \
    || log "WARNING: could not start postgres — run scripts/dev-db.sh manually"
fi

# 4. Prisma client + migrations.
if [ -f prisma/schema.prisma ] && [ -d node_modules ]; then
  pnpm exec prisma generate >/dev/null 2>&1 || log "WARNING: prisma generate failed"
  if [ -d prisma/migrations ]; then
    pnpm exec prisma migrate deploy >/dev/null 2>&1 && log "migrations applied" \
      || log "WARNING: prisma migrate deploy failed"
  fi
fi

log "ready — pnpm dev / pnpm test:unit / pnpm verify"
exit 0
