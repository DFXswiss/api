az webapp deployment slot swap --resource-group rg-dfx-api-$1 --name app-dfx-node-inp-$1 --slot stg
az webapp deployment slot swap --resource-group rg-dfx-api-$1 --name app-dfx-node-dex-$1 --slot stg
