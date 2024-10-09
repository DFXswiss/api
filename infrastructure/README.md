# Infrastructure Deployment

1. Update parameter files
1. Temp: Update JWT secret
1. Do deployment: `az deployment group create -g rg-dfx-api-{env} -f infrastructure/bicep/dfx-api.bicep -p infrastructure/bicep/parameters/{env}.json`
1. Loc: remove unused resources (API app service + plan, app insights)

# VM

1. Connect to VM: `ssh {user}@vm-{user}-{type}-{env}.westeurope.cloudapp.azure.com`

# Docker Setup (dockerd)

1. Copy script `infrastructure/scripts/setupDocker.sh` to virtual machine `~/setupDocker.sh`
1. Execute script: `sudo ./setupDocker.sh`
1. Copy script `infrastructure/scripts/setupEnv.sh` to virtual machine `~/setupEnv.sh`
1. Execute script: `./setupEnv.sh`
1. Copy script `infrastructure/config/docker/docker-compose.sh` to virtual machine `~/docker-compose.sh`
1. Copy file `infrastructure/config/docker/docker-compose-bitcoin.yml` to virtual machine `~/docker-compose-bitcoin.yml`
1. Copy file `infrastructure/config/docker/docker-compose-monero.yml` to virtual machine `~/docker-compose-monero.yml`
1. Execute Docker Compose (see [below](#docker-compose)) after all other setup steps are done:
   1. [Bitcoin Node Setup](#bitcoin-node-setup-bitcoind)
   1. [Lightning Node Setup](#lightning-node-setup-lnd)
   1. [LNbits Setup](#lnbits-setup)
   1. [ThunderHub Setup](#thunderhub-setup)
   1. [NGINX Setup](#nginx-setup)

# Bitcoin Node Setup (bitcoind)

1. Copy content of config file `infrastructure/config/btc/bitcoin.conf` to virtual machine `~/volumes/bitcoin/bitcoin.conf`
1. `bitcoin.conf`: Replace `[RPC_AUTH]` and `[WALLET]`
1. Actions after first startup via Docker Compose (see [below](#bitcoin-setup-after-first-startup))

# Lightning Node Setup (lnd)

1. Copy content of config file `infrastructure/config/lightning/lnd/lnd.conf` to virtual machine `~/volumes/lightning/lnd.conf`
1. `lnd.conf`: Replace `[PRIVATE_IP]`, `[ENVIRONMENT]`, `[ALIAS]`, `[PEER]`, `[RPC_USER]` and `[RPC_PASSWORD]`
1. Adapt `addpeer` values for the current environment (peer info can be found here: https://mempool.space/de/lightning)
1. Copy content of config file `infrastructure/config/lightning/lnd/pwd.txt` to virtual machine `~/volumes/lightning/pwd.txt`
1. `pwd.txt`: Replace `[PASSWORD]` with empty text for the very first startup
1. Actions after first startup via Docker Compose (see [below](#lightning-setup-after-first-startup))

# LNbits Setup

1. Copy content of config file `infrastructure/config/lightning/lnbits/lnbits.env` to virtual machine `~/volumes/lnbits/.env`
1. `.env`: Replace `[ADMIN_USERS]` with empty text for the very first startup
1. Actions after first startup via Docker Compose (see [below](#lnbits-setup-after-first-startup))

# ThunderHub Setup

1. Copy content of config file `infrastructure/config/lightning/thunderhub/thunderhub.env` to virtual machine `~/volumes/thunderhub/.env`
1. Copy content of config file `infrastructure/config/lightning/thunderhub/accounts.yml` to virtual machine `~/volumes/thunderhub/accounts.yml`
1. `accounts.yml`: Replace `[NAME]` and `[PASSWORD]`

# NGINX Setup

1. Copy content of config file `infrastructure/config/nginx/default.conf` to virtual machine `~/volumes/nginx/default.conf`

# Docker Compose

The complete Bitcoin Blockchain data is loaded after the very first startup of the bitcoin node. Therefore it is recommended to copy already available blockchain data to the `~/volumes/bitcoin/...` directory.

The complete Lightning data is synchonized after the very first startup of the lightning node. This may take some time.

After Docker Compose is successfully executed for the very first time, the following actions must be performed manually:

## Bitcoin: Setup after first startup

1. Create a Bitcoin Wallet (if needed)
1. Create a Bitcoin Address (if needed)
1. Send funds to the Bitcoin Address (if needed)

## Lightning: Setup after first startup

1. Create a Lightning Wallet with a secure password
1. Set the password in the `~/volumes/lightning/pwd.txt` file
1. Create a Bitcoin Address (needed to open a channel)
1. Send funds to the Bitcoin Address (needed to open a channel)
1. Open the channels

## LNbits: Setup after first startup

1. Open a Browser and connect to LNbits at: https://vm-{user}-{type}-{env}.westeurope.cloudapp.azure.com
1. Find the User Id in the URL
1. Set the value of the `LNBITS_ADMIN_USERS` in the config file `~/volumes/lnbits/.env` to the User Id

# Infrastructure Update

## Backup

1. Run Script `runBackup.sh` before the update. This will backup all dynamic Bitcoin, Lightning, LNbits, ThunderHub and Monero data created from the different docker images - except the large blockchain data.

## Update

Detailed Update Information can be found at: `https://docs.google.com/document/d/1WtpatYIxTcd-9E029Zu_4gLhd3H5MAfhytX3x-kUkwM`

## Docker Setup (dockerd)

1. Copy script `infrastructure/scripts/setupDocker.sh` to virtual machine `~/setupDocker.sh`
1. Execute script: `sudo ./setupDocker.sh`
1. Copy script `infrastructure/scripts/setupEnv.sh` to virtual machine `~/setupEnv.sh`
1. Execute script: `./setupEnv.sh`

## Monero (RPC)

### Initial: Create a new wallet

1. Login to VM
1. Modify docker compose file section `monero-rpc command`

   - '--wallet-dir=/home/monero/.bitmonero/wallet'
   - '--rpc-bind-port=18082'
   - '--untrusted-daemon'
   - '--disable-rpc-login'

1. Run docker compose `docker compose -f docker-compose-monero.yml up -d`
1. After first startup create a new wallet: `curl -X POST http://localhost:18082/json_rpc -d '{"jsonrpc":"2.0","id":"0","method":"create_wallet","params":{"filename":"[WALLET_NAME]","password":"[WALLET_PASSWORD]","language":"English"}}' -H 'Content-Type: application/json'`
1. Stop docker image

### Initial: Create a new self signed certificate

1. Copy content of config file (`infrastructure/config/openssl/openssl.conf`) to virtual machine (`volumes/bitmonero`) and replace the missing settings (in square brackets)
1. Go to directory `volumes/bitmonero`
1. Create certificate `openssl req -config openssl.conf -newkey rsa:2048 -new -nodes -x509 -days 3650 -keyout key.pem -out cert.pem`
1. Modify docker compose file section `monero-rpc command`

   - '--wallet-file=/home/monero/.bitmonero/wallet/[WALLET_NAME]'
   - '--password=[WALLET_PASSWORD]'
   - '--rpc-bind-port=18082'
   - '--untrusted-daemon'
   - '--disable-rpc-login'
   - '--rpc-ssl=enabled'
   - '--rpc-ssl-private-key=/home/monero/.bitmonero/key.pem'
   - '--rpc-ssl-certificate=/home/monero/.bitmonero/cert.pem'

1. Run docker compose `docker compose -f docker-compose-monero.yml up -d`

## Docker compose to start or stop all container

### Start all container

1. Execute script: `sudo ./docker-compose.sh` - all `bitcoin/lightning` and `monero` containers are started

   - bitcoin-lightning-bitcoind-1
   - bitcoin-lightning-lnd-1
   - bitcoin-lightning-lnbits-1
   - bitcoin-lightning-thunderhub-1
   - bitcoin-lightning-nginx-1
   - monero-monerod-1
   - monero-monero-rpc-1

### Stop all container

1. Execute command `docker compose stop`
