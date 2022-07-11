az webapp deployment slot swap --resource-group rg-dfx-api-$1 --name app-dfx-node-inp-$1 --slot stg
az webapp deployment slot swap --resource-group rg-dfx-api-$1 --name app-dfx-node-dex-$1 --slot stg
az webapp deployment slot swap --resource-group rg-dfx-api-$1 --name app-dfx-node-out-$1 --slot stg
az webapp deployment slot swap --resource-group rg-dfx-api-$1 --name app-dfx-node-int-$1 --slot stg
az webapp deployment slot swap --resource-group rg-dfx-api-$1 --name app-dfx-node-ref-$1 --slot stg
az webapp deployment slot swap --resource-group rg-dfx-api-$1 --name app-dfx-node-btc-inp-$1 --slot stg
