#!/usr/bin/env bash
# Takes an on-demand full backup before live schema changes, then keeps only the newest few.
set -euo pipefail

server=${1:?server name required}
backup=${2:?backup name required}
keep=${KEEP_ON_DEMAND_BACKUPS:-5}

az postgres flexible-server backup create --resource-group "$RESOURCE_GROUP" \
  --name "$server" --backup-name "$backup" --only-show-errors
completed=$(az postgres flexible-server backup show --resource-group "$RESOURCE_GROUP" \
  --name "$server" --backup-name "$backup" --query completedTime -o tsv)
test -n "$completed"
printf 'Backup %s completed at %s\n' "$backup" "$completed"

mapfile -t stale < <(az postgres flexible-server backup list --resource-group "$RESOURCE_GROUP" --name "$server" \
  --query "sort_by([?starts_with(name, 'pre-release-')], &completedTime)[].name" -o tsv \
  | head -n "-$keep")
for old in "${stale[@]}"; do
  az postgres flexible-server backup delete --resource-group "$RESOURCE_GROUP" \
    --name "$server" --backup-name "$old" --yes --only-show-errors \
    || printf '::warning::Could not prune old backup %s\n' "$old"
done
