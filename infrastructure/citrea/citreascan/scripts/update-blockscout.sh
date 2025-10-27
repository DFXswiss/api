#!/bin/bash

case "$1" in
  frontend|backend)
  ;;
  *)
    echo "Invalid parameter '$1'"
    echo "Allowed values are: 'frontend' or 'backend'"
    exit 1
  ;;
esac

composefile=docker-compose-blockscout-citrea-testnet.yml
service=$1

cd /home/dfx

docker compose -f ${composefile} down ${service}
docker compose -f ${composefile} pull ${service}
docker compose -f ${composefile} up -d ${service}
