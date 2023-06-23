# Infrastructure Deployment

1. Update parameter files
1. Temp: Update JWT secret
1. Do deployment: `az deployment group create -g rg-dfx-api-{env} -f infrastructure/bicep/dfx-api.bicep -p infrastructure/bicep/parameters/{env}.json`
1. Loc: remove unused resources (API app service + plan, app insights)

# BTC Node Setup

1. Connect to BTC node: `ssh dfx@vm-dfx-btc-{type}-{env}.westeurope.cloudapp.azure.com`
1. Create scripts (`setupBTC.sh` and `startBTC.sh` from `infrastructure/scripts/btc`) and make them executable (`chmod +x {file}`)
1. Execute setup script: `sudo ./setupBTC.sh`
1. Copy content of config file (`infrastructure/config/btc/{env}.conf`) to virtual machine (`.bitcoin/bitcoin.conf`)
1. Start the bitcoin node: `./startBTC.sh`

# Lightning Setup

Connect to Lightning node: `ssh dfx@vm-dfx-btc-{type}-{env}.westeurope.cloudapp.azure.com`

1. Install tools: `sudo apt install net-tools pass gnupg -y`
1. Setup pass
   1. Create GPG key: `gpg --full-generate-key` (use default values)
   1. Get the key ID with: `gpg --list-secret-keys --keyid-format=long`
   1. Init pass: `pass init [GPG ID]`

## Lightning Node (LND)

- https://github.com/lightningnetwork/lnd/blob/master/docs/INSTALL.md
- https://docs.lightning.engineering/lightning-network-tools/lnd/run-lnd

1. Connect to Lightning node: `ssh dfx@vm-dfx-btc-{type}-{env}.westeurope.cloudapp.azure.com`
1. Create scripts (`setupLND.sh` and `startLND.sh` from `infrastructure/scripts/lightning/lnd`) and make them executable (`chmod +x {file}`)
1. Execute setup script: `sudo ./setupLND.sh`
1. Copy content of config file (`infrastructure/config/lightning/lnd/{env}.conf`) to virtual machine (`.lnd/lnd.conf`) and replace the missing settings (in square brackets)
1. Create a wallet, if lnd is run for the first time (see [below](#wallet-creation))
1. Start the lightning node: `./startLND.sh`

### Wallet Creation

1. Start lnd without wallet: `/home/dfx/.lnd/lnd-linux-amd64-v0.16.2-beta/lnd --bitcoin.mainnet &`
1. Create a new wallet with: `/home/dfx/.lnd/lncli create`. Add a new wallet password, write the displayed 24 word seed down and keep it in a safe place
1. Stop lnd with: `/home/dfx/.lnd/lncli stop`
1. Store the wallet password in the `pass` tool: `pass insert lnd/my-wallet-password`

### Self-Signed Certificate

During first-time startup, LND is creating a self-signed TLS certificate in its root directory (`tls.key`, `tls.cert`). This self-signed certificate is also used for LNbits and ThunderHub.

If a new self-signed certificate is to be created, the Lightning Node must be stopped and the existing certificate deleted. After restarting the node, a new self-signed certificate will be created automatically by the node.

## LNbits

- https://github.com/lnbits/lnbits/blob/main/docs/guide/installation.md

1. Connect to LNbits: `ssh dfx@vm-dfx-btc-{type}-{env}.westeurope.cloudapp.azure.com`
1. Create scripts (`setupLNbits.sh` and `startLNbits.sh` from `infrastructure/scripts/lightning/lnbits`) and make them executable (`chmod +x {file}`)
1. Execute setup script: `./setupLNbits.sh`
1. Copy content of config file (`infrastructure/config/lightning/lnbits/{env}.env`) to virtual machine (`lnbits/.env`)
1. Create logs folder: `mkdir lnbits/logs`
1. Start LNbits: `./startLNbits.sh`
1. Open the web frontend, create a wallet and store the generated user ID in a save place
1. Add the generated user ID to the config file (`[ALLOWED_USERS]`)
1. Restart LNbits (use `kill` to stop it)
1. Install and enable LNURLp extension

The self-signed certificate of the LND is used to provide HTTPS access via the given port number.

## ThunderHub

- https://docs.thunderhub.io/setup
- https://docs.thunderhub.io/installation

1. Connect to ThunderHub: `ssh dfx@vm-dfx-btc-{type}-{env}.westeurope.cloudapp.azure.com`
1. Create scripts (`setupThunderHub.sh` and `startThunderHub.sh` from `infrastructure/scripts/lightning/thunderhub`) and make them executable (`chmod +x {file}`)
1. Execute setup script: `./setupThunderHub.sh`
1. Copy content of config file (`infrastructure/config/lightning/thunderhub/{env}.env`) to virtual machine (`thunderhub/.env`)
1. Create folders: `mkdir thunderhub/logs .thunderhub`
1. Copy content of accounts file (`infrastructure/config/lightning/thunderhub/accounts-{env}.yaml`) to virtual machine (`.thunderhub/accounts.yaml`) and replace the missing settings (in square brackets)
1. Start ThunderHub: `./startThunderHub.sh`

The `main.ts` file of the ThunderHub server must be adapted before starting to use the self-signed certificate of the LND.

To change the passwords in the `accounts-{env}.yaml` file, ThunderHub must be stopped. Then the new passwords can be written in plain text to the yaml file. After restarting ThunderHub, the passwords will be encrypted automatically.
