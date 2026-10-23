#!/usr/bin/env bash
# Takes an on-demand full backup before live schema changes, then keeps only the newest few.
set -euo pipefail

server=${1:?server name required}
backup=${2:?backup name required}
keep=${KEEP_ON_DEMAND_BACKUPS:-5}

# Newer Azure CLI uses --server-name/-s for the server; older releases used --name/-n.
if az postgres flexible-server backup list -h 2>/dev/null | grep -q -- '--server-name'; then
  target=(--resource-group "$RESOURCE_GROUP" --server-name "$server")
  named() { printf -- '-n\n%s\n' "$1"; }
else
  target=(--resource-group "$RESOURCE_GROUP" --name "$server")
  named() { printf -- '--backup-name\n%s\n' "$1"; }
fi

mapfile -t this < <(named "$backup")
az postgres flexible-server backup create "${target[@]}" "${this[@]}" --only-show-errors
completed=$(az postgres flexible-server backup show "${target[@]}" "${this[@]}" --query completedTime -o tsv)
test -n "$completed"
printf 'Backup %s completed at %s\n' "$backup" "$completed"

mapfile -t stale < <(az postgres flexible-server backup list "${target[@]}" \
  --query "sort_by([?starts_with(name, 'pre-release-')], &completedTime)[].name" -o tsv \
  | head -n "-$keep")
for old in "${stale[@]}"; do
  mapfile -t that < <(named "$old")
  az postgres flexible-server backup delete "${target[@]}" "${that[@]}" --yes --only-show-errors \
    || printf '::warning::Could not prune old backup %s\n' "$old"
done
