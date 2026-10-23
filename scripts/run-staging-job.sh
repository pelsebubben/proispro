#!/usr/bin/env bash
set -euo pipefail

job=${1:?job name required}
case "$job" in
  job-griplock-verify|job-griplock-migrate|job-griplock-migrate-dev) ;;
  *) echo "Unknown staging job" >&2; exit 1 ;;
esac
execution=$(az containerapp job start --resource-group "$RESOURCE_GROUP" --name "$job" --query name -o tsv)
test -n "$execution"
for ((attempt=0; attempt<65; attempt++)); do
  status=$(az containerapp job execution show --resource-group "$RESOURCE_GROUP" \
    --name "$job" --job-execution-name "$execution" --query properties.status -o tsv)
  case "$status" in
    Succeeded) printf '%s: %s succeeded\n' "$job" "$execution"; exit 0 ;;
    Failed|Stopped|Degraded)
      printf '::error::%s execution %s ended with %s\n' "$job" "$execution" "$status"
      exit 1 ;;
    Running|Processing|Pending) sleep 10 ;;
    *) printf '::error::Unknown job status: %s\n' "$status"; exit 1 ;;
  esac
done
printf '::error::%s execution %s timed out\n' "$job" "$execution"
exit 1
