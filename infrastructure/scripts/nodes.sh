az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-inp-$2 --slot stg
az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-dex-$2 --slot stg

az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-inp-$2
az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-dex-$2
