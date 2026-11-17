#!/bin/sh
set -eu
ulimit -c 0
exec node --disable-sigusr1 dist/relay-main.js
