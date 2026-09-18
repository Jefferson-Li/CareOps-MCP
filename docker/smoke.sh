#!/bin/sh
set -eu

echo "Waiting for CareOS at $CAREOS_URL ..."
i=0
until curl -fsS "$CAREOS_URL/health" >/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "CareOS health check timed out" >&2
    exit 1
  fi
  sleep 1
done
echo "CareOS OK"

echo "Waiting for OCR at $OCR_URL ..."
i=0
until curl -fsS "$OCR_URL/health" >/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "OCR health check timed out" >&2
    exit 1
  fi
  sleep 1
done
echo "OCR OK"

echo "Running CareOS compliance smoke..."
npx tsx scripts/demo-compliance.ts

echo "Smoke OK"
