# The live demo (#42)

**URL:** https://mise-dubhacks.azurewebsites.net

**Redeploy** the current commit with `scripts/deploy-azure.sh`, or a given one with `scripts/deploy-azure.sh <ref>`. It needs the Azure CLI, signed in (`brew install azure-cli && az login`). Azure installs the dependencies, runs `npm run build`, then `npm start`, which serves the web app, `/api` and `/data` from one Node server.

**Hosting:** Azure App Service, resource group `mise-rg`, app `mise-dubhacks`, one B1 Linux instance in West US 3 on Node 24, always on. About $13 a month, from the Azure trial credit. Keep it at one instance: Designs are JSON files, which only one server may write.

**App settings** (`az webapp config appsettings list -g mise-rg -n mise-dubhacks`):

| Setting | Why |
|---|---|
| `MISE_DEMO=1` | Demo mode: Room Setup and Floor Plan uploads are off, seed Designs are read-only, and Generate is limited to 5 a minute per visitor and 200 a day |
| `DESIGNS_DIR=/home/mise-designs` | Where Designs are saved. `/home` outlives restarts and redeploys; the app's own folder is replaced on each deploy |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` | Generate, and reading Floor Plans outside the demo |
| `SCM_DO_BUILD_DURING_DEPLOYMENT=true` | Azure runs `npm install` on Linux, so `sharp` gets its Linux binary |

**Seed Designs.** Every Design committed in `data/designs/` is a seed. On start, `npm start` copies them into `DESIGNS_DIR` and lists them in `_seed.json`. A visitor who opens a seed edits their own copy, which their browser remembers. Text-to-3D is off, because the demo has no `FAL_KEY`.

**Fallback:** an AWS Lightsail instance (Node LTS, the app kept running by systemd, Caddy for HTTPS) with `DESIGNS_DIR` on its disk. Avoid hosts whose disk is wiped on deploy, such as App Runner or Render without a disk.
