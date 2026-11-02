#!/bin/sh
set -eu
umask 077
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown node:node /data
  chmod 700 /data
  exec gosu node "$@"
fi
exec "$@"
