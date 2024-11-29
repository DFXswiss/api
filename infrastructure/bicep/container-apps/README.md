# Container App Deployment

## Initial Setup

1. Change the directory to `initial`
1. Run script `deploy.sh`

- Setup of a new network security group resource
- Setup of a new subnet for the container apps
- Setup of a new container apps environment

## dEURO Ponder App Setup

1. Change the directory to `ponder`
1. Check the parameter definitions in `parameters/[loc|dev|prd].json`
1. Run script `deploy.sh` with the first parameter `[fcp|dep]` and the second parameter `[loc|dev|prd]`

- Setup of a new fileshare for the container app
- Setup of a new storage in the existing container apps environment
- Setup of a new container app

## dEURO API Setup

1. Change the directory to `api`
1. Check the parameter definitions in `parameters/[loc|dev|prd].json`
1. Run script `deploy.sh` with the first parameter `[loc|dev|prd]`

- Setup of a new fileshare for the container app
- Setup of a new storage in the existing container apps environment
- Setup of a new container app

## dEURO dApp Setup

1. Change the directory to `dapp`
1. Check the parameter definitions in `parameters/[loc|dev|prd].json`
1. Run script `deploy.sh` with the first parameter `[loc|dev|prd]`
1. Copy the `[ENV].env` file to the container app fileshare root as `.env` and update the content

- Setup of a new fileshare for the container app
- Setup of a new storage in the existing container apps environment
- Setup of a new container app

## Front Door Setup

1. Run script `manualFrontdoorSetup.sh` with the first parameter `[fcp|dep|ded|dea]` and the second parameter `[loc|dev|prd]`

- Setup of a new endpoint
- Setup of a new origin group
- Setup of a new origin
- Setup of a new route
