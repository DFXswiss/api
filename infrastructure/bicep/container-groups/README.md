# Container Group Deployment

## Container Instance Setup

1. Run script `deploy.sh` with the first parameter `-u [DOCKER USER]` and `-p [DOCKER PASSWORD]`
1. Select the environment
1. Select the container

### Container Instances

Container Instances are:

- hb-deuro-usdt: Hummingbot (dEURO/USDT)
- hb-deps-usdt: Hummingbot (dEPS/USDT)
- rk: RangeKeeper Liquidity Bot

### Fileshare

Each Container Instance uses its own fileshare:

- Hummingbot instances: mounted to `/mnt/hummingbot`
- RangeKeeper: mounted to `/app/data` (contains `.env` with sensitive config and `state.json` for persistence)

### Entrypoint

There is an entrypoint script in the container to setup the individual environment.

### Note:

Connect to the running container:

- az container exec --resource-group rg-dfx-api-dev --name ci-dfx-hb-deuro-usdt-dev --exec-command /bin/bash
- az container exec --resource-group rg-dfx-api-dev --name ci-dfx-hb-deps-usdt-dev --exec-command /bin/bash

Start the Hummingbot within the container:

- conda activate hummingbot && ./bin/hummingbot_quickstart.py 2>> ./logs/errors.log
