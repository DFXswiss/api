# Infrastructure Deployment
1. Update parameter files (stash)
1. Temp: Update JWT secret
1. Do deployment: `az deployment group create -g rg-dfx-api-{env} -f infrastructure/bicep/dfx-api.bicep -p infrastructure/bicep/parameters/{env}.json`
1. Loc: remove unused resources (API app service, app insights)
1. Dev: remove unused resources (INT node), node url app configuration