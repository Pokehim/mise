#!/usr/bin/env bash
# Deploys a commit (HEAD by default) to the public demo on Azure App Service (#42):
#   scripts/deploy-azure.sh [git ref]
# Azure installs the dependencies on Linux and runs npm run build, then npm start. Only committed files go,
# without the raw scans the app never serves. The app's folder is emptied first, so files deleted from the repo go
# too. Visitors' Designs live in DESIGNS_DIR, outside it, so they stay.
set -euo pipefail

APP=${MISE_AZURE_APP:-mise-dubhacks}
GROUP=${MISE_AZURE_GROUP:-mise-rg}
REF=${1:-HEAD}

cd "$(git rev-parse --show-toplevel)"
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
git archive --format=zip -o "$out/mise.zip" "$REF" -- . \
  ':(exclude)data/scans/real-scans' ':(exclude)data/scans/*/raw' ':(exclude)docs' ':(exclude).plans'
echo "Deploying $(git rev-parse --short "$REF") ($(du -h "$out/mise.zip" | cut -f1)) to ${APP}…"
az webapp deploy -g "$GROUP" -n "$APP" --src-path "$out/mise.zip" --type zip --clean true
echo "Live at https://$APP.azurewebsites.net"
