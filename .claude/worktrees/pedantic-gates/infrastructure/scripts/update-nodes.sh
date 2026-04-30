az webapp config container set --resource-group rg-dfx-api-$1 --name app-dfx-node-inp-$1 --multicontainer-config-type compose --multicontainer-config-file infrastructure/docker/defi-node-$1.yml --slot stg
az webapp config container set --resource-group rg-dfx-api-$1 --name app-dfx-node-dex-$1 --multicontainer-config-type compose --multicontainer-config-file infrastructure/docker/defi-node-$1.yml --slot stg

az webapp config container set --resource-group rg-dfx-api-$1 --name app-dfx-node-inp-$1 --multicontainer-config-type compose --multicontainer-config-file infrastructure/docker/defi-node-$1.yml
az webapp config container set --resource-group rg-dfx-api-$1 --name app-dfx-node-dex-$1 --multicontainer-config-type compose --multicontainer-config-file infrastructure/docker/defi-node-$1.yml
