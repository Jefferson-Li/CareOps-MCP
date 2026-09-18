#!/bin/sh
set -eu

SEED="${CAREOS_SEED_ON_START:-1}"
if [ "$SEED" = "1" ] || [ "$SEED" = "true" ]; then
  if [ ! -f /app/data/careos.json ]; then
    echo "Seeding CareOS database..."
    npx tsx src/careos/seed.ts
  else
    echo "CareOS database already present; skip seed."
  fi
fi

exec npx tsx src/careos/server.ts
