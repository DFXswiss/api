# Citreascan Setup

# VM

1. Connect to VM: `ssh {user}@vm-{user}-{type}-{env}.westeurope.cloudapp.azure.com`

# Initial Setup

1. Copy shell script `scripts/setupEnv.sh` to `/home/{user}` and execute the script

1. Copy bitcoind config `config/bitcoind/bitcoin-testnet4.conf` to `home/{user}/volumes/bitcoin`
1. Copy nginx config `config/nginx/default.conf` to `home/{user}/volumes/nginx`

1. Create docker network `docker network create citrea-testnet-network`

1. Copy docker compose config `config/docker/docker-compose-citrea-testnet4.yml` to `/home/{user}`
1. Copy docker compose config `config/docker/docker-compose-blockscout-citrea-testnet.yml` to `/home/{user}`
1. Copy docker compose config `config/docker/docker-compose-nginx.yml` to `/home/{user}`
1. Copy shell script `scripts/update-blockscout.sh` to `/home/{user}`

# Create Blockscout Explorer Compose

1. Create the file `docker-compose-blockscout-citrea-testnet.backend.env` in `/home/{user}`
1. Copy the content of the github repo file `https://github.com/CitreaScan/blockscout/blob/develop/.env.vm_citrea_testnet_dev` in `docker-compose-blockscout-citrea-testnet.backend.env`

1. Create the file `docker-compose-blockscout-citrea-testnet.frontend.env` in `/home/{user}`
1. Copy the content of the github repo file `https://github.com/CitreaScan/frontend/blob/develop/.env.dev` in `docker-compose-blockscout-citrea-testnet.frontend.env`

The `docker-compose-blockscout-citrea-testnet.backend.env` and `docker-compose-blockscout-citrea-testnet.frontend.env` files are also located in the corresponding github repos. They will be overwritten by github workflows in case of changes in the `develop` or in the `main` branch.

# Start Docker Containers

1. Bitcoin Node and Citrea Node: `docker compose -f docker-compose-citrea-testnet4.yml up -d`
1. Citrea Explorer Backend and Frontend: `docker compose -f docker-compose-blockscout-citrea-testnet.yml up -d`
1. Nginx: `docker compose -f docker-compose-nginx.yml up -d`

All docker containers are in the same network `citrea-testnet-network`.
