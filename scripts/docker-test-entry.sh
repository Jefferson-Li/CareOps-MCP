#!/bin/sh
# Run the coverage suite, then give the host user ownership of ./coverage.
set -u

npm run test:coverage
status=$?

if [ -n "${HOST_UID:-}" ] && [ -d /app/coverage ]; then
  chown -R "${HOST_UID}:${HOST_GID:-$HOST_UID}" /app/coverage || true
fi

exit "$status"
