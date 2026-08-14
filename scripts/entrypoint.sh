#!/bin/sh
set -e

# Container entrypoint for both deployments built from the same image.
#
# APP_MODE selects the process:
#   web    (default) — Next.js server
#   worker           — BullMQ worker
#
# Deploying one image twice with different APP_MODE values, rather than
# building two, means the web tier and the worker can never drift to
# different commits. A worker running older code than the web tier writes
# subtly different metaobject payloads, and that class of bug is invisible
# until a merchant reports it.

MODE="${APP_MODE:-web}"

# Migrations run in web mode ONLY, and before the server starts.
#
# Not in the worker: both containers start together on a redeploy, and two
# concurrent `migrate deploy` runs against one database race on the advisory
# lock — one fails and takes the container down with it. Web is the single
# designated migrator.
#
# `migrate deploy` applies committed migrations and never generates or
# resets, so it is safe to run unattended on every boot.
if [ "$MODE" = "web" ]; then
  echo "[entrypoint] applying database migrations"
  ./node_modules/.bin/prisma migrate deploy
fi

case "$MODE" in
  web)
    echo "[entrypoint] starting Next.js on port ${PORT:-3000}"
    exec ./node_modules/.bin/next start -p "${PORT:-3000}"
    ;;
  worker)
    echo "[entrypoint] starting BullMQ worker"
    # tsx, not next: the worker is plain TypeScript with no Next build step.
    exec ./node_modules/.bin/tsx jobs/worker.ts
    ;;
  *)
    echo "[entrypoint] unknown APP_MODE '$MODE' (expected 'web' or 'worker')" >&2
    exit 1
    ;;
esac
