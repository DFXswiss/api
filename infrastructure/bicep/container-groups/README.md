# Container Group Deployment

## Container Instance Setup

1. Run script `deploy.sh` with the first parameter `-u [DOCKER USER]` and `-p [DOCKER PASSWORD]`
1. Select the environment
1. Select the container

### Container Instances

Container Instances are:

- hb-deuro-usdt: Hummingbot (dEURO/USDT)
- hb-deuro-btc: Hummingbot (dEURO/BTC)
- hb-deps-usdt: Hummingbot (dEPS/USDT)
- hb-deps-btc: Hummingbot (dEPS/BTC)

### Fileshare

Each Container Instance uses its own fileshare, which is mounted to `/mnt/hummingbot`.

### Entrypoint

There is an entrypoint script in the container to setup the individual environment.

### Note:

Connect to the running container:

- az container exec --resource-group rg-dfx-api-dev --name ci-dfx-hb-deuro-usdt-dev --exec-command /bin/bash
- az container exec --resource-group rg-dfx-api-dev --name ci-dfx-hb-deuro-btc-dev --exec-command /bin/bash
- az container exec --resource-group rg-dfx-api-dev --name ci-dfx-hb-deps-usdt-dev --exec-command /bin/bash
- az container exec --resource-group rg-dfx-api-dev --name ci-dfx-hb-deps-btc-dev --exec-command /bin/bash

Start the Hummingbot within the container:

- conda activate hummingbot && ./bin/hummingbot_quickstart.py 2>> ./logs/errors.log
