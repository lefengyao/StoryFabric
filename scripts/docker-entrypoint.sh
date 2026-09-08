#!/bin/sh
set -eu

key_file="${STORYFABRIC_ACCESS_KEY_FILE:?STORYFABRIC_ACCESS_KEY_FILE is required}"
data_dir="${STORYFABRIC_DATA_DIR:-/data}"
runtime_dir=/run/storyfabric
install -d "$data_dir"
chown -R storyfabric:storyfabric "$data_dir"
install -d -o storyfabric -g storyfabric -m 0700 "$runtime_dir"
install -o storyfabric -g storyfabric -m 0400 "$key_file" "$runtime_dir/access_key"
exec setpriv --reuid=storyfabric --regid=storyfabric --init-groups \
  env STORYFABRIC_ACCESS_KEY_FILE="$runtime_dir/access_key" node dist-server/index.mjs
