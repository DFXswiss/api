# Infrastructure Deployment
1. Update parameter files (stash)
1. Temp: Update JWT secret
1. Do deployment: `az deployment group create -g rg-dfx-api-{env} -f infrastructure/bicep/dfx-api.bicep -p infrastructure/bicep/parameters/{env}.json`
1. Loc: remove unused resources (API app service + plan, app insights)
1. Dev: remove unused resources (INT node), node url app configuration

# BTC Node Setup
1. Connect to BTC node: `ssh dfx@vm-dfx-btc-{type}-{env}.westeurope.cloudapp.azure.com`
1. Create scripts (`setup.sh` and `start.sh` from `infrastructure/scripts/btc`) and make them executable (`chmod +x {file}`)
1. Execute setup script: `sudo ./setup.sh`
1. Copy content of config file (`infrastructure/config/{env}.conf`) to virtual machine (`.bitcoin/bitcoin.conf`)
1. Start the node: `./start.sh`