#!/bin/sh
set -eu

set_config() {
  key="$1"
  value="$2"
  file="/etc/clamav/clamd.conf"
  if grep -q "^${key} " "$file"; then
    sed -i "s|^${key} .*|${key} ${value}|" "$file"
  else
    printf '%s %s\n' "$key" "$value" >> "$file"
  fi
}

set_config TCPSocket 3310
set_config TCPAddr 127.0.0.1
set_config StreamMaxLength 10M
set_config MaxFileSize 10M
set_config MaxScanSize 50M
set_config MaxRecursion 8
set_config MaxFiles 1000
set_config MaxThreads 2
set_config MaxQueue 4
set_config ReadTimeout 60
set_config CommandReadTimeout 10
set_config ConcurrentDatabaseReload no

/init &
init_pid=$!
trap 'kill "$init_pid" 2>/dev/null || true' EXIT INT TERM

attempt=0
until printf 'zPING\0' | nc -w 2 127.0.0.1 3310 | tr '\0' '\n' | grep -q PONG; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 90 ]; then
    echo "clamd did not become ready" >&2
    exit 1
  fi
  sleep 2
done

exec /usr/local/bin/seramet-scanner-gateway
