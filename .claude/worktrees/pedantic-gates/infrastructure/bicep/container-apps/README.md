# Container App Deployment

## Initial Setup

1. Change the directory to `initial`
1. Run script `deploy.sh` with the first parameter `[ENV]`

- Setup of a new network security group resource if needed
- Setup of a new subnet for the container apps
- Setup of a new container apps environment

## Container App Setup

1. Change the directory to `apps`
1. Check the parameter definitions in `parameters/[ENV]-[APP].json`
1. Run script `deploy.sh` and select the environment and the container app

- Setup of a new fileshare for the container app if needed
- Setup of a new storage in the existing container apps environment if needed
- Setup of a new container app

### Container Apps

Container Apps are:

- fcp: Frankencoin Ponder
- dep: dEuro Ponder
- dea: dEuro API
- ded: dEuro dApp

## Front Door Setup

1. Run script `manualFrontdoorSetup.sh` with the first parameter `[fcp|dep|ded|dea]` and the second parameter `[loc|dev|prd]`

- Setup of a new endpoint
- Setup of a new origin group
- Setup of a new origin
- Setup of a new route

### Note:

After the first setup, a private endpoint is created. This endpoint can be found in the network part of the container apps environment and `must be approved manually`.

The firewall policies are initial in `detection` mode. After manually checking that the rules are all working, the mode must be manually set to `prevention`.
