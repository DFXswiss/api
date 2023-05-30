# Infrastructure Deployment

1. Update parameter files
1. Temp: Update JWT secret
1. Do deployment: `az deployment group create -g rg-dfx-api-{env} -f infrastructure/bicep/dfx-api.bicep -p infrastructure/bicep/parameters/{env}.json`
1. Loc: remove unused resources (API app service + plan, app insights)
1. Dev: remove unused resources (INT node), node url app configuration

# BTC Node Setup

1. Connect to BTC node: `ssh dfx@vm-dfx-btc-{type}-{env}.westeurope.cloudapp.azure.com`
1. Create scripts (`setupBTC.sh` and `startBTC.sh` from `infrastructure/scripts/btc`) and make them executable (`chmod +x {file}`)
1. Execute setup script: `sudo ./setupBTC.sh`
1. Copy content of config file (`infrastructure/config/btc/{env}.conf`) to virtual machine (`.bitcoin/bitcoin.conf`)
1. Start the bitcoin node: `./startBTC.sh`

# Lightning Setup

Connect to LIGHTNING node: `ssh dfx@vm-dfx-btc-{type}-{env}.westeurope.cloudapp.azure.com` and install some additional tools:

- sudo apt install net-tools
- sudo apt install pass
- sudo apt install gnupg

## Lightning Node (LND)

- https://github.com/lightningnetwork/lnd/blob/master/docs/INSTALL.md
- https://docs.lightning.engineering/lightning-network-tools/lnd/run-lnd

1. Connect to LIGHTNING node: `ssh dfx@vm-dfx-btc-{type}-{env}.westeurope.cloudapp.azure.com`
1. Create scripts (`setupLND.sh` and `startLND.sh` from `infrastructure/scripts/lightning/lnd`) and make them executable (`chmod +x {file}`)
1. Execute setup script: `sudo ./setupLND.sh`
1. Copy content of config file (`infrastructure/config/lightning/lnd/{env}.conf`) to virtual machine (`.lnd/lnd.conf`)
1. Start the lightning node: `./startLND.sh`

If lnd is being run for the first time:

1. Create a new wallet with: `lncli create`. Add a new wallet password, write the displayed 24 word seed down and keep it in a safe place
1. Store the wallet password in the `pass` tool: `pass insert lnd/my-wallet-password`

Self-Signed Certificate:

During first-time startup, LND is creating a self-signed TLS certificate in its root directory (`tls.key`, `tls.cert`). This self-signed certificate is also used for LNbits and ThunderHub.

## LNbits

- https://github.com/lnbits/lnbits/blob/main/docs/guide/installation.md

1. Connect to LNbits: `ssh dfx@vm-dfx-btc-{type}-{env}.westeurope.cloudapp.azure.com`
1. Create scripts (`setupLNbits.sh` and `startLNbits.sh` from `infrastructure/scripts/lightning/lnbits`) and make them executable (`chmod +x {file}`)
1. Execute setup script: `sudo ./setupLNbits.sh`
1. Copy content of config file (`infrastructure/config/lightning/lnbits/{env}.conf`) to virtual machine (`lnbits/.env`)
1. Start LNbits: `./startLNbits.sh`

The self-signed certificate of the LND is used to provide HTTPS access via the given port number.

## ThunderHub

- https://docs.thunderhub.io/setup
- https://docs.thunderhub.io/installation

1. Connect to ThunderHub: `ssh dfx@vm-dfx-btc-{type}-{env}.westeurope.cloudapp.azure.com`
1. Create scripts (`setupThunderHub.sh` and `startThunderHub.sh` from `infrastructure/scripts/lightning/thunderhub`) and make them executable (`chmod +x {file}`)
1. Copy content of config file (`infrastructure/config/lightning/thunderhub/{env}.conf`) to virtual machine (`thunderhub/.env`)
1. Start ThunderHub: `./startThunderHub.sh`

The `main.ts` file of the ThunderHub server must be adapted before starting to use the self-signed certificate of the LND.
