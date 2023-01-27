az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-inp-$2 --slot stg
az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-dex-$2 --slot stg
az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-out-$2 --slot stg
az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-int-$2 --slot stg
az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-ref-$2 --slot stg

az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-inp-$2
az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-dex-$2
az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-out-$2
az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-int-$2
az webapp $1 --resource-group rg-dfx-api-$2 --name app-dfx-node-ref-$2